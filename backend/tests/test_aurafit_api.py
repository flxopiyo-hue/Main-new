"""AuraFit API regression tests.

Covers auth, profile, items, try-on, payments. Uses public preview URL.
Gemini try-on call is exercised once with a small placeholder image; 502s are
treated as acceptable (LLM transient) per testing instructions.
"""

from __future__ import annotations

import base64
import io
import os
import uuid

import pytest
import requests

# 1x1 PNG (transparent)
TINY_PNG = base64.b64encode(
    base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )
).decode()

# Slightly bigger 8x8 PNG synthesized to be still under 100KB by far
def _small_png_b64(color: tuple = (240, 100, 100)) -> str:
    try:
        from PIL import Image
        img = Image.new("RGB", (32, 32), color)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return TINY_PNG


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get(
    "EXPO_BACKEND_URL"
)
if not BASE_URL:
    # Fall back to reading frontend .env directly
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL"):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"')
                    break
    except Exception:
        pass

assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

SELLER_EMAIL = "atelier@aurafit.demo"
SELLER_PASS = "demo-seller-2026"
BUYER_EMAIL = "buyer@aurafit.demo"
BUYER_PASS = "demo-buyer-2026"


@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def seller_token(http) -> str:
    r = http.post(f"{API}/auth/login", json={"email": SELLER_EMAIL, "password": SELLER_PASS})
    assert r.status_code == 200, f"Seller login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def buyer_token(http) -> str:
    # Try login first; register if missing
    r = http.post(f"{API}/auth/login", json={"email": BUYER_EMAIL, "password": BUYER_PASS})
    if r.status_code == 200:
        return r.json()["token"]
    r = http.post(
        f"{API}/auth/register",
        json={
            "email": BUYER_EMAIL,
            "password": BUYER_PASS,
            "full_name": "Demo Buyer",
            "role": "buyer",
        },
    )
    assert r.status_code == 200, f"Buyer register failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ----------- Health -----------
class TestHealth:
    def test_root(self, http):
        r = http.get(f"{API}/")
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok"


# ----------- Auth -----------
class TestAuth:
    def test_register_new_buyer_and_seller(self, http):
        suffix = uuid.uuid4().hex[:8]
        # Buyer
        r1 = http.post(
            f"{API}/auth/register",
            json={
                "email": f"TEST_buyer_{suffix}@aurafit.demo",
                "password": "test-pass-2026",
                "full_name": "Test Buyer",
                "role": "buyer",
            },
        )
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert "token" in d1 and d1["user"]["role"] == "buyer"

        # Seller
        r2 = http.post(
            f"{API}/auth/register",
            json={
                "email": f"TEST_seller_{suffix}@aurafit.demo",
                "password": "test-pass-2026",
                "full_name": "Test Seller",
                "role": "seller",
            },
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["user"]["role"] == "seller"

    def test_login_seller(self, seller_token):
        assert isinstance(seller_token, str) and len(seller_token) > 20

    def test_login_invalid(self, http):
        r = http.post(
            f"{API}/auth/login",
            json={"email": SELLER_EMAIL, "password": "wrong-password"},
        )
        assert r.status_code == 400

    def test_me_authenticated(self, http, seller_token):
        r = http.get(f"{API}/auth/me", headers=_auth(seller_token))
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == SELLER_EMAIL
        assert data["role"] == "seller"

    def test_me_no_token_401(self, http):
        r = http.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_invalid_token_401(self, http):
        r = http.get(f"{API}/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
        assert r.status_code == 401

    def test_register_duplicate_fails(self, http):
        r = http.post(
            f"{API}/auth/register",
            json={
                "email": SELLER_EMAIL,
                "password": "whatever",
                "full_name": "Dup",
                "role": "seller",
            },
        )
        assert r.status_code == 400


# ----------- Profile -----------
class TestProfile:
    def test_get_empty_profile(self, http, buyer_token):
        r = http.get(f"{API}/profile", headers=_auth(buyer_token))
        assert r.status_code == 200
        data = r.json()
        assert "measurements" in data and "user_id" in data

    def test_update_profile_with_photos(self, http, buyer_token):
        photo = _small_png_b64()
        payload = {
            "measurements": {
                "height_cm": 170,
                "chest_cm": 92,
                "waist_cm": 76,
                "hips_cm": 95,
                "shoulders_cm": 42,
                "inseam_cm": 78,
            },
            "preferred_size": "M",
            "front_photo_b64": photo,
            "side_photo_b64": photo,
        }
        r = http.put(f"{API}/profile", headers=_auth(buyer_token), json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["preferred_size"] == "M"
        assert d["has_front_photo"] is True
        assert d["has_side_photo"] is True
        assert d["measurements"]["chest_cm"] == 92

        # Verify GET returns persisted
        r2 = http.get(f"{API}/profile", headers=_auth(buyer_token))
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["has_front_photo"] is True
        assert d2["measurements"]["waist_cm"] == 76

    def test_estimate_measurements(self, http, buyer_token):
        photo = _small_png_b64((100, 200, 150))
        r = http.post(
            f"{API}/profile/estimate",
            headers=_auth(buyer_token),
            json={"front_photo_b64": photo, "side_photo_b64": photo, "height_cm": 170},
            timeout=60,
        )
        # 502 acceptable for LLM transient
        assert r.status_code in (200, 502), f"unexpected: {r.status_code} {r.text}"
        if r.status_code == 200:
            data = r.json()
            # All keys should be present (values may be None)
            for k in ("height_cm", "chest_cm", "waist_cm", "hips_cm", "shoulders_cm", "inseam_cm"):
                assert k in data


# ----------- Items -----------
class TestItems:
    @pytest.fixture(scope="class")
    def created_item_id(self, http, seller_token):
        photo = _small_png_b64((50, 50, 200))
        payload = {
            "name": f"TEST_Item_{uuid.uuid4().hex[:6]}",
            "description": "Test garment for automated regression",
            "category": "shirts",
            "price_cents": 4999,
            "image_b64": photo,
            "sizes": [
                {"label": "S", "chest_cm": 88, "waist_cm": 70, "available_qty": 5},
                {"label": "M", "chest_cm": 94, "waist_cm": 76, "available_qty": 5},
                {"label": "L", "chest_cm": 100, "waist_cm": 82, "available_qty": 5},
            ],
            "colors": [{"name": "Blue", "hex": "#0000FF"}],
        }
        r = http.post(f"{API}/items", headers=_auth(seller_token), json=payload)
        assert r.status_code == 200, r.text
        item_id = r.json()["id"]
        yield item_id
        # cleanup
        http.delete(f"{API}/items/{item_id}", headers=_auth(seller_token))

    def test_create_item_buyer_forbidden(self, http, buyer_token):
        photo = TINY_PNG
        r = http.post(
            f"{API}/items",
            headers=_auth(buyer_token),
            json={
                "name": "Should Fail",
                "description": "",
                "category": "shirts",
                "price_cents": 1000,
                "image_b64": photo,
                "sizes": [{"label": "M", "available_qty": 1}],
                "colors": [],
            },
        )
        assert r.status_code == 403

    def test_list_items_all(self, http):
        r = http.get(f"{API}/items")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 1

    def test_list_items_filter_category(self, http):
        r = http.get(f"{API}/items", params={"category": "shirts"})
        assert r.status_code == 200
        for it in r.json():
            assert it["category"] == "shirts"

    def test_list_items_filter_size(self, http, created_item_id):
        r = http.get(f"{API}/items", params={"size": "M"})
        assert r.status_code == 200
        items = r.json()
        assert any(it["id"] == created_item_id for it in items)
        for it in items:
            labels = [s["label"] for s in it["sizes"]]
            assert "M" in labels

    def test_list_items_filter_color(self, http, created_item_id):
        r = http.get(f"{API}/items", params={"color": "Blue"})
        assert r.status_code == 200
        items = r.json()
        # at least the created item should be present
        assert any(it["id"] == created_item_id for it in items)

    def test_get_item_detail(self, http, created_item_id):
        r = http.get(f"{API}/items/{created_item_id}")
        assert r.status_code == 200
        assert r.json()["id"] == created_item_id

    def test_get_item_404(self, http):
        r = http.get(f"{API}/items/{uuid.uuid4()}")
        assert r.status_code == 404

    def test_my_items_seller(self, http, seller_token, created_item_id):
        r = http.get(f"{API}/items/mine", headers=_auth(seller_token))
        assert r.status_code == 200
        ids = [it["id"] for it in r.json()]
        assert created_item_id in ids

    def test_delete_item_not_owner(self, http, buyer_token, created_item_id):
        r = http.delete(f"{API}/items/{created_item_id}", headers=_auth(buyer_token))
        # buyer is not owner -> 403
        assert r.status_code == 403


# ----------- Try-On -----------
class TestTryOn:
    def test_tryon_run_once(self, http, buyer_token):
        # Use first existing item
        r = http.get(f"{API}/items", params={"category": "shirts"})
        items = r.json()
        if not items:
            pytest.skip("No items to try on")
        item_id = items[0]["id"]

        # Ensure buyer has a profile photo (set in earlier test)
        photo = _small_png_b64((180, 160, 140))
        http.put(
            f"{API}/profile",
            headers=_auth(buyer_token),
            json={
                "measurements": {"height_cm": 170, "chest_cm": 92, "waist_cm": 76, "hips_cm": 95},
                "preferred_size": "M",
                "front_photo_b64": photo,
                "side_photo_b64": photo,
            },
        )

        r = http.post(
            f"{API}/tryon",
            headers=_auth(buyer_token),
            json={"item_id": item_id, "use_profile_photo": True},
            timeout=120,
        )
        # 502 acceptable per instructions; otherwise 200 with image
        assert r.status_code in (200, 502), f"unexpected: {r.status_code} {r.text[:300]}"
        if r.status_code == 200:
            d = r.json()
            assert d["item_id"] == item_id
            assert isinstance(d["result_image_b64"], str)
            assert len(d["result_image_b64"]) > 100
            assert "fit_summary" in d

    def test_tryon_history(self, http, buyer_token):
        r = http.get(f"{API}/tryon/history", headers=_auth(buyer_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ----------- Payments -----------
class TestPayments:
    def test_checkout_seller_forbidden(self, http, seller_token):
        # pick an item
        r = http.get(f"{API}/items")
        items = r.json()
        if not items:
            pytest.skip("no items")
        r = http.post(
            f"{API}/payments/checkout",
            headers=_auth(seller_token),
            json={
                "item_id": items[0]["id"],
                "size": "M",
                "color": None,
                "origin_url": BASE_URL,
            },
        )
        assert r.status_code == 403

    def test_checkout_buyer_success(self, http, buyer_token):
        r = http.get(f"{API}/items")
        items = r.json()
        assert items
        item_id = items[0]["id"]
        r = http.post(
            f"{API}/payments/checkout",
            headers=_auth(buyer_token),
            json={
                "item_id": item_id,
                "size": "M",
                "color": None,
                "origin_url": BASE_URL,
            },
            timeout=60,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "session_id" in d and d["session_id"].startswith("cs_test_")
        assert d["url"].startswith("https://")

        # Check status retrieval
        r2 = http.get(
            f"{API}/payments/status/{d['session_id']}", headers=_auth(buyer_token)
        )
        assert r2.status_code == 200
        s = r2.json()
        assert s["session_id"] == d["session_id"]
        assert s["status"] in ("pending", "paid", "cancelled", "failed", "open")

    def test_orders_list(self, http, buyer_token):
        r = http.get(f"{API}/orders", headers=_auth(buyer_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        # should have at least the one from checkout test
        assert len(r.json()) >= 1

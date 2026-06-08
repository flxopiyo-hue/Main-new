"""Iteration 6 regression tests for AuraFit backend.

Targets:
1. Currency localization (12 supported codes, KES default for new accounts).
2. Item.currency precedence: explicit body > seller preferred > KES default.
3. /auth/preferences endpoint.
4. Multi-angle try-on (front + side + back) via Gemini Nano Banana.
5. Try-on share endpoint with angle param + graceful fallback.
6. Try-on history includes images[] array (incl. legacy try-ons).
7. Stripe checkout propagates currency into the Order record.
8. GET /items + /items/feed always expose a `currency` field.

Uses public preview URL via EXPO_PUBLIC_BACKEND_URL.
"""

from __future__ import annotations

import base64
import io
import os
import time
import uuid
from typing import Any, Dict, Optional

import pytest
import requests


# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _png_b64(color=(140, 110, 200), size: int = 64) -> str:
    try:
        from PIL import Image

        img = Image.new("RGB", (size, size), color)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return TINY_PNG_B64


def _resolve_base_url() -> str:
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("EXPO_PUBLIC_BACKEND_URL"):
                        url = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass
    assert url, "EXPO_PUBLIC_BACKEND_URL is not configured"
    return url.rstrip("/")


BASE_URL = _resolve_base_url()
API = f"{BASE_URL}/api"

SELLER_EMAIL = "atelier@aurafit.demo"
SELLER_PASS = "demo-seller-2026"
BUYER_EMAIL = "buyer@aurafit.demo"
BUYER_PASS = "demo-buyer-2026"


@pytest.fixture(scope="session")
def http() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def seller_token(http) -> str:
    r = http.post(f"{API}/auth/login", json={"email": SELLER_EMAIL, "password": SELLER_PASS})
    assert r.status_code == 200, f"seller login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def buyer_token(http) -> str:
    r = http.post(f"{API}/auth/login", json={"email": BUYER_EMAIL, "password": BUYER_PASS})
    if r.status_code == 200:
        return r.json()["token"]
    # register fresh
    r = http.post(
        f"{API}/auth/register",
        json={
            "email": BUYER_EMAIL,
            "password": BUYER_PASS,
            "full_name": "Demo Buyer",
            "role": "buyer",
            "gender": "female",
            "age": 28,
        },
    )
    assert r.status_code == 200, f"buyer register failed: {r.status_code} {r.text}"
    return r.json()["token"]


# ---------------------------------------------------------------------------
# 1. Currency default on register
# ---------------------------------------------------------------------------
class TestCurrencyRegisterDefault:
    def test_register_without_currency_defaults_kes(self, http):
        email = f"TEST_curr_{uuid.uuid4().hex[:8]}@aurafit.demo"
        r = http.post(
            f"{API}/auth/register",
            json={
                "email": email,
                "password": "test-pass-2026",
                "full_name": "Test Currency",
                "role": "buyer",
                "gender": "other",
                "age": 30,
            },
        )
        assert r.status_code == 200, r.text
        user = r.json()["user"]
        assert user.get("preferred_currency") == "KES", (
            f"expected KES default, got {user.get('preferred_currency')}"
        )

    def test_register_with_explicit_currency(self, http):
        email = f"TEST_curr2_{uuid.uuid4().hex[:8]}@aurafit.demo"
        r = http.post(
            f"{API}/auth/register",
            json={
                "email": email,
                "password": "test-pass-2026",
                "full_name": "Test Currency2",
                "role": "buyer",
                "gender": "male",
                "age": 25,
                "preferred_currency": "EUR",
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["user"]["preferred_currency"] == "EUR"


# ---------------------------------------------------------------------------
# 2. PATCH /auth/preferences
# ---------------------------------------------------------------------------
class TestPreferencesPatch:
    def test_patch_valid_currency(self, http, buyer_token):
        for code in ("USD", "KES", "GBP"):
            r = http.patch(
                f"{API}/auth/preferences",
                headers=_auth(buyer_token),
                json={"preferred_currency": code},
            )
            assert r.status_code == 200, f"{code} failed: {r.status_code} {r.text}"
            assert r.json()["preferred_currency"] == code

        # Verify GET /me reflects the latest
        r = http.get(f"{API}/auth/me", headers=_auth(buyer_token))
        assert r.status_code == 200
        assert r.json()["preferred_currency"] == "GBP"

        # Reset to KES so other tests have a clean default
        http.patch(
            f"{API}/auth/preferences",
            headers=_auth(buyer_token),
            json={"preferred_currency": "KES"},
        )

    def test_patch_invalid_currency_returns_422(self, http, buyer_token):
        r = http.patch(
            f"{API}/auth/preferences",
            headers=_auth(buyer_token),
            json={"preferred_currency": "XYZ"},
        )
        assert r.status_code == 422, f"expected 422 for invalid currency, got {r.status_code}: {r.text}"

    def test_patch_empty_body_returns_400(self, http, buyer_token):
        r = http.patch(
            f"{API}/auth/preferences",
            headers=_auth(buyer_token),
            json={},
        )
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# 3. Item currency
# ---------------------------------------------------------------------------
class TestItemCurrency:
    def _create_item(
        self,
        http,
        seller_token,
        currency: Optional[str] = None,
        name: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "name": name or f"TEST_CUR_Item_{uuid.uuid4().hex[:6]}",
            "description": "currency test garment",
            "category": "shirts",
            "price_cents": 2599,
            "image_b64": _png_b64((80, 200, 150)),
            "sizes": [
                {"label": "S", "available_qty": 2},
                {"label": "M", "available_qty": 3},
            ],
            "colors": [{"name": "Sage", "hex": "#7FB069"}],
        }
        if currency is not None:
            payload["currency"] = currency
        r = http.post(f"{API}/items", headers=_auth(seller_token), json=payload)
        assert r.status_code == 200, r.text
        return r.json()

    def test_create_item_with_explicit_kes(self, http, seller_token):
        item = self._create_item(http, seller_token, currency="KES")
        try:
            assert item["currency"] == "KES"
            # verify persistence via GET
            r = http.get(f"{API}/items/{item['id']}")
            assert r.status_code == 200
            assert r.json()["currency"] == "KES"
        finally:
            http.delete(f"{API}/items/{item['id']}", headers=_auth(seller_token))

    def test_create_item_without_currency_uses_sellers_preferred(
        self, http, seller_token
    ):
        """Override seller preference temporarily and confirm new item picks it up."""
        # Force seller currency to USD
        r = http.patch(
            f"{API}/auth/preferences",
            headers=_auth(seller_token),
            json={"preferred_currency": "USD"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["preferred_currency"] == "USD"

        try:
            item = self._create_item(http, seller_token, currency=None)
            try:
                # NOTE: server.py:181 declares ItemIn.currency default=DEFAULT_CURRENCY ("KES")
                # which means a missing body.currency falls back to KES, NOT the seller's
                # preferred_currency. The intent in the iteration-6 spec is that omitting
                # currency should adopt the seller's preferred currency. We assert the spec.
                assert item["currency"] == "USD", (
                    "Item created without explicit currency should inherit seller's "
                    f"preferred_currency=USD, got {item['currency']}. "
                    "Root cause: ItemIn.currency in server.py has a non-None default "
                    "('KES'), so the `body.currency or user.preferred_currency` fallback "
                    "never fires. Fix: declare `currency: Optional[Currency] = None`."
                )
            finally:
                http.delete(f"{API}/items/{item['id']}", headers=_auth(seller_token))
        finally:
            # Restore seller to KES so other tests start from default
            http.patch(
                f"{API}/auth/preferences",
                headers=_auth(seller_token),
                json={"preferred_currency": "KES"},
            )

    def test_list_items_includes_currency_field(self, http):
        r = http.get(f"{API}/items")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and len(items) >= 1
        valid_currencies = {
            "USD", "KES", "EUR", "GBP", "NGN", "ZAR", "INR", "UGX", "TZS", "RWF", "GHS", "EGP",
        }
        for it in items:
            assert "currency" in it, f"item missing currency: {it.get('id')}"
            assert it["currency"] in valid_currencies, (
                f"unexpected currency: {it['currency']} for item {it.get('id')}"
            )

    def test_feed_includes_currency_field(self, http, buyer_token):
        # Spec calls the endpoint /items/feed but the actual route is /feed.
        # Try both for safety.
        r = http.get(f"{API}/items/feed", headers=_auth(buyer_token))
        if r.status_code == 404:
            r = http.get(f"{API}/feed", headers=_auth(buyer_token))
        if r.status_code == 404:
            pytest.skip("/items/feed and /feed endpoints not present")
        assert r.status_code == 200, r.text
        feed = r.json()
        # Feed shape may be a list OR a dict containing items
        if isinstance(feed, dict):
            items = feed.get("items") or feed.get("results") or []
        else:
            items = feed
        if not items:
            pytest.skip("feed returned no items")
        for it in items:
            assert "currency" in it, f"feed item missing currency: {it}"


# ---------------------------------------------------------------------------
# 4. Multi-angle try-on
# ---------------------------------------------------------------------------
class TestMultiAngleTryOn:
    """Runs ONE real multi-angle generation. Skips on LLM 5xx per instructions."""

    SHARED: Dict[str, Any] = {}  # used to share state with the share-endpoint tests

    @pytest.fixture(scope="class")
    def tryon_result(self, http, buyer_token) -> Dict[str, Any]:
        # Pick first item
        r = http.get(f"{API}/items")
        assert r.status_code == 200
        items = r.json()
        assert items, "no items available"
        item_id = items[0]["id"]

        # Ensure profile photo is present
        photo = _png_b64((200, 170, 150))
        prof = http.put(
            f"{API}/profile",
            headers=_auth(buyer_token),
            json={
                "measurements": {
                    "height_cm": 170, "chest_cm": 92, "waist_cm": 76, "hips_cm": 95,
                },
                "preferred_size": "M",
                "front_photo_b64": photo,
                "side_photo_b64": photo,
            },
        )
        assert prof.status_code == 200, prof.text

        start = time.time()
        r = http.post(
            f"{API}/tryon",
            headers=_auth(buyer_token),
            json={
                "item_id": item_id,
                "use_profile_photo": True,
                "angles": ["front", "side", "back"],
            },
            timeout=180,
        )
        elapsed = time.time() - start
        print(f"[tryon multi-angle] status={r.status_code} elapsed={elapsed:.1f}s")

        if r.status_code >= 500:
            pytest.skip(
                f"LLM key exhausted / upstream failure ({r.status_code}); "
                f"recorded as known limitation: {r.text[:300]}"
            )
        assert r.status_code == 200, r.text
        data = r.json()
        TestMultiAngleTryOn.SHARED["tryon"] = data
        TestMultiAngleTryOn.SHARED["item_id"] = item_id
        return data

    def test_three_angles_returned(self, tryon_result):
        imgs = tryon_result.get("images") or []
        assert len(imgs) == 3, f"expected 3 angles, got {len(imgs)}: {[i.get('angle') for i in imgs]}"
        angles_seen = {i["angle"] for i in imgs}
        assert angles_seen == {"front", "side", "back"}, angles_seen
        for img in imgs:
            assert isinstance(img.get("image_b64"), str) and len(img["image_b64"]) > 200

    def test_result_image_matches_front(self, tryon_result):
        imgs = tryon_result.get("images") or []
        front = next((i for i in imgs if i["angle"] == "front"), None)
        assert front is not None
        assert tryon_result["result_image_b64"] == front["image_b64"], (
            "result_image_b64 must equal the front angle's image_b64"
        )

    def test_history_returns_three_images_for_new_tryon(self, http, buyer_token, tryon_result):
        r = http.get(f"{API}/tryon/history", headers=_auth(buyer_token))
        assert r.status_code == 200
        hist = r.json()
        assert isinstance(hist, list) and hist
        match = next((h for h in hist if h["id"] == tryon_result["id"]), None)
        assert match is not None, "newly-created try-on missing from history"
        assert len(match.get("images") or []) == 3

    def test_history_legacy_tryons_have_images_array(self, http, buyer_token):
        """Legacy try-ons (pre-iteration-6) only had result_image_b64;
        endpoint must synthesize images=[{angle:'front', ...}] for them."""
        r = http.get(f"{API}/tryon/history", headers=_auth(buyer_token))
        assert r.status_code == 200
        hist = r.json()
        if len(hist) <= 1:
            pytest.skip("no legacy try-ons to verify")
        for h in hist:
            imgs = h.get("images") or []
            assert imgs, f"try-on {h['id']} returned empty images array"
            for img in imgs:
                assert img.get("angle") in {"front", "three_quarter", "side", "back"}
                assert isinstance(img.get("image_b64"), str) and len(img["image_b64"]) > 50


# ---------------------------------------------------------------------------
# 5. Share endpoint
# ---------------------------------------------------------------------------
class TestShareEndpoint:
    def test_share_existing_angle(self, http, buyer_token):
        tryon = TestMultiAngleTryOn.SHARED.get("tryon")
        if not tryon:
            pytest.skip("multi-angle try-on was skipped; share test depends on it")
        r = http.get(
            f"{API}/tryon/{tryon['id']}/share",
            headers=_auth(buyer_token),
            params={"fmt": "square", "angle": "side"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data.get("image_b64"), str) and len(data["image_b64"]) > 500
        assert "caption" in data

    def test_share_missing_angle_falls_back(self, http, buyer_token):
        """Pick an existing front+side tryon (if any) and request 'back' — must not 500."""
        r = http.get(f"{API}/tryon/history", headers=_auth(buyer_token))
        assert r.status_code == 200
        hist = r.json()
        target = None
        for h in hist:
            angles = {i["angle"] for i in (h.get("images") or [])}
            if "back" not in angles and angles:  # has some images but no back
                target = h
                break
        if not target:
            pytest.skip("no try-on without 'back' angle available for fallback test")
        r = http.get(
            f"{API}/tryon/{target['id']}/share",
            headers=_auth(buyer_token),
            params={"fmt": "square", "angle": "back"},
            timeout=30,
        )
        assert r.status_code == 200, (
            f"share should gracefully fall back to first available angle, got "
            f"{r.status_code}: {r.text[:300]}"
        )
        assert isinstance(r.json().get("image_b64"), str)


# ---------------------------------------------------------------------------
# 6. Checkout → Order currency
# ---------------------------------------------------------------------------
class TestCheckoutCurrency:
    def test_checkout_propagates_item_currency_to_order(self, http, seller_token, buyer_token):
        # Create a fresh item with a distinctive currency (EUR)
        payload = {
            "name": f"TEST_EUR_{uuid.uuid4().hex[:6]}",
            "description": "currency-tagged item for checkout test",
            "category": "shirts",
            "price_cents": 3500,
            "currency": "EUR",
            "image_b64": _png_b64((20, 80, 200)),
            "sizes": [{"label": "M", "available_qty": 1}],
            "colors": [],
        }
        r = http.post(f"{API}/items", headers=_auth(seller_token), json=payload)
        assert r.status_code == 200, r.text
        item = r.json()
        assert item["currency"] == "EUR"
        item_id = item["id"]

        try:
            # Checkout as buyer
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
            session_id = r.json()["session_id"]
            assert session_id.startswith("cs_test_")

            # Inspect order list — find the newly-created one
            r = http.get(f"{API}/orders", headers=_auth(buyer_token))
            assert r.status_code == 200
            orders = r.json()
            match = next((o for o in orders if o.get("session_id") == session_id), None)
            if match is None:
                # /orders may return a richer shape; check any order with our item_id
                match = next((o for o in orders if o.get("item_id") == item_id), None)
            assert match is not None, "could not locate just-created order in /orders"
            assert match.get("currency") == "EUR", (
                f"Order currency should match item currency EUR, got {match.get('currency')}"
            )
        finally:
            http.delete(f"{API}/items/{item_id}", headers=_auth(seller_token))

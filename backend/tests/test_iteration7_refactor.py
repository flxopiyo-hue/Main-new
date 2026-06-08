"""Iteration 7 regression tests for the AuraFit backend modular-router refactor.

The refactor split a 1784-line `server.py` into ~10 focused modules. This suite
verifies that the EXTERNAL API behaviour is unchanged versus iteration 6 and
also adds coverage for:

* Route-ordering invariants (`/items/mine`, `/collections/mine`, `/tryon/history`)
* Collections CRUD lifecycle
* Seller analytics + mocked Stripe Connect
* Currency precedence (explicit > seller preference > KES default)
* Multi-angle try-on (single angle to conserve Nano Banana credits) with
  graceful skip on LLM 5xx
* Share endpoint angle parameter + fallback
* Optional auth path (`try_get_user_from_creds`) via anonymous /items

Run:
    cd /app/backend && python -m pytest tests/test_iteration7_refactor.py -v \
        --junitxml=/app/test_reports/pytest/iteration7_results.xml
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
# Root + Auth basics
# ---------------------------------------------------------------------------
class TestRootAndAuth:
    def test_root(self, http):
        r = http.get(f"{API}/")
        assert r.status_code == 200
        body = r.json()
        assert body == {"app": "AuraFit", "status": "ok"}

    def test_register_default_currency_kes(self, http):
        email = f"TEST_refac_{uuid.uuid4().hex[:8]}@aurafit.demo"
        r = http.post(
            f"{API}/auth/register",
            json={
                "email": email,
                "password": "test-pass-2026",
                "full_name": "Refactor Test",
                "role": "buyer",
                "gender": "other",
                "age": 27,
            },
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data and isinstance(data["token"], str)
        assert data["user"]["preferred_currency"] == "KES"
        assert data["user"]["role"] == "buyer"

    def test_buyer_login_and_me(self, http, buyer_token):
        r = http.get(f"{API}/auth/me", headers=_auth(buyer_token))
        assert r.status_code == 200
        u = r.json()
        assert u["email"] == BUYER_EMAIL
        assert u["role"] == "buyer"
        assert "preferred_currency" in u

    def test_seller_login_and_me(self, http, seller_token):
        r = http.get(f"{API}/auth/me", headers=_auth(seller_token))
        assert r.status_code == 200
        u = r.json()
        assert u["email"] == SELLER_EMAIL
        assert u["role"] == "seller"
        assert "preferred_currency" in u


class TestPreferences:
    def test_patch_valid(self, http, buyer_token):
        r = http.patch(
            f"{API}/auth/preferences",
            headers=_auth(buyer_token),
            json={"preferred_currency": "USD"},
        )
        assert r.status_code == 200
        assert r.json()["preferred_currency"] == "USD"
        # restore
        http.patch(
            f"{API}/auth/preferences",
            headers=_auth(buyer_token),
            json={"preferred_currency": "KES"},
        )

    def test_patch_invalid_returns_422(self, http, buyer_token):
        r = http.patch(
            f"{API}/auth/preferences",
            headers=_auth(buyer_token),
            json={"preferred_currency": "XYZ"},
        )
        assert r.status_code == 422

    def test_patch_empty_returns_400(self, http, buyer_token):
        r = http.patch(
            f"{API}/auth/preferences",
            headers=_auth(buyer_token),
            json={},
        )
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# Items: anonymous list, /items/mine, /items/{id} view counter, PATCH, currency
# ---------------------------------------------------------------------------
class TestItems:
    def test_list_items_anonymous(self, http):
        r = http.get(f"{API}/items")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and data
        for it in data:
            assert "currency" in it and it["currency"]

    def test_list_items_authed_buyer(self, http, buyer_token):
        r = http.get(f"{API}/items", headers=_auth(buyer_token))
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_items_mine_resolves_to_my_items_route(self, http, seller_token):
        """Critical route-ordering invariant: /items/mine must NOT be swallowed by /items/{id}."""
        r = http.get(f"{API}/items/mine", headers=_auth(seller_token))
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # Every returned item must belong to the seller, proving this is the
        # `my_items` handler (not get_item with id='mine').
        seller_me = http.get(f"{API}/auth/me", headers=_auth(seller_token)).json()
        for it in data:
            assert it["seller_id"] == seller_me["id"]

    def test_get_item_increments_views_for_non_seller(self, http, buyer_token, seller_token):
        items = http.get(f"{API}/items/mine", headers=_auth(seller_token)).json()
        assert items, "seller has no items"
        target = items[0]
        item_id = target["id"]
        # Snapshot via direct seller-call (skipped counter) — we have to read views via analytics
        before = http.get(f"{API}/seller/analytics", headers=_auth(seller_token)).json()
        before_views = next(
            (i["views"] for i in before["items"] if i["item_id"] == item_id), 0
        )
        # Buyer GET → should count
        r = http.get(f"{API}/items/{item_id}", headers=_auth(buyer_token))
        assert r.status_code == 200
        # Seller GET → should NOT count (seller of this item)
        r2 = http.get(f"{API}/items/{item_id}", headers=_auth(seller_token))
        assert r2.status_code == 200
        after = http.get(f"{API}/seller/analytics", headers=_auth(seller_token)).json()
        after_views = next(
            (i["views"] for i in after["items"] if i["item_id"] == item_id), 0
        )
        # Buyer visit increments by exactly 1 (seller call doesn't count).
        assert after_views == before_views + 1, (
            f"views {before_views} -> {after_views}; expected exactly +1 from buyer call"
        )

    def test_create_item_inherits_seller_currency_when_omitted(self, http, seller_token):
        # Force seller to USD
        r = http.patch(
            f"{API}/auth/preferences",
            headers=_auth(seller_token),
            json={"preferred_currency": "USD"},
        )
        assert r.status_code == 200
        try:
            payload = {
                "name": f"TEST_REF_{uuid.uuid4().hex[:6]}",
                "description": "no-currency",
                "category": "shirts",
                "price_cents": 1234,
                "image_b64": _png_b64((10, 20, 30)),
                "sizes": [{"label": "M", "available_qty": 1}],
                "colors": [],
            }
            r = http.post(f"{API}/items", headers=_auth(seller_token), json=payload)
            assert r.status_code == 200, r.text
            item = r.json()
            try:
                assert item["currency"] == "USD", (
                    f"expected USD from seller preference, got {item['currency']}"
                )
            finally:
                http.delete(f"{API}/items/{item['id']}", headers=_auth(seller_token))
        finally:
            http.patch(
                f"{API}/auth/preferences",
                headers=_auth(seller_token),
                json={"preferred_currency": "KES"},
            )

    def test_create_item_explicit_currency_wins(self, http, seller_token):
        payload = {
            "name": f"TEST_REF_KES_{uuid.uuid4().hex[:6]}",
            "description": "explicit KES",
            "category": "shirts",
            "price_cents": 999,
            "currency": "KES",
            "image_b64": _png_b64((50, 80, 200)),
            "sizes": [{"label": "M", "available_qty": 2}],
            "colors": [],
        }
        r = http.post(f"{API}/items", headers=_auth(seller_token), json=payload)
        assert r.status_code == 200, r.text
        item = r.json()
        try:
            assert item["currency"] == "KES"
            verify = http.get(f"{API}/items/{item['id']}")
            assert verify.status_code == 200
            assert verify.json()["currency"] == "KES"
        finally:
            http.delete(f"{API}/items/{item['id']}", headers=_auth(seller_token))

    def test_patch_item_sizes(self, http, seller_token):
        # Create then patch
        payload = {
            "name": f"TEST_REF_PATCH_{uuid.uuid4().hex[:6]}",
            "description": "patch target",
            "category": "shirts",
            "price_cents": 500,
            "currency": "KES",
            "image_b64": _png_b64((90, 90, 90)),
            "sizes": [{"label": "S", "available_qty": 1}],
            "colors": [],
        }
        r = http.post(f"{API}/items", headers=_auth(seller_token), json=payload)
        assert r.status_code == 200
        item = r.json()
        try:
            r = http.patch(
                f"{API}/items/{item['id']}",
                headers=_auth(seller_token),
                json={"sizes": [
                    {"label": "S", "available_qty": 3},
                    {"label": "L", "available_qty": 5},
                ]},
            )
            assert r.status_code == 200, r.text
            updated = r.json()
            labels = sorted(s["label"] for s in updated["sizes"])
            assert labels == ["L", "S"]
            qtys = {s["label"]: s["available_qty"] for s in updated["sizes"]}
            assert qtys["S"] == 3 and qtys["L"] == 5
        finally:
            http.delete(f"{API}/items/{item['id']}", headers=_auth(seller_token))

    def test_feed_buyer(self, http, buyer_token):
        r = http.get(f"{API}/feed", headers=_auth(buyer_token))
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        for it in data:
            assert "currency" in it


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------
class TestProfile:
    def test_put_then_get_profile(self, http, buyer_token):
        photo = _png_b64((180, 160, 150))
        r = http.put(
            f"{API}/profile",
            headers=_auth(buyer_token),
            json={
                "measurements": {
                    "height_cm": 168, "chest_cm": 90, "waist_cm": 72, "hips_cm": 96,
                },
                "preferred_size": "M",
                "front_photo_b64": photo,
            },
        )
        assert r.status_code == 200, r.text
        r = http.get(f"{API}/profile", headers=_auth(buyer_token))
        assert r.status_code == 200
        p = r.json()
        assert p["preferred_size"] == "M"
        assert p["has_front_photo"] is True


# ---------------------------------------------------------------------------
# Wishlist
# ---------------------------------------------------------------------------
class TestWishlist:
    def test_add_list_ids_remove(self, http, buyer_token):
        items = http.get(f"{API}/items").json()
        assert items
        target = items[0]["id"]
        r = http.post(f"{API}/wishlist/{target}", headers=_auth(buyer_token))
        assert r.status_code == 200 and r.json()["ok"] is True
        # list
        r = http.get(f"{API}/wishlist", headers=_auth(buyer_token))
        assert r.status_code == 200
        wl = r.json()
        assert any(w["item"]["id"] == target for w in wl)
        assert all("restocked" in w for w in wl)
        # ids
        r = http.get(f"{API}/wishlist/ids", headers=_auth(buyer_token))
        assert r.status_code == 200
        assert target in r.json()["item_ids"]
        # remove
        r = http.delete(f"{API}/wishlist/{target}", headers=_auth(buyer_token))
        assert r.status_code == 200 and r.json()["ok"] is True
        r = http.get(f"{API}/wishlist/ids", headers=_auth(buyer_token))
        assert target not in r.json()["item_ids"]


# ---------------------------------------------------------------------------
# Try-on (1 angle to save credits) + share + history
# ---------------------------------------------------------------------------
class TestTryOnSingleAngle:
    SHARED: Dict[str, Any] = {}

    @pytest.fixture(scope="class")
    def tryon_result(self, http, buyer_token) -> Dict[str, Any]:
        items = http.get(f"{API}/items").json()
        assert items, "no items"
        item_id = items[0]["id"]
        # ensure profile photo
        photo = _png_b64((220, 200, 180))
        http.put(
            f"{API}/profile",
            headers=_auth(buyer_token),
            json={
                "measurements": {"height_cm": 168, "chest_cm": 90, "waist_cm": 72, "hips_cm": 96},
                "preferred_size": "M",
                "front_photo_b64": photo,
            },
        )
        start = time.time()
        r = http.post(
            f"{API}/tryon",
            headers=_auth(buyer_token),
            json={
                "item_id": item_id,
                "use_profile_photo": True,
                "angles": ["front"],
            },
            timeout=180,
        )
        elapsed = time.time() - start
        print(f"[tryon single-angle] status={r.status_code} elapsed={elapsed:.1f}s")
        if r.status_code >= 500:
            pytest.skip(
                f"LLM key exhausted / upstream failure ({r.status_code}); "
                f"recorded as known limitation: {r.text[:200]}"
            )
        assert r.status_code == 200, r.text
        data = r.json()
        TestTryOnSingleAngle.SHARED["tryon"] = data
        TestTryOnSingleAngle.SHARED["item_id"] = item_id
        return data

    def test_one_angle_returned(self, tryon_result):
        imgs = tryon_result.get("images") or []
        assert len(imgs) == 1, f"expected exactly 1 angle, got {len(imgs)}"
        assert imgs[0]["angle"] == "front"
        assert isinstance(imgs[0]["image_b64"], str) and len(imgs[0]["image_b64"]) > 200
        assert tryon_result["result_image_b64"] == imgs[0]["image_b64"]

    def test_history_contains_new_tryon(self, http, buyer_token, tryon_result):
        r = http.get(f"{API}/tryon/history", headers=_auth(buyer_token))
        assert r.status_code == 200
        hist = r.json()
        assert isinstance(hist, list) and hist
        # /tryon/history must NOT resolve to /tryon/{id}/share
        for h in hist:
            assert "images" in h and isinstance(h["images"], list)
            assert h["images"], f"history entry {h['id']} has empty images"
        match = next((h for h in hist if h["id"] == tryon_result["id"]), None)
        assert match is not None

    def test_share_existing_angle(self, http, buyer_token):
        tryon = TestTryOnSingleAngle.SHARED.get("tryon")
        if not tryon:
            pytest.skip("try-on creation skipped — share depends on it")
        r = http.get(
            f"{API}/tryon/{tryon['id']}/share",
            headers=_auth(buyer_token),
            params={"fmt": "square", "angle": "front"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data["image_b64"], str) and len(data["image_b64"]) > 500
        assert "caption" in data and data["caption"]

    def test_share_missing_angle_falls_back(self, http, buyer_token):
        tryon = TestTryOnSingleAngle.SHARED.get("tryon")
        if not tryon:
            pytest.skip("try-on creation skipped — share depends on it")
        # We only generated 'front' — request 'back' which is missing.
        r = http.get(
            f"{API}/tryon/{tryon['id']}/share",
            headers=_auth(buyer_token),
            params={"fmt": "story", "angle": "back"},
            timeout=30,
        )
        assert r.status_code == 200, (
            f"share should gracefully fall back when angle is missing, got "
            f"{r.status_code}: {r.text[:200]}"
        )
        data = r.json()
        assert isinstance(data["image_b64"], str) and len(data["image_b64"]) > 500


# ---------------------------------------------------------------------------
# Payments + Orders + Feedback
# ---------------------------------------------------------------------------
class TestPaymentsAndOrders:
    SHARED: Dict[str, Any] = {}

    def test_checkout_persists_order_with_currency(self, http, seller_token, buyer_token):
        # Create a fresh EUR item to verify currency propagates
        payload = {
            "name": f"TEST_REF_EUR_{uuid.uuid4().hex[:6]}",
            "description": "checkout test",
            "category": "shirts",
            "price_cents": 4500,
            "currency": "EUR",
            "image_b64": _png_b64((60, 60, 220)),
            "sizes": [{"label": "M", "available_qty": 1}],
            "colors": [],
        }
        r = http.post(f"{API}/items", headers=_auth(seller_token), json=payload)
        assert r.status_code == 200, r.text
        item = r.json()
        item_id = item["id"]
        try:
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
            checkout = r.json()
            assert checkout["session_id"].startswith("cs_test_")
            assert checkout["url"].startswith("https://")
            TestPaymentsAndOrders.SHARED["session_id"] = checkout["session_id"]
            TestPaymentsAndOrders.SHARED["item_id"] = item_id
            # Status endpoint
            r = http.get(
                f"{API}/payments/status/{checkout['session_id']}",
                headers=_auth(buyer_token),
            )
            assert r.status_code == 200, r.text
            status_body = r.json()
            assert status_body["session_id"] == checkout["session_id"]
            assert status_body["currency"] == "EUR"
            assert status_body["amount_cents"] == 4500
            # Orders listing
            r = http.get(f"{API}/orders", headers=_auth(buyer_token))
            assert r.status_code == 200
            orders = r.json()
            match = next(
                (o for o in orders if o["session_id"] == checkout["session_id"]), None
            )
            assert match is not None, "newly-created order missing from /orders"
            assert match["currency"] == "EUR"
            assert match["item_id"] == item_id
            TestPaymentsAndOrders.SHARED["order_id"] = match["id"]
            TestPaymentsAndOrders.SHARED["order_status"] = match["status"]
        finally:
            http.delete(f"{API}/items/{item_id}", headers=_auth(seller_token))

    def test_feedback_on_unpaid_returns_400(self, http, buyer_token):
        order_id = TestPaymentsAndOrders.SHARED.get("order_id")
        order_status = TestPaymentsAndOrders.SHARED.get("order_status")
        if not order_id:
            pytest.skip("no order created in previous test")
        if order_status == "paid":
            pytest.skip("order already paid — cannot exercise 400 path")
        r = http.post(
            f"{API}/orders/{order_id}/feedback",
            headers=_auth(buyer_token),
            json={"fit": "perfect"},
        )
        assert r.status_code == 400, (
            f"expected 400 on unpaid feedback, got {r.status_code}: {r.text}"
        )


# ---------------------------------------------------------------------------
# Seller analytics + Connect (mocked)
# ---------------------------------------------------------------------------
class TestSeller:
    def test_analytics(self, http, seller_token):
        r = http.get(f"{API}/seller/analytics", headers=_auth(seller_token))
        assert r.status_code == 200, r.text
        body = r.json()
        for key in (
            "total_views", "total_try_ons", "total_wishlists",
            "total_orders_paid", "total_revenue_cents", "items", "connect_status",
        ):
            assert key in body, f"missing field {key}"
        assert isinstance(body["items"], list)
        assert isinstance(body["total_revenue_cents"], int)

    def test_connect_setup_then_status(self, http, seller_token):
        r = http.post(f"{API}/seller/connect/setup", headers=_auth(seller_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["connect_status"] == "active"
        assert body.get("stripe_account_id")
        r = http.get(f"{API}/seller/connect/status", headers=_auth(seller_token))
        assert r.status_code == 200
        body = r.json()
        assert body["connect_status"] == "active"


# ---------------------------------------------------------------------------
# Collections: CRUD + /collections/mine route-ordering invariant
# ---------------------------------------------------------------------------
class TestCollections:
    def test_full_lifecycle(self, http, seller_token):
        # Use a seller-owned item as part of the collection
        items = http.get(f"{API}/items/mine", headers=_auth(seller_token)).json()
        assert items, "seller has no items to add to a collection"
        item_id = items[0]["id"]
        # Create
        name = f"TEST_REF_DROP_{uuid.uuid4().hex[:6]}"
        r = http.post(
            f"{API}/collections",
            headers=_auth(seller_token),
            json={
                "name": name,
                "description": "iteration 7 collection",
                "item_ids": [item_id],
            },
        )
        assert r.status_code == 200, r.text
        coll = r.json()
        coll_id = coll["id"]
        try:
            assert coll["name"] == name
            assert coll["item_ids"] == [item_id]
            # Public list (anonymous)
            r = http.get(f"{API}/collections")
            assert r.status_code == 200
            assert any(c["id"] == coll_id for c in r.json())
            # /collections/mine route ordering invariant
            r = http.get(f"{API}/collections/mine", headers=_auth(seller_token))
            assert r.status_code == 200, r.text
            mine = r.json()
            assert isinstance(mine, list)
            assert any(c["id"] == coll_id for c in mine), (
                "/collections/mine missed our collection — possible "
                "route-ordering regression (swallowed by /collections/{id})"
            )
            # GET /collections/{id}
            r = http.get(f"{API}/collections/{coll_id}")
            assert r.status_code == 200, r.text
            payload = r.json()
            assert "collection" in payload and "items" in payload
            assert payload["collection"]["id"] == coll_id
            assert isinstance(payload["items"], list)
            assert any(i["id"] == item_id for i in payload["items"])
        finally:
            r = http.delete(f"{API}/collections/{coll_id}", headers=_auth(seller_token))
            assert r.status_code == 200
            assert r.json()["ok"] is True

    def test_delete_others_collection_forbidden(self, http, seller_token, buyer_token):
        # Buyer should not be able to delete a seller's collection. The endpoint
        # also blocks via require_role implicit: buyer role can still call but
        # ownership check returns 403.
        # Create a temp collection as seller, then try to delete as buyer.
        r = http.post(
            f"{API}/collections",
            headers=_auth(seller_token),
            json={"name": f"TEST_OWN_{uuid.uuid4().hex[:6]}", "description": "x", "item_ids": []},
        )
        assert r.status_code == 200
        cid = r.json()["id"]
        try:
            r = http.delete(f"{API}/collections/{cid}", headers=_auth(buyer_token))
            assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        finally:
            http.delete(f"{API}/collections/{cid}", headers=_auth(seller_token))


# ---------------------------------------------------------------------------
# Route ordering — explicit smoke against literal vs. dynamic segments
# ---------------------------------------------------------------------------
class TestRouteOrderingInvariants:
    def test_items_mine_not_treated_as_id(self, http, seller_token):
        r = http.get(f"{API}/items/mine", headers=_auth(seller_token))
        # If `/items/{item_id}` swallowed `mine`, we'd see 404 "Item not found".
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_collections_mine_not_treated_as_id(self, http, seller_token):
        r = http.get(f"{API}/collections/mine", headers=_auth(seller_token))
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_tryon_history_not_treated_as_id(self, http, buyer_token):
        r = http.get(f"{API}/tryon/history", headers=_auth(buyer_token))
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

"""Iteration 30 regression: M-Pesa one-time premium checkout + colour photo groups.

Coverage:
  * POST /api/subs/checkout method=mpesa / card / default / paypal(invalid)
  * GET /api/subs/me subscription.one_time boolean present
  * Direct-mongo simulate premium_one_time=true w/ expired current_period_end
    → gate.premium == False (then restore)
  * /api/subs/cancel returns 400 friendly for one-time pass holders
  * Items POST/PATCH colours[].images normalization + hero mirror
  * Existing regression: items list/search, item detail, categories
"""

from __future__ import annotations

import base64
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/") or \
    "https://fit-finder-app-5.preview.emergentagent.com"
API = f"{BASE_URL}/api"

BUYER = {"email": "buyer@aurafit.com", "password": "demo-buyer-2026"}
SELLER = {"email": "atelier@aurafit.com", "password": "demo-seller-2026"}

# Tiny 1x1 PNG base64 (valid) — used as photo payload.
PIXEL_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0"
    "C8AAAAASUVORK5CYII="
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def buyer_token() -> str:
    r = requests.post(f"{API}/auth/login", json=BUYER, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def seller_token() -> str:
    r = requests.post(f"{API}/auth/login", json=SELLER, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def mongo():
    url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "aurafit")
    client = MongoClient(url)
    yield client[db_name]
    client.close()


def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# /subs/checkout — method routing
# ---------------------------------------------------------------------------
class TestSubsCheckoutMethods:
    """INITIALIZATION-ONLY — never opens the Paystack page."""

    def test_checkout_mpesa_returns_authorization_url(self, buyer_token):
        r = requests.post(
            f"{API}/subs/checkout",
            json={"method": "mpesa"},
            headers=_auth(buyer_token),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "authorization_url" in body and "reference" in body
        assert "checkout.paystack.com" in body["authorization_url"]

    def test_checkout_card_returns_authorization_url(self, buyer_token):
        r = requests.post(
            f"{API}/subs/checkout",
            json={"method": "card"},
            headers=_auth(buyer_token),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "checkout.paystack.com" in body["authorization_url"]

    def test_checkout_default_no_body_is_card(self, buyer_token):
        r = requests.post(
            f"{API}/subs/checkout",
            headers=_auth(buyer_token),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert "checkout.paystack.com" in r.json()["authorization_url"]

    def test_checkout_invalid_method_paypal_returns_400(self, buyer_token):
        r = requests.post(
            f"{API}/subs/checkout",
            json={"method": "paypal"},
            headers=_auth(buyer_token),
            timeout=30,
        )
        assert r.status_code == 400, r.text
        detail = (r.json().get("detail") or "").lower()
        assert "card" in detail and "mpesa" in detail


# ---------------------------------------------------------------------------
# /subs/me shape
# ---------------------------------------------------------------------------
class TestSubsMeOneTimeFlag:
    def test_me_includes_one_time_boolean(self, buyer_token):
        r = requests.get(f"{API}/subs/me", headers=_auth(buyer_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "subscription" in body and "gate" in body
        sub = body["subscription"]
        assert "one_time" in sub, "subscription.one_time must be present"
        assert isinstance(sub["one_time"], bool)
        # Buyer must be free by default per test_credentials.md.
        assert sub["tier"] == "free"
        assert sub["one_time"] is False


# ---------------------------------------------------------------------------
# is_premium() expiry semantics for one-time pass
# ---------------------------------------------------------------------------
class TestOneTimePassExpiryGating:
    """Simulate an EXPIRED premium_one_time via direct mongo → gate.premium=False.
    Restores buyer state afterwards no matter what."""

    def test_expired_one_time_pass_treated_as_free(self, buyer_token, mongo):
        # Snapshot current buyer state so we can restore it exactly.
        user = mongo.users.find_one({"email": BUYER["email"]})
        assert user is not None
        snapshot = {
            k: user.get(k)
            for k in (
                "subscription_tier",
                "subscription_status",
                "premium_one_time",
                "current_period_end",
                "trial_end",
                "cancel_at_period_end",
            )
        }
        try:
            past = datetime.now(timezone.utc) - timedelta(days=2)
            mongo.users.update_one(
                {"email": BUYER["email"]},
                {
                    "$set": {
                        "subscription_tier": "premium",
                        "subscription_status": "active",
                        "premium_one_time": True,
                        "current_period_end": past,
                        "trial_end": None,
                        "cancel_at_period_end": False,
                    }
                },
            )
            r = requests.get(
                f"{API}/subs/me", headers=_auth(buyer_token), timeout=30
            )
            assert r.status_code == 200, r.text
            body = r.json()
            # Even though tier=premium in DB, gate must recognise pass as expired.
            assert body["gate"]["premium"] is False, body
            # subscription.one_time still reflects flag on the doc.
            assert body["subscription"]["one_time"] is True
        finally:
            mongo.users.update_one(
                {"email": BUYER["email"]},
                {"$set": snapshot},
            )

    def test_cancel_rejects_one_time_pass_with_friendly_message(
        self, buyer_token, mongo
    ):
        user = mongo.users.find_one({"email": BUYER["email"]})
        snapshot = {
            k: user.get(k)
            for k in (
                "subscription_tier",
                "subscription_status",
                "premium_one_time",
                "current_period_end",
                "cancel_at_period_end",
            )
        }
        try:
            future = datetime.now(timezone.utc) + timedelta(days=15)
            mongo.users.update_one(
                {"email": BUYER["email"]},
                {
                    "$set": {
                        "subscription_tier": "premium",
                        "subscription_status": "active",
                        "premium_one_time": True,
                        "current_period_end": future,
                        "cancel_at_period_end": False,
                    }
                },
            )
            r = requests.post(
                f"{API}/subs/cancel", headers=_auth(buyer_token), timeout=30
            )
            assert r.status_code == 400, r.text
            detail = (r.json().get("detail") or "").lower()
            assert "auto-renew" in detail or "doesn't auto" in detail
        finally:
            mongo.users.update_one(
                {"email": BUYER["email"]},
                {"$set": snapshot},
            )


# ---------------------------------------------------------------------------
# Colour photo groups — POST/PATCH normalization
# ---------------------------------------------------------------------------
class TestItemColorImages:
    """Verify _normalize_color strips data: prefixes, caps at 5, mirrors hero,
    and legacy image_b64-only payloads get wrapped into images."""

    @pytest.fixture
    def created_item_id(self, seller_token):
        payload = {
            "name": "TEST_iter30_color_group",
            "description": "colour photo group test",
            "category": "shirts",
            "price_cents": 500000,
            "image_b64": PIXEL_B64,
            "sizes": [{"label": "M", "available_qty": 3}],
            "colors": [
                {
                    "name": "Black",
                    "hex": "#000000",
                    # Two with data prefix, one raw — total 3.
                    "images": [
                        f"data:image/png;base64,{PIXEL_B64}",
                        f"data:image/jpeg;base64,{PIXEL_B64}",
                        PIXEL_B64,
                    ],
                },
                {
                    "name": "White",
                    "hex": "#FFFFFF",
                    # Legacy: only image_b64, no `images` — must be wrapped.
                    "image_b64": f"data:image/png;base64,{PIXEL_B64}",
                },
            ],
            "audience": "unisex",
        }
        r = requests.post(
            f"{API}/items", json=payload, headers=_auth(seller_token), timeout=60
        )
        assert r.status_code == 200, r.text
        item = r.json()
        yield item["id"]
        # Cleanup
        requests.delete(
            f"{API}/items/{item['id']}", headers=_auth(seller_token), timeout=30
        )

    def test_post_normalizes_data_prefix_and_mirrors_hero(
        self, seller_token, created_item_id
    ):
        r = requests.get(f"{API}/items/{created_item_id}", timeout=30)
        assert r.status_code == 200, r.text
        item = r.json()
        colors = {c["name"]: c for c in item["colors"]}

        black = colors["Black"]
        assert len(black["images"]) == 3
        for img in black["images"]:
            assert not img.startswith("data:"), "data: prefix must be stripped"
        # image_b64 must mirror images[0]
        assert black["image_b64"] == black["images"][0]

        white = colors["White"]
        # Legacy payload wrapped into images[]
        assert len(white["images"]) == 1
        assert not white["images"][0].startswith("data:")
        assert white["image_b64"] == white["images"][0]

    def test_patch_reorder_updates_hero_mirror(
        self, seller_token, created_item_id
    ):
        # Fetch existing to get raw images.
        r = requests.get(f"{API}/items/{created_item_id}", timeout=30)
        black = next(c for c in r.json()["colors"] if c["name"] == "Black")
        orig_first, orig_second = black["images"][0], black["images"][1]
        # Reorder: put second first.
        reordered = [orig_second, orig_first] + black["images"][2:]
        patch = {
            "colors": [
                {"name": "Black", "hex": "#000000", "images": reordered},
                {"name": "White", "hex": "#FFFFFF", "images": [PIXEL_B64]},
            ]
        }
        rp = requests.patch(
            f"{API}/items/{created_item_id}",
            json=patch,
            headers=_auth(seller_token),
            timeout=60,
        )
        assert rp.status_code == 200, rp.text
        updated = rp.json()
        black_after = next(c for c in updated["colors"] if c["name"] == "Black")
        assert black_after["images"][0] == orig_second
        assert black_after["image_b64"] == orig_second, "hero mirror must follow"

    def test_max_5_images_enforced(self, seller_token, created_item_id):
        # Pydantic max_length=5 rejects >5 up-front with a 422.
        over_cap = {
            "colors": [
                {"name": "Black", "hex": "#000000", "images": [PIXEL_B64] * 8},
            ]
        }
        rp = requests.patch(
            f"{API}/items/{created_item_id}",
            json=over_cap,
            headers=_auth(seller_token),
            timeout=60,
        )
        assert rp.status_code == 422, rp.text
        # Exactly 5 is accepted and persisted.
        ok = {
            "colors": [
                {"name": "Black", "hex": "#000000", "images": [PIXEL_B64] * 5},
                {"name": "White", "hex": "#FFFFFF", "images": [PIXEL_B64]},
            ]
        }
        r2 = requests.patch(
            f"{API}/items/{created_item_id}",
            json=ok,
            headers=_auth(seller_token),
            timeout=60,
        )
        assert r2.status_code == 200, r2.text
        black = next(c for c in r2.json()["colors"] if c["name"] == "Black")
        assert len(black["images"]) == 5


# ---------------------------------------------------------------------------
# Regression: items list/search + categories still work
# ---------------------------------------------------------------------------
class TestRegressionBasics:
    def test_items_list_ok(self):
        r = requests.get(f"{API}/items", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_items_search_special_char_no_500(self):
        r = requests.get(f"{API}/items", params={"q": "("}, timeout=30)
        assert r.status_code == 200, r.text

    def test_categories_endpoint_ok(self):
        r = requests.get(f"{API}/categories", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) > 0

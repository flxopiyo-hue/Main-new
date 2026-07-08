"""Iteration 18 backend tests — orders history, seller_verified badge,
restock notify-me, Paystack subs checkout/me, and paywall gating.
"""
from __future__ import annotations

import os
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = (os.environ.get("EXPO_BACKEND_URL")
            or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or "https://fit-finder-app-5.preview.emergentagent.com").rstrip("/")

BUYER = {"email": "buyer@aurafit.com", "password": "demo-buyer-2026"}
SELLER = {"email": "atelier@aurafit.com", "password": "demo-seller-2026"}
ADMIN = {"email": "admin@drape.app", "password": "drape-admin-2026"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def buyer_headers():
    return {"Authorization": f"Bearer {_login(BUYER)}"}


@pytest.fixture(scope="module")
def seller_headers():
    return {"Authorization": f"Bearer {_login(SELLER)}"}


# --- Orders history ------------------------------------------------------
class TestOrdersHistory:
    def test_orders_ok_and_sorted_desc(self, buyer_headers):
        r = requests.get(f"{BASE_URL}/api/orders", headers=buyer_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # sorted newest-first
        if len(data) >= 2:
            ts = [o["created_at"] for o in data]
            assert ts == sorted(ts, reverse=True), "orders not newest-first"
        for o in data:
            assert "id" in o and "item_name" in o and "status" in o

    def test_orders_status_bucket_filter(self, buyer_headers):
        # status_bucket param — verify it doesn't 500 and returns list
        for bucket in ["all", "pending", "paid", "shipped", "delivered"]:
            r = requests.get(
                f"{BASE_URL}/api/orders?status_bucket={bucket}",
                headers=buyer_headers, timeout=15,
            )
            # It's OK if the backend ignores unknown params — just no 5xx.
            assert r.status_code < 500, f"{bucket} → {r.status_code}"


# --- Seller verified badge ----------------------------------------------
class TestSellerVerified:
    def test_items_list_returns_seller_verified(self):
        r = requests.get(f"{BASE_URL}/api/items", timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()
        assert items, "expected some items in catalogue"
        # every ItemOut should carry the field
        for it in items:
            assert "seller_verified" in it, f"missing seller_verified on {it.get('id')}"
        # at least one item from atelier should be seller_verified=true
        assert any(i.get("seller_verified") is True for i in items), \
            "expected at least one seller_verified item (atelier@aurafit.com)"

    def test_item_detail_returns_seller_verified(self):
        r = requests.get(f"{BASE_URL}/api/items", timeout=15)
        items = r.json()
        target = next((i for i in items if i.get("seller_verified")), None)
        assert target, "no seller_verified item found"
        r = requests.get(f"{BASE_URL}/api/items/{target['id']}", timeout=15)
        assert r.status_code == 200
        detail = r.json()
        assert detail.get("seller_verified") is True


# --- Restock notify-me --------------------------------------------------
class TestRestockNotify:
    @pytest.fixture(scope="class")
    def item_and_size(self):
        r = requests.get(f"{BASE_URL}/api/items", timeout=15)
        items = r.json()
        # Pick any item with at least one size
        for it in items:
            sizes = it.get("sizes") or []
            if sizes:
                return it["id"], sizes[0]["label"]
        pytest.skip("no items with sizes available")

    def test_seller_cannot_subscribe(self, seller_headers, item_and_size):
        item_id, size = item_and_size
        r = requests.post(
            f"{BASE_URL}/api/items/{item_id}/notify",
            params={"size": size}, headers=seller_headers, timeout=15,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_buyer_subscribe_status_unsubscribe(self, buyer_headers, item_and_size):
        item_id, size = item_and_size
        # subscribe
        r = requests.post(
            f"{BASE_URL}/api/items/{item_id}/notify",
            params={"size": size}, headers=buyer_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("subscribed") is True
        # status
        r = requests.get(
            f"{BASE_URL}/api/items/{item_id}/notify",
            params={"size": size}, headers=buyer_headers, timeout=15,
        )
        assert r.status_code == 200
        assert r.json().get("subscribed") is True
        # my list contains it
        r = requests.get(
            f"{BASE_URL}/api/notifications/restock", headers=buyer_headers, timeout=15
        )
        assert r.status_code == 200
        assert any(n["item_id"] == item_id and n["size"] == size for n in r.json())
        # unsubscribe
        r = requests.delete(
            f"{BASE_URL}/api/items/{item_id}/notify",
            params={"size": size}, headers=buyer_headers, timeout=15,
        )
        assert r.status_code == 200
        assert r.json().get("subscribed") is False


# --- Restock fanout on qty flip 0 -> >0 ---------------------------------
class TestRestockFanout:
    def test_fanout_on_size_qty_flip(self, buyer_headers, seller_headers):
        # 1) seller creates a fresh item with size M, qty=0
        item_body = {
            "name": f"TEST_restock_{uuid.uuid4().hex[:6]}",
            "description": "Restock test item",
            "category": "shirts",
            "price_cents": 500000,
            "currency": "KES",
            "image_b64": (
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII="
            ),
            "sizes": [{"label": "M", "available_qty": 0}],
            "colors": [{"name": "black", "hex": "#000000"}],
            "audience": "unisex",
        }
        r = requests.post(f"{BASE_URL}/api/items", json=item_body, headers=seller_headers, timeout=20)
        assert r.status_code == 200, r.text
        item_id = r.json()["id"]

        # 2) buyer subscribes to restock on size M
        r = requests.post(
            f"{BASE_URL}/api/items/{item_id}/notify",
            params={"size": "M"}, headers=buyer_headers, timeout=15,
        )
        assert r.status_code == 200

        # 3) seller PATCHes sizes: qty 0 -> 5
        r = requests.patch(
            f"{BASE_URL}/api/items/{item_id}",
            json={"sizes": [{"label": "M", "available_qty": 5}]},
            headers=seller_headers, timeout=15,
        )
        assert r.status_code == 200, r.text

        # 4) buyer's restock list should show notified_at set
        r = requests.get(f"{BASE_URL}/api/notifications/restock", headers=buyer_headers, timeout=15)
        assert r.status_code == 200
        row = next((n for n in r.json() if n["item_id"] == item_id and n["size"] == "M"), None)
        assert row, "buyer's restock notification row missing"
        assert row.get("notified_at"), "notified_at was not populated on qty flip"

        # cleanup
        requests.delete(f"{BASE_URL}/api/items/{item_id}", headers=seller_headers, timeout=10)


# --- /api/subs/me -------------------------------------------------------
class TestSubsMe:
    def test_me_shape_for_buyer(self, buyer_headers):
        r = requests.get(f"{BASE_URL}/api/subs/me", headers=buyer_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "subscription" in data and "gate" in data
        sub = data["subscription"]
        gate = data["gate"]
        assert sub.get("tier") in ("free", "premium")
        # gate keys
        for k in ("premium", "tryons_used_this_week", "tryons_limit",
                  "profiles_count", "profiles_limit", "multi_angle_allowed"):
            assert k in gate, f"gate missing {k}"


# --- /api/subs/checkout -------------------------------------------------
class TestSubsCheckout:
    def test_checkout_returns_paystack_url(self, buyer_headers):
        r = requests.post(f"{BASE_URL}/api/subs/checkout", headers=buyer_headers, timeout=25)
        # buyer may already be premium from prior runs — accept 400 with that reason
        if r.status_code == 400 and "Already subscribed" in r.text:
            pytest.skip("buyer already premium from earlier test run")
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "authorization_url" in data and "reference" in data
        assert data["authorization_url"].startswith("https://checkout.paystack.com/"), \
            data["authorization_url"]


# --- Paywall gating -----------------------------------------------------
class TestPaywallGating:
    """Directly seed 7 tryon rows for buyer via a small helper endpoint
    isn't available — so we hit /tryon 7 times and assert the 8th call
    returns 402 with paywall payload. If any earlier call already returns
    402 (buyer already at limit), we still validate the payload.
    """

    def _seed_tryons(self, user_id: str, count: int):
        """Seed tryon rows directly in mongo for the buyer."""
        from pymongo import MongoClient
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]
        client = MongoClient(mongo_url)
        db = client[db_name]
        now = datetime.now(timezone.utc)
        seeded_ids = []
        for i in range(count):
            _id = f"TEST_paywall_tryon_{uuid.uuid4().hex[:8]}"
            db.tryons.insert_one({
                "id": _id,
                "user_id": user_id,
                "item_id": "nonexistent",
                "created_at": now - timedelta(hours=i),
                "size": "M",
            })
            seeded_ids.append(_id)
        client.close()
        return seeded_ids

    def _cleanup_tryons(self, ids):
        from pymongo import MongoClient
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]
        client = MongoClient(mongo_url)
        db = client[db_name]
        db.tryons.delete_many({"id": {"$in": ids}})
        client.close()

    def test_tryon_paywall_after_limit(self, buyer_headers):
        # Load MONGO_URL from backend/.env if not in env
        if not os.environ.get("MONGO_URL"):
            try:
                from dotenv import load_dotenv
                load_dotenv("/app/backend/.env")
            except ImportError:
                pass
        if not os.environ.get("MONGO_URL"):
            pytest.skip("MONGO_URL not accessible for direct seeding")
        # Fetch buyer id
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=buyer_headers, timeout=15)
        assert r.status_code == 200
        user = r.json()
        if user.get("subscription_tier") == "premium":
            pytest.skip("buyer is premium, gating disabled")
        buyer_id = user["id"]
        # Snapshot current tryons_used_this_week
        r = requests.get(f"{BASE_URL}/api/subs/me", headers=buyer_headers, timeout=15)
        gate = r.json()["gate"]
        used = int(gate.get("tryons_used_this_week", 0))
        limit = int(gate.get("tryons_limit", 7))
        need = max(0, limit - used)
        seeded = self._seed_tryons(buyer_id, need)
        try:
            r = requests.post(
                f"{BASE_URL}/api/tryon",
                headers=buyer_headers,
                json={"item_id": "nonexistent", "size": "M"},
                timeout=20,
            )
            assert r.status_code == 402, f"expected 402 paywall, got {r.status_code}: {r.text}"
            detail = r.json().get("detail", {})
            assert detail.get("code") == "paywall"
            assert detail.get("feature") == "tryon_weekly_limit"
        finally:
            self._cleanup_tryons(seeded)

    def test_loved_ones_paywall_when_full(self, buyer_headers):
        if not os.environ.get("MONGO_URL"):
            try:
                from dotenv import load_dotenv
                load_dotenv("/app/backend/.env")
            except ImportError:
                pass
        if not os.environ.get("MONGO_URL"):
            pytest.skip("MONGO_URL not accessible for direct seeding")
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=buyer_headers, timeout=15)
        user = r.json()
        if user.get("subscription_tier") == "premium":
            pytest.skip("buyer is premium")
        r = requests.get(f"{BASE_URL}/api/subs/me", headers=buyer_headers, timeout=15)
        gate = r.json()["gate"]
        prof_count = int(gate.get("profiles_count", 0))
        prof_limit = int(gate.get("profiles_limit", 2))
        # Seed profiles to reach limit
        from pymongo import MongoClient
        client = MongoClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        seeded = []
        need = max(0, prof_limit - prof_count)
        for _ in range(need):
            pid = f"TEST_paywall_profile_{uuid.uuid4().hex[:8]}"
            db.body_profiles.insert_one({
                "id": pid,
                "user_id": user["id"],
                "nickname": "TEST",
                "measurements": {},
                "created_at": datetime.now(timezone.utc),
            })
            seeded.append(pid)
        try:
            # POST /loved-ones should now 402
            r = requests.post(
                f"{BASE_URL}/api/loved-ones",
                headers=buyer_headers,
                json={"name": "TEST_paywall", "audience": "adult", "relationship": "friend"},
                timeout=15,
            )
            assert r.status_code == 402, f"expected 402, got {r.status_code}: {r.text}"
            detail = r.json().get("detail", {})
            assert detail.get("code") == "paywall"
            assert detail.get("feature") == "profile_limit"
        finally:
            db.body_profiles.delete_many({"id": {"$in": seeded}})
            client.close()

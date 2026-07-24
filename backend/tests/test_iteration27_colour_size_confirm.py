"""Iteration 27 backend tests.

Covers:
  1. POST /api/tryon accepts optional `color_name` field (validation)
  2. POST /api/orders/{id}/confirm-delivery from `shipped` status
     - happy path releases escrow (seller_no_recipient, no live transfer)
     - 400 when status='paid'
     - 403 for wrong buyer
  3. POST /api/items still validates: sizes with any measurement OK,
     waist labels like '34' and 'UK 12' persist fine
"""

from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api" if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else "https://fit-finder-app-5.preview.emergentagent.com/api"
BUYER = {"email": "buyer@aurafit.com", "password": "demo-buyer-2026"}
SELLER = {"email": "atelier@aurafit.com", "password": "demo-seller-2026"}

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
mongo = MongoClient(MONGO_URL)
db = mongo["aurafit"]

created_orders: list[str] = []


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _login(creds):
    r = requests.post(f"{BASE}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def buyer_token():
    return _login(BUYER)


@pytest.fixture(scope="module")
def seller_token():
    return _login(SELLER)


@pytest.fixture(scope="module")
def buyer_me(buyer_token):
    r = requests.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {buyer_token}"}, timeout=30)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def seller_me(seller_token):
    r = requests.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {seller_token}"}, timeout=30)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    if created_orders:
        db.orders.delete_many({"id": {"$in": created_orders}})
        db.payouts.delete_many({"order_id": {"$in": created_orders}})


def _make_shipped_order(buyer_id: str, seller_id: str, status: str = "shipped") -> str:
    order_id = f"TEST_{uuid.uuid4()}"
    now = datetime.now(timezone.utc)
    doc = {
        "id": order_id,
        "buyer_id": buyer_id,
        "seller_id": seller_id,
        "item_id": "test-item",
        "item_name": "TEST_shipped_item",
        "size": "M",
        "color": None,
        "amount_cents": 100000,
        "currency": "KES",
        "paystack_currency": "KES",
        "platform_fee_cents": 15000,
        "seller_net_cents": 85000,
        "status": status,
        "session_id": f"cs_test_{uuid.uuid4().hex[:16]}",
        "created_at": now,
    }
    db.orders.insert_one(doc)
    created_orders.append(order_id)
    return order_id


# ---------------------------------------------------------------------------
# 1) POST /api/tryon — color_name field is optional and accepted
# ---------------------------------------------------------------------------

class TestTryonColorName:
    def test_tryon_accepts_color_name_field(self, buyer_token):
        """Validates payload with color_name is accepted (schema-wise).
        We intentionally omit the body photo so the endpoint responds
        400 with a body-photo message — proving the color_name field
        did NOT trigger a 422 validation error.
        """
        r = requests.post(
            f"{BASE}/tryon",
            headers={"Authorization": f"Bearer {buyer_token}"},
            json={
                "item_id": "does-not-exist-item-id",
                "color_name": "Coral",
                "use_profile_photo": False,
                "angles": ["front"],
            },
            timeout=30,
        )
        # Should NOT be 422 (schema accepts color_name)
        assert r.status_code != 422, f"color_name rejected by schema: {r.text}"
        # Item lookup / paywall / no-body-photo — all prove schema OK.
        # 402 = weekly cap paywall (fired AFTER schema validation → schema OK).
        assert r.status_code in (400, 402, 404), f"unexpected {r.status_code}: {r.text}"


# ---------------------------------------------------------------------------
# 2) POST /api/orders/{id}/confirm-delivery
# ---------------------------------------------------------------------------

class TestConfirmDelivery:
    def test_confirm_from_shipped_releases_escrow(self, buyer_token, buyer_me, seller_me):
        oid = _make_shipped_order(buyer_me["id"], seller_me["id"], status="shipped")
        r = requests.post(
            f"{BASE}/orders/{oid}/confirm-delivery",
            headers={"Authorization": f"Bearer {buyer_token}"},
            timeout=30,
        )
        assert r.status_code == 200, f"confirm-delivery failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["status"] == "delivered", f"status not promoted: {body.get('status')}"
        assert body.get("buyer_confirmed_at"), "buyer_confirmed_at not set"

        # Payout row: released + seller_no_recipient failure reason
        payout = db.payouts.find_one({"order_id": oid})
        assert payout is not None, "no payout row created"
        assert payout["status"] == "released", f"payout status={payout['status']}"
        assert payout.get("failure_reason") == "seller_no_recipient", (
            f"expected seller_no_recipient, got {payout.get('failure_reason')}"
        )
        # No live transfer initiated
        assert payout.get("paystack_transfer_code") is None

    def test_confirm_from_paid_rejected(self, buyer_token, buyer_me, seller_me):
        oid = _make_shipped_order(buyer_me["id"], seller_me["id"], status="paid")
        r = requests.post(
            f"{BASE}/orders/{oid}/confirm-delivery",
            headers={"Authorization": f"Bearer {buyer_token}"},
            timeout=30,
        )
        assert r.status_code == 400, f"expected 400 for paid status, got {r.status_code}: {r.text}"

    def test_confirm_wrong_buyer_forbidden(self, seller_token, buyer_me, seller_me):
        """Seller (not the buyer) tries to confirm — expect 403."""
        oid = _make_shipped_order(buyer_me["id"], seller_me["id"], status="shipped")
        r = requests.post(
            f"{BASE}/orders/{oid}/confirm-delivery",
            headers={"Authorization": f"Bearer {seller_token}"},
            timeout=30,
        )
        assert r.status_code == 403, f"expected 403 for wrong buyer, got {r.status_code}: {r.text}"


# ---------------------------------------------------------------------------
# 3) POST /api/items — sizes with any single measurement + waist labels
# ---------------------------------------------------------------------------

TINY_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


class TestItemsWaistLabels:
    def test_create_item_with_waist_and_uk_labels_persists(self, seller_token):
        payload = {
            "name": f"TEST_waist_uk_{uuid.uuid4().hex[:6]}",
            "description": "waist size labels persist test",
            "category": "pants",
            "price_cents": 350000,
            "currency": "KES",
            "image_b64": TINY_PNG,
            # Two sizes — one waist inches, one UK women.
            # Each has ONLY ONE measurement (waist_cm), proving the
            # "at least one measurement per size" rule (not chest-only).
            "sizes": [
                {"label": "34", "waist_cm": 86, "available_qty": 5},
                {"label": "UK 12", "waist_cm": 78, "available_qty": 3},
            ],
            "colors": [{"name": "Black", "hex": "#000000"}],
            "audience": "men",
        }
        r = requests.post(
            f"{BASE}/items",
            headers={"Authorization": f"Bearer {seller_token}"},
            json=payload,
            timeout=30,
        )
        assert r.status_code in (200, 201), f"create failed: {r.status_code} {r.text}"
        item = r.json()
        item_id = item["id"]

        # Verify persistence via GET
        r2 = requests.get(f"{BASE}/items/{item_id}", timeout=30)
        assert r2.status_code == 200
        fetched = r2.json()
        labels = sorted(s["label"] for s in fetched["sizes"])
        assert labels == ["34", "UK 12"], f"labels mismatch: {labels}"
        # Only waist_cm populated, chest_cm None — passes the "any one" rule
        waist_sizes = {s["label"]: s.get("waist_cm") for s in fetched["sizes"]}
        assert waist_sizes["34"] == 86
        assert waist_sizes["UK 12"] == 78

        # Cleanup
        requests.delete(
            f"{BASE}/items/{item_id}",
            headers={"Authorization": f"Bearer {seller_token}"},
            timeout=30,
        )

    def test_create_item_without_any_sizes_note(self, seller_token):
        """SOFT observation: backend does NOT currently reject empty
        ``sizes=[]`` (Pydantic accepts an empty list; the "at least one
        size" rule is enforced only client-side in the seller wizard).
        This test just documents the behaviour and cleans up.
        """
        payload = {
            "name": f"TEST_nosizes_{uuid.uuid4().hex[:6]}",
            "description": "no sizes",
            "category": "pants",
            "price_cents": 100000,
            "currency": "KES",
            "image_b64": TINY_PNG,
            "sizes": [],
            "audience": "men",
        }
        r = requests.post(
            f"{BASE}/items",
            headers={"Authorization": f"Bearer {seller_token}"},
            json=payload,
            timeout=30,
        )
        # Document current behaviour (200 = permissive; 400/422 = strict).
        assert r.status_code in (200, 400, 422)
        if r.status_code == 200:
            # Cleanup
            item_id = r.json()["id"]
            requests.delete(
                f"{BASE}/items/{item_id}",
                headers={"Authorization": f"Bearer {seller_token}"},
                timeout=30,
            )

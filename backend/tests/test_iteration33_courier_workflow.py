"""Iteration 33 — new seller courier workflow + delivery gating.

Scenarios:
  1. Checkout: delivery_option='pickup' → 422; 'door' → Paystack init URL.
  2. Seller fulfillment state machine on a synthetic paid order (courier path).
  3. Rider lifecycle: sees job, accepts, picks up, delivers with handover code.
  4. Self-ship path on a second synthetic order (no courier).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fit-finder-app-5.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "aurafit")

BUYER = {"email": "buyer@aurafit.com", "password": "demo-buyer-2026"}
SELLER = {"email": "atelier@aurafit.com", "password": "demo-seller-2026"}
RIDER = {"email": "test_rider_fc0de2@test.com", "password": "rider-pass-123"}


def _login(email: str, password: str) -> Dict[str, Any]:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def buyer_token() -> str:
    return _login(**BUYER)["token"]


@pytest.fixture(scope="module")
def seller_auth() -> Dict[str, Any]:
    d = _login(**SELLER)
    return {"token": d["token"], "user": d["user"]}


@pytest.fixture(scope="module")
def buyer_auth() -> Dict[str, Any]:
    d = _login(**BUYER)
    return {"token": d["token"], "user": d["user"]}


@pytest.fixture(scope="module")
def rider_token() -> str:
    return _login(**RIDER)["token"]


@pytest.fixture(scope="module")
def mongo():
    cli = MongoClient(MONGO_URL)
    yield cli[DB_NAME]
    cli.close()


# ---------------------------------------------------------------------------
# 1. Checkout delivery_option validation
# ---------------------------------------------------------------------------
def _pick_address(buyer_token: str) -> str:
    r = requests.get(f"{BASE_URL}/api/addresses", headers={"Authorization": f"Bearer {buyer_token}"}, timeout=20)
    assert r.status_code == 200, r.text
    addrs = r.json()
    if not addrs:
        # create a Nairobi address
        payload = {
            "label": "home", "recipient_name": "Test Buyer", "phone": "0712345678",
            "street": "Kimathi", "area": "CBD", "city": "Nairobi", "country": "Kenya",
        }
        r = requests.post(f"{BASE_URL}/api/addresses", json=payload,
                          headers={"Authorization": f"Bearer {buyer_token}"}, timeout=20)
        assert r.status_code in (200, 201), r.text
        return r.json()["id"]
    return addrs[0]["id"]


def _pick_item(buyer_token: str) -> Dict[str, Any]:
    r = requests.get(f"{BASE_URL}/api/items?limit=20",
                     headers={"Authorization": f"Bearer {buyer_token}"}, timeout=20)
    assert r.status_code == 200, r.text
    items = r.json()
    assert items, "No items available"
    for it in items:
        if any(int(s.get("available_qty", 0)) > 0 for s in it.get("sizes", [])):
            return it
    return items[0]


def test_checkout_pickup_rejected(buyer_token):
    """delivery_option='pickup' must be rejected by Pydantic (Literal['door'])."""
    addr_id = _pick_address(buyer_token)
    item = _pick_item(buyer_token)
    size = item["sizes"][0]["label"]
    r = requests.post(
        f"{BASE_URL}/api/payments/checkout",
        json={
            "item_id": item["id"], "size": size, "origin_url": BASE_URL,
            "address_id": addr_id, "delivery_option": "pickup",
        },
        headers={"Authorization": f"Bearer {buyer_token}"}, timeout=30,
    )
    assert r.status_code == 422, f"expected 422 for pickup, got {r.status_code}: {r.text}"


def test_checkout_door_initializes(buyer_token):
    """delivery_option='door' should initialize a live Paystack session — assert URL only."""
    addr_id = _pick_address(buyer_token)
    item = _pick_item(buyer_token)
    size = item["sizes"][0]["label"]
    r = requests.post(
        f"{BASE_URL}/api/payments/checkout",
        json={
            "item_id": item["id"], "size": size, "origin_url": BASE_URL,
            "address_id": addr_id, "delivery_option": "door",
        },
        headers={"Authorization": f"Bearer {buyer_token}"}, timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "checkout.paystack.com" in body["url"], f"unexpected url: {body['url']}"
    assert body["session_id"]


# ---------------------------------------------------------------------------
# Synthetic order helpers
# ---------------------------------------------------------------------------
def _copy_shape_order() -> Dict[str, Any]:
    """Base doc shape for a synthetic paid order — mirrors payments.py insert."""
    now = datetime.now(timezone.utc)
    oid = str(uuid.uuid4())
    ref = f"test_iter33_{oid[:8]}_{uuid.uuid4().hex[:8]}"
    return {
        "id": oid,
        "session_id": ref,
        "paystack_reference": ref,
        "status": "paid",
        "created_at": now,
        "amount_cents": 250000,   # KES 2500
        "currency": "KES",
        "paystack_currency": "KES",
        "cents_normalized": True,
        "platform_fee_cents": 25000,
        "seller_net_cents": 225000,
        "delivery_option": "door",
        "delivery_fee_cents": 20000,   # KES 200
        "delivery_zone_key": "cbd",
        "delivery_zone_label": "CBD",
        "total_charged_cents": 270000,
        "size": "M",
        "color": None,
        "shipping_address": {
            "recipient_name": "Test Buyer",
            "phone": "0712345678",
            "building_estate": "Test Bldg",
            "house_number": "1",
            "street": "Kimathi",
            "area": "CBD",
            "city": "Nairobi",
            "country": "Kenya",
        },
    }


@pytest.fixture(scope="module")
def synthetic_courier_order(mongo, seller_auth, buyer_auth):
    """Insert a synthetic paid order for the courier flow. Cleaned up at teardown."""
    # Grab a real item to satisfy item_id/name fields.
    item = mongo.items.find_one({"seller_id": seller_auth["user"]["id"]}, {"_id": 0})
    assert item, "No seller items found"
    doc = _copy_shape_order()
    doc.update({
        "buyer_id": buyer_auth["user"]["id"],
        "seller_id": seller_auth["user"]["id"],
        "item_id": item["id"],
        "item_name": item["name"],
        "address_id": "test-addr-1",
    })
    mongo.orders.insert_one(dict(doc))
    yield doc
    # Cleanup
    mongo.orders.delete_one({"id": doc["id"]})
    mongo.delivery_jobs.delete_many({"order_id": doc["id"]})
    mongo.courier_earnings.delete_many({"order_id": doc["id"]})


@pytest.fixture(scope="module")
def synthetic_selfship_order(mongo, seller_auth, buyer_auth):
    item = mongo.items.find_one({"seller_id": seller_auth["user"]["id"]}, {"_id": 0})
    doc = _copy_shape_order()
    doc.update({
        "buyer_id": buyer_auth["user"]["id"],
        "seller_id": seller_auth["user"]["id"],
        "item_id": item["id"],
        "item_name": item["name"],
        "address_id": "test-addr-2",
    })
    mongo.orders.insert_one(dict(doc))
    yield doc
    mongo.orders.delete_one({"id": doc["id"]})


# ---------------------------------------------------------------------------
# 2. Seller fulfillment state machine — courier path
# ---------------------------------------------------------------------------
def _seller_headers(seller_auth):
    return {"Authorization": f"Bearer {seller_auth['token']}"}


def _fulfill(order_id: str, seller_auth, **kwargs):
    return requests.post(
        f"{BASE_URL}/api/seller/orders/{order_id}/fulfillment",
        json=kwargs, headers=_seller_headers(seller_auth), timeout=30,
    )


def test_courier_request_before_acknowledge_rejected(seller_auth, synthetic_courier_order):
    r = _fulfill(synthetic_courier_order["id"], seller_auth, action="request_courier")
    assert r.status_code == 400
    assert "Accept the order first" in r.text


def test_courier_acknowledge_transitions_to_in_fulfillment(seller_auth, synthetic_courier_order, mongo):
    r = _fulfill(synthetic_courier_order["id"], seller_auth, action="acknowledge")
    assert r.status_code == 200, r.text
    order = mongo.orders.find_one({"id": synthetic_courier_order["id"]})
    assert order["status"] == "in_fulfillment"


def test_courier_request_opens_job_with_code(seller_auth, synthetic_courier_order, mongo):
    r = _fulfill(synthetic_courier_order["id"], seller_auth, action="request_courier")
    assert r.status_code == 200, r.text
    order = mongo.orders.find_one({"id": synthetic_courier_order["id"]})
    assert order.get("courier_job_id"), "courier_job_id not set on order"
    assert order.get("handover_code"), "handover_code not generated"
    assert len(str(order["handover_code"])) == 4
    job = mongo.delivery_jobs.find_one({"id": order["courier_job_id"]})
    assert job is not None, "delivery_jobs doc not created"
    assert job["status"] == "open"


def test_courier_order_cannot_be_seller_shipped(seller_auth, synthetic_courier_order):
    r = _fulfill(synthetic_courier_order["id"], seller_auth, action="ship", tracking_number="ABC-123")
    assert r.status_code == 400
    assert "rider" in r.text.lower()


def test_courier_order_cannot_be_seller_delivered(seller_auth, synthetic_courier_order):
    r = _fulfill(synthetic_courier_order["id"], seller_auth, action="deliver")
    assert r.status_code == 400
    assert "rider" in r.text.lower() or "handover" in r.text.lower()


# ---------------------------------------------------------------------------
# 3. Rider lifecycle
# ---------------------------------------------------------------------------
def test_rider_sees_open_job(rider_token, synthetic_courier_order, mongo):
    order = mongo.orders.find_one({"id": synthetic_courier_order["id"]})
    r = requests.get(f"{BASE_URL}/api/courier/jobs",
                     headers={"Authorization": f"Bearer {rider_token}"}, timeout=20)
    assert r.status_code == 200, r.text
    ids = [j["id"] for j in r.json().get("open", [])]
    assert order["courier_job_id"] in ids, f"job {order['courier_job_id']} not in open list"


def test_rider_accepts_job(rider_token, synthetic_courier_order, mongo):
    order = mongo.orders.find_one({"id": synthetic_courier_order["id"]})
    job_id = order["courier_job_id"]
    r = requests.post(f"{BASE_URL}/api/courier/jobs/{job_id}/accept",
                      headers={"Authorization": f"Bearer {rider_token}"}, timeout=20)
    assert r.status_code == 200, r.text
    job = mongo.delivery_jobs.find_one({"id": job_id})
    assert job["status"] == "accepted"


def test_rider_picks_up_marks_shipped(rider_token, synthetic_courier_order, mongo):
    order = mongo.orders.find_one({"id": synthetic_courier_order["id"]})
    job_id = order["courier_job_id"]
    r = requests.post(f"{BASE_URL}/api/courier/jobs/{job_id}/status",
                      json={"action": "picked_up"},
                      headers={"Authorization": f"Bearer {rider_token}"}, timeout=20)
    assert r.status_code == 200, r.text
    fresh = mongo.orders.find_one({"id": order["id"]})
    assert fresh["status"] == "shipped", f"order status {fresh['status']}"
    assert fresh.get("carrier") == "Oromona Rider"


def test_rider_delivers_with_handover_code(rider_token, synthetic_courier_order, mongo):
    order = mongo.orders.find_one({"id": synthetic_courier_order["id"]})
    job_id = order["courier_job_id"]
    code = order["handover_code"]
    r = requests.post(f"{BASE_URL}/api/courier/jobs/{job_id}/deliver",
                      json={"code": code},
                      headers={"Authorization": f"Bearer {rider_token}"}, timeout=20)
    assert r.status_code == 200, r.text
    job = mongo.delivery_jobs.find_one({"id": job_id})
    assert job["status"] == "delivered"
    fresh = mongo.orders.find_one({"id": order["id"]})
    assert fresh["status"] == "delivered"
    assert fresh.get("escrow_release_at") is not None
    earnings = list(mongo.courier_earnings.find({"order_id": order["id"]}))
    assert len(earnings) >= 1


# ---------------------------------------------------------------------------
# 4. Self-ship path (no courier)
# ---------------------------------------------------------------------------
def test_selfship_acknowledge(seller_auth, synthetic_selfship_order, mongo):
    r = _fulfill(synthetic_selfship_order["id"], seller_auth, action="acknowledge")
    assert r.status_code == 200, r.text
    order = mongo.orders.find_one({"id": synthetic_selfship_order["id"]})
    assert order["status"] == "in_fulfillment"


def test_selfship_ship_with_tracking(seller_auth, synthetic_selfship_order, mongo):
    r = _fulfill(synthetic_selfship_order["id"], seller_auth,
                 action="ship", tracking_number="G4S-99887")
    assert r.status_code == 200, r.text
    order = mongo.orders.find_one({"id": synthetic_selfship_order["id"]})
    assert order["status"] == "shipped"
    assert order.get("tracking_number") == "G4S-99887"


def test_selfship_deliver(seller_auth, synthetic_selfship_order, mongo):
    r = _fulfill(synthetic_selfship_order["id"], seller_auth, action="deliver")
    assert r.status_code == 200, r.text
    order = mongo.orders.find_one({"id": synthetic_selfship_order["id"]})
    assert order["status"] == "delivered"
    assert order.get("escrow_release_at") is not None

"""Iteration 37 — Self-delivery handover-code flow (sync tests).

Bug fix under test: choosing "I'll deliver myself" previously marked the
order delivered and released escrow with no proof. Now:
  self_deliver -> status=shipped, out_for_delivery_at set, handover_code
                  minted, self_delivery=true, delivered_at/escrow_release_at
                  still null, payout still 'held'.
  confirm_handover(wrong)   -> 400, still shipped.
  confirm_handover(correct) -> delivered + escrow_release_at set (+48h)
                               but payout stays 'held'.
  legacy deliver -> 400 on self_delivery orders.

Rider regression: picked_up -> shipped + out_for_delivery_at;
deliver w/ correct code -> delivered + escrow_release_at + payout held.
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Dict

import pytest
import requests
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")

from core.security import make_jwt  # noqa: E402

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or
            "https://fit-finder-app-5.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# Sync client — motor's event-loop binding fights with pytest fixtures.
_MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
_DB_NAME = os.environ.get("DB_NAME", "aurafit")
_client = MongoClient(_MONGO_URL)
db = _client[_DB_NAME]


def run(coro):
    return coro  # backwards compatibility for the few helpers below


# ---------------------------------------------------------------------------
# DB setup helpers (sync pymongo).
# ---------------------------------------------------------------------------
def _seed_paid_order(ids: Dict[str, str], order_id: str) -> None:
    now = datetime.now(timezone.utc)
    db.users.update_one(
        {"id": ids["buyer"]},
        {"$set": {
            "id": ids["buyer"], "email": f"{ids['buyer']}@example.com",
            "full_name": "Test Buyer", "role": "buyer",
            "hashed_password": "x", "token_version": 0, "created_at": now,
        }}, upsert=True,
    )
    db.users.update_one(
        {"id": ids["seller"]},
        {"$set": {
            "id": ids["seller"], "email": f"{ids['seller']}@example.com",
            "full_name": "Test Seller", "role": "seller",
            "company_name": "TEST Atelier", "hashed_password": "x",
            "token_version": 0, "created_at": now,
        }}, upsert=True,
    )
    db.items.update_one(
        {"id": ids["item"]},
        {"$set": {
            "id": ids["item"], "seller_id": ids["seller"],
            "seller_name": "Test Seller", "name": "TEST Jacket",
            "description": "", "category": "outerwear", "price_cents": 500000,
            "currency": "KES", "image_b64": "",
            "sizes": [{"label": "M", "available_qty": 5}], "colors": [],
            "audience": "unisex", "created_at": now,
        }}, upsert=True,
    )
    db.orders.insert_one({
        "id": order_id, "buyer_id": ids["buyer"], "seller_id": ids["seller"],
        "item_id": ids["item"], "item_name": "TEST Jacket", "size": "M",
        "color": None, "amount_cents": 500000, "currency": "KES",
        "status": "paid", "session_id": f"sess_{uuid.uuid4().hex[:10]}",
        "created_at": now, "delivery_option": "door",
        "delivery_fee_cents": 30000,
        "shipping_address": {"recipient_name": "Test Buyer",
                             "phone": "0712345678", "city": "Nairobi"},
    })
    payout_id = str(uuid.uuid4())
    db.payouts.insert_one({
        "id": payout_id, "order_id": order_id, "seller_id": ids["seller"],
        "buyer_id": ids["buyer"], "gross_cents": 500000,
        "platform_fee_cents": 50000, "amount_cents": 450000,
        "currency": "KES", "status": "held", "created_at": now,
        "released_at": None,
    })
    db.orders.update_one(
        {"id": order_id},
        {"$set": {"payout_id": payout_id, "escrow_status": "held"}},
    )


def _get_payout(order_id: str) -> Dict[str, Any]:
    return db.payouts.find_one({"order_id": order_id}, {"_id": 0})


def _get_order(order_id: str) -> Dict[str, Any]:
    return db.orders.find_one({"id": order_id}, {"_id": 0})


def _cleanup(ids: Dict[str, str]) -> None:
    db.orders.delete_many({"seller_id": ids["seller"]})
    db.payouts.delete_many({"seller_id": ids["seller"]})
    db.delivery_jobs.delete_many({"seller_id": ids["seller"]})
    db.items.delete_many({"id": ids["item"]})
    db.users.delete_many({"id": {"$in": [ids["buyer"], ids["seller"]]}})


# ---------------------------------------------------------------------------
# Module-level state (a single scenario is walked through the state machine).
# ---------------------------------------------------------------------------
IDS = {
    "buyer": f"TEST_buyer_{uuid.uuid4().hex[:8]}",
    "seller": f"TEST_seller_{uuid.uuid4().hex[:8]}",
    "item": f"TEST_item_{uuid.uuid4().hex[:8]}",
}
ORDER_ID = f"TEST_ord_{uuid.uuid4().hex[:10]}"
STATE: Dict[str, Any] = {}


@pytest.fixture(scope="module", autouse=True)
def _lifecycle():
    _seed_paid_order(IDS, ORDER_ID)
    yield
    _cleanup(IDS)


@pytest.fixture(scope="module")
def seller_headers():
    tok = make_jwt(IDS["seller"], "seller", 0)
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def buyer_headers():
    tok = make_jwt(IDS["buyer"], "buyer", 0)
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# --- Self-delivery ----------------------------------------------------------
def test_01_acknowledge_moves_to_in_fulfillment(seller_headers):
    r = requests.post(
        f"{API}/seller/orders/{ORDER_ID}/fulfillment",
        json={"action": "acknowledge"}, headers=seller_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json()["order"]["status"] == "in_fulfillment"


def test_02_self_deliver_out_for_delivery_no_release(seller_headers):
    r = requests.post(
        f"{API}/seller/orders/{ORDER_ID}/fulfillment",
        json={"action": "self_deliver"}, headers=seller_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    order = r.json()["order"]
    assert order["status"] == "shipped"
    assert order.get("self_delivery") is True
    assert order.get("out_for_delivery_at") is not None
    assert order.get("delivered_at") is None, "delivered_at must NOT be set yet"
    assert order.get("escrow_release_at") is None, "escrow window must NOT start yet"
    code = order.get("handover_code")
    assert code and len(str(code)) == 4 and str(code).isdigit()
    STATE["code"] = str(code)


def test_03_payout_still_held_after_self_deliver():
    p = _get_payout(ORDER_ID)
    assert p and p["status"] == "held", f"payout must stay held, got {p and p['status']}"
    assert not p.get("released_at")


def test_04_buyer_sees_handover_code_and_status_shipped(buyer_headers):
    r = requests.get(f"{API}/orders/{ORDER_ID}", headers=buyer_headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "shipped"
    assert body.get("self_delivery") is True
    assert body.get("handover_code") == STATE["code"]


def test_05_wrong_handover_code_400_and_status_unchanged(seller_headers, buyer_headers):
    wrong = "0000" if STATE["code"] != "0000" else "9999"
    r = requests.post(
        f"{API}/seller/orders/{ORDER_ID}/fulfillment",
        json={"action": "confirm_handover", "code": wrong},
        headers=seller_headers, timeout=15,
    )
    assert r.status_code == 400, r.text
    r2 = requests.get(f"{API}/orders/{ORDER_ID}", headers=buyer_headers, timeout=15)
    assert r2.json()["status"] == "shipped"


def test_06_legacy_deliver_blocked_on_self_delivery(seller_headers):
    r = requests.post(
        f"{API}/seller/orders/{ORDER_ID}/fulfillment",
        json={"action": "deliver"}, headers=seller_headers, timeout=15,
    )
    assert r.status_code == 400, r.text


def test_07_correct_handover_code_delivers(seller_headers):
    r = requests.post(
        f"{API}/seller/orders/{ORDER_ID}/fulfillment",
        json={"action": "confirm_handover", "code": STATE["code"]},
        headers=seller_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    order = r.json()["order"]
    assert order["status"] == "delivered"
    assert order.get("delivered_at") is not None
    assert order.get("escrow_release_at") is not None


def test_08_payout_stays_held_after_delivery():
    """release_payout must NOT have been triggered — only the 48h
    window is armed. Buyer confirm or the sweep releases funds."""
    p = _get_payout(ORDER_ID)
    assert p and p["status"] == "held", f"payout must remain held, got {p and p['status']}"
    assert not p.get("released_at")


# ---------------------------------------------------------------------------
# Rider regression — independent order + courier + job.
# ---------------------------------------------------------------------------
RIDER_IDS = {
    "buyer": f"TEST_buyer_{uuid.uuid4().hex[:8]}",
    "seller": f"TEST_seller_{uuid.uuid4().hex[:8]}",
    "item": f"TEST_item_{uuid.uuid4().hex[:8]}",
}
RIDER_ORDER = f"TEST_rider_{uuid.uuid4().hex[:10]}"
RIDER_JOB = f"TEST_job_{uuid.uuid4().hex[:8]}"
COURIER_ID = f"TEST_courier_{uuid.uuid4().hex[:8]}"
RIDER_CODE = "4321"


def _seed_rider_scenario() -> None:
    _seed_paid_order(RIDER_IDS, RIDER_ORDER)
    now = datetime.now(timezone.utc)
    db.users.update_one(
        {"id": COURIER_ID},
        {"$set": {
            "id": COURIER_ID, "email": f"{COURIER_ID}@example.com",
            "full_name": "Test Rider", "role": "courier",
            "courier_status": "approved", "phone": "0712345678",
            "hashed_password": "x", "token_version": 0, "created_at": now,
        }}, upsert=True,
    )
    db.delivery_jobs.insert_one({
        "id": RIDER_JOB, "order_id": RIDER_ORDER,
        "seller_id": RIDER_IDS["seller"], "buyer_id": RIDER_IDS["buyer"],
        "item_name": "TEST Jacket", "status": "accepted",
        "courier_id": COURIER_ID, "accepted_at": now, "created_at": now,
        "handover_code": RIDER_CODE, "rider_cut_cents": 27000, "fee_cents": 30000,
    })
    db.orders.update_one(
        {"id": RIDER_ORDER},
        {"$set": {"courier_job_id": RIDER_JOB, "status": "in_fulfillment"}},
    )


def _cleanup_rider() -> None:
    db.delivery_jobs.delete_many({"id": RIDER_JOB})
    db.courier_earnings.delete_many({"order_id": RIDER_ORDER})
    db.users.delete_many({"id": COURIER_ID})
    _cleanup(RIDER_IDS)


@pytest.fixture(scope="module", autouse=True)
def _rider_lifecycle():
    _seed_rider_scenario()
    yield
    _cleanup_rider()


def _rider_headers() -> Dict[str, str]:
    tok = make_jwt(COURIER_ID, "courier", 0)
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def test_r1_rider_picked_up_stamps_out_for_delivery_and_shipped():
    r = requests.post(
        f"{API}/courier/jobs/{RIDER_JOB}/status",
        json={"action": "picked_up"}, headers=_rider_headers(), timeout=15,
    )
    assert r.status_code == 200, r.text
    order = _get_order(RIDER_ORDER)
    assert order["status"] == "shipped"
    assert order.get("out_for_delivery_at") is not None
    assert order.get("delivered_at") is None


def test_r2_rider_deliver_correct_code_marks_delivered_payout_held():
    r = requests.post(
        f"{API}/courier/jobs/{RIDER_JOB}/deliver",
        json={"code": RIDER_CODE}, headers=_rider_headers(), timeout=15,
    )
    assert r.status_code == 200, r.text
    order = _get_order(RIDER_ORDER)
    assert order["status"] == "delivered"
    assert order.get("delivered_at") is not None
    assert order.get("escrow_release_at") is not None
    p = _get_payout(RIDER_ORDER)
    assert p and p["status"] == "held"

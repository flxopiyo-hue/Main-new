"""Iteration 30 — Phase 1 Courier System regression.

Covers:
  * /api/delivery/quote — zone matrix (inner/outer/metro/major_towns/unknown-Nairobi),
    free-delivery threshold, non-KES currency short-circuit.
  * /api/payments/checkout — INITIALIZATION ONLY (live Paystack keys!) —
    validates that the pending order stores delivery_option / delivery_fee_cents /
    delivery_zone_key / total_charged_cents correctly for door + pickup.
  * Second-rider-accepting-taken-job → 409 conflict.
  * Regression smoke: items list, item detail, /subs/me, seller /seller/orders
    action=acknowledge (existing seller-fulfillment action still healthy).

Live-Paystack safety: every checkout test only asserts an authorization URL is
returned + the DB row shape, then DELETES the pending order. No URL is ever
opened, no test cards used, no transfers.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "EXPO_BACKEND_URL", "https://fit-finder-app-5.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

BUYER = ("buyer@aurafit.com", "demo-buyer-2026")
SELLER = ("atelier@aurafit.com", "demo-seller-2026")
ADMIN = ("admin@oromona.com", "oromona-admin-2026")
RIDER = ("test_rider_fc0de2@test.com", "rider-pass-123")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def db():
    env = open("/app/backend/.env").read()
    uri = re.search(r'MONGO_URL="?([^"\n]+)"?', env).group(1)
    m = re.search(r'DB_NAME="?([^"\n]+)"?', env)
    dbname = m.group(1) if m else "test_database"
    return MongoClient(uri)[dbname]


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session: requests.Session, email: str, pw: str) -> str:
    r = session.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _H(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def buyer_tok(session):
    return _login(session, *BUYER)


@pytest.fixture(scope="session")
def admin_tok(session):
    return _login(session, *ADMIN)


@pytest.fixture(scope="session")
def rider_tok(session):
    return _login(session, *RIDER)


@pytest.fixture(scope="session")
def seller_tok(session):
    """toggle-role FLIPS the role on every call → make sure we finish as seller."""
    tok = _login(session, *SELLER)
    for _ in range(2):
        me = session.get(f"{API}/auth/me", headers=_H(tok)).json()
        role_now = me.get("role") or (me.get("user") or {}).get("role")
        if role_now == "seller":
            break
        session.post(f"{API}/user/toggle-role", json={"role": "seller"}, headers=_H(tok))
        tok = _login(session, *SELLER)
    return tok


def _mk_addr(session: requests.Session, tok: str, area: str, city: str = "Nairobi") -> str:
    body = {
        "label": "other",
        "recipient_name": "TEST_Buyer",
        "phone": "0700000001",
        "building_estate": "TEST Estate",
        "house_number": "1",
        "street": "TEST Rd",
        "area": area,
        "city": city,
        "country": "Kenya",
    }
    r = session.post(f"{API}/addresses", json=body, headers=_H(tok), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _rm_addr(session: requests.Session, tok: str, addr_id: str) -> None:
    session.delete(f"{API}/addresses/{addr_id}", headers=_H(tok), timeout=30)


# ---------------------------------------------------------------------------
# Backend regression smoke — basics still healthy
# ---------------------------------------------------------------------------


class TestRegressionSmoke:
    def test_items_list_ok(self, session):
        r = session.get(f"{API}/items", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) > 0, "expected seeded items"

    def test_item_detail_ok(self, session):
        listing = session.get(f"{API}/items", timeout=30).json()
        first = listing[0]
        r = session.get(f"{API}/items/{first['id']}", timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["id"] == first["id"]
        assert "price_cents" in j and "currency" in j

    def test_subs_me_ok(self, session, buyer_tok):
        r = session.get(f"{API}/subs/me", headers=_H(buyer_tok), timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "tier" in j or "gate" in j or "subscription" in j


# ---------------------------------------------------------------------------
# /delivery/quote — zone matrix
# ---------------------------------------------------------------------------


ZONE_MATRIX = [
    # (area, city, item_total_cents, expected_zone_key, expected_fee_due_cents)
    ("Westlands", "Nairobi", 150000, "nairobi_inner", 30000),
    ("Kitengela", "Nairobi", 150000, "nairobi_metro", 90000),
    ("Mombasa", "Mombasa", 150000, "major_towns", 50000),
    ("SomeUnknownArea", "Nairobi", 150000, "nairobi_outer", 60000),
]


class TestDeliveryQuote:
    @pytest.mark.parametrize("area,city,total,zone_key,fee", ZONE_MATRIX)
    def test_zone_matrix(self, session, buyer_tok, area, city, total, zone_key, fee):
        addr_id = _mk_addr(session, buyer_tok, area, city)
        try:
            r = session.post(
                f"{API}/delivery/quote",
                json={"address_id": addr_id, "item_total_cents": total, "currency": "KES"},
                headers=_H(buyer_tok),
                timeout=30,
            )
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["supported"] is True
            assert j["zone_key"] == zone_key, f"{area}: got {j['zone_key']} expected {zone_key}"
            assert j["fee_due_cents"] == fee, f"{area}: got {j['fee_due_cents']} expected {fee}"
            assert j["free_applied"] is False
        finally:
            _rm_addr(session, buyer_tok, addr_id)

    def test_free_delivery_threshold(self, session, buyer_tok):
        addr_id = _mk_addr(session, buyer_tok, "Westlands", "Nairobi")
        try:
            r = session.post(
                f"{API}/delivery/quote",
                json={"address_id": addr_id, "item_total_cents": 2_500_000, "currency": "KES"},
                headers=_H(buyer_tok),
                timeout=30,
            )
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["free_applied"] is True
            assert j["fee_due_cents"] == 0
            # base zone fee is still exposed for UI display
            assert j["fee_cents"] == 30000
        finally:
            _rm_addr(session, buyer_tok, addr_id)

    def test_usd_currency_short_circuit(self, session, buyer_tok):
        addr_id = _mk_addr(session, buyer_tok, "Westlands", "Nairobi")
        try:
            r = session.post(
                f"{API}/delivery/quote",
                json={"address_id": addr_id, "item_total_cents": 150000, "currency": "USD"},
                headers=_H(buyer_tok),
                timeout=30,
            )
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["supported"] is False
            assert j["fee_cents"] == 0
            assert j["fee_due_cents"] == 0
        finally:
            _rm_addr(session, buyer_tok, addr_id)


# ---------------------------------------------------------------------------
# /payments/checkout — INITIALIZATION-ONLY (live Paystack)
# ---------------------------------------------------------------------------


def _first_kes_item(session):
    for it in session.get(f"{API}/items", timeout=30).json():
        if (it.get("currency") or "KES").upper() == "KES":
            # pick a size that exists
            sizes = it.get("sizes") or []
            size = next((s["label"] for s in sizes if int(s.get("available_qty") or 0) > 0), None)
            if size is None:
                # variants path
                variants = it.get("variants") or []
                for v in variants:
                    if int(v.get("quantity") or 0) > 0 and not v.get("disabled"):
                        return it, v.get("size"), v.get("color"), v.get("id")
                continue
            return it, size, None, None
    pytest.skip("no purchasable KES item")


class TestCheckoutOrderShape:
    def test_door_delivery_stores_zone_fee(self, session, buyer_tok, db):
        item, size, color, variant_id = _first_kes_item(session)
        addr_id = _mk_addr(session, buyer_tok, "Westlands", "Nairobi")  # nairobi_inner 30000
        order_ref = None
        try:
            payload = {
                "item_id": item["id"],
                "size": size,
                "color": color,
                "variant_id": variant_id,
                "origin_url": BASE_URL,
                "address_id": addr_id,
                "delivery_option": "door",
            }
            r = session.post(f"{API}/payments/checkout", json=payload, headers=_H(buyer_tok), timeout=45)
            assert r.status_code == 200, r.text
            j = r.json()
            assert "url" in j and "checkout.paystack.com" in j["url"]
            order_ref = j["session_id"]
            # Read the pending order row
            row = db.orders.find_one({"session_id": order_ref})
            assert row is not None, "pending order not persisted"
            assert row["status"] == "pending"
            assert row["delivery_option"] == "door"
            assert row["delivery_zone_key"] == "nairobi_inner"
            assert row["delivery_fee_cents"] == 30000
            assert row["total_charged_cents"] == int(row["amount_cents"]) + 30000
            assert row.get("shipping_address", {}).get("area", "").lower() == "westlands"
        finally:
            if order_ref:
                db.orders.delete_one({"session_id": order_ref, "status": "pending"})
            _rm_addr(session, buyer_tok, addr_id)

    def test_pickup_delivery_is_free(self, session, buyer_tok, db):
        item, size, color, variant_id = _first_kes_item(session)
        addr_id = _mk_addr(session, buyer_tok, "Kitengela", "Nairobi")  # would be metro 90000
        order_ref = None
        try:
            payload = {
                "item_id": item["id"],
                "size": size,
                "color": color,
                "variant_id": variant_id,
                "origin_url": BASE_URL,
                "address_id": addr_id,
                "delivery_option": "pickup",
            }
            r = session.post(f"{API}/payments/checkout", json=payload, headers=_H(buyer_tok), timeout=45)
            assert r.status_code == 200, r.text
            j = r.json()
            assert "checkout.paystack.com" in j["url"]
            order_ref = j["session_id"]
            row = db.orders.find_one({"session_id": order_ref})
            assert row is not None
            assert row["delivery_option"] == "pickup"
            assert row["delivery_zone_key"] == "cbd_pickup"
            assert row["delivery_fee_cents"] == 0
            assert row["total_charged_cents"] == int(row["amount_cents"])  # no fee added
        finally:
            if order_ref:
                db.orders.delete_one({"session_id": order_ref, "status": "pending"})
            _rm_addr(session, buyer_tok, addr_id)


# ---------------------------------------------------------------------------
# Courier: second-rider-accepts-taken-job → 409
# ---------------------------------------------------------------------------


class TestCourierRaceCondition:
    def test_second_accept_returns_409(self, session, buyer_tok, seller_tok, rider_tok, admin_tok, db):
        # Build a synthetic paid door-delivery order via mongo (mirrors smoke script).
        buyer = db.users.find_one({"email": BUYER[0]})
        seller = db.users.find_one({"email": SELLER[0]})
        item = db.items.find_one({"seller_id": seller["id"]}) or db.items.find_one({})
        order_id = str(uuid.uuid4())
        ref = f"test_{order_id[:8]}"
        db.orders.insert_one({
            "id": order_id, "buyer_id": buyer["id"], "seller_id": item["seller_id"],
            "item_id": item["id"], "item_name": "TEST_Race Tee", "size": "M",
            "amount_cents": 150000, "currency": "KES", "status": "paid",
            "session_id": ref, "paystack_reference": ref,
            "platform_fee_cents": 22500, "seller_net_cents": 127500,
            "delivery_option": "door", "delivery_fee_cents": 60000,
            "delivery_zone_key": "nairobi_outer", "delivery_zone_label": "Outer Nairobi",
            "shipping_address": {
                "recipient_name": "TEST_Buyer", "phone": "0700000001",
                "building_estate": "Karen Estate", "house_number": "12",
                "street": "Karen Rd", "area": "Karen", "city": "Nairobi",
            },
            "created_at": datetime.now(timezone.utc),
        })

        # Register a SECOND rider (approved), so we have two active riders.
        r2_email = f"test_rider2_{uuid.uuid4().hex[:6]}@test.com"
        r2_pw = "rider2-pass-123"
        rr = session.post(
            f"{API}/auth/register",
            json={
                "email": r2_email, "password": r2_pw, "full_name": "TEST Rider 2",
                "role": "courier", "phone": "0712345679", "mpesa_number": "0712345679",
            },
            timeout=30,
        )
        assert rr.status_code == 200, rr.text
        r2_id = db.users.find_one({"email": r2_email})["id"]
        session.post(f"{API}/admin/couriers/{r2_id}/approve", headers=_H(admin_tok), timeout=30)
        r2_tok = _login(session, r2_email, r2_pw)

        job_id = None
        try:
            # Seller opens the job.
            fr = session.post(
                f"{API}/seller/orders/{order_id}/fulfillment",
                json={"action": "request_courier"},
                headers=_H(seller_tok),
                timeout=30,
            )
            assert fr.status_code == 200, fr.text
            # Locate the job.
            board = session.get(f"{API}/courier/jobs", headers=_H(rider_tok), timeout=30).json()
            job = next((j for j in board["open"] if j["order_id"] == order_id), None)
            assert job is not None, "job not on board"
            job_id = job["id"]

            # Rider 1 accepts.
            a1 = session.post(f"{API}/courier/jobs/{job_id}/accept", headers=_H(rider_tok), timeout=30)
            assert a1.status_code == 200, a1.text

            # Rider 2 tries to accept the same job → must 409.
            a2 = session.post(f"{API}/courier/jobs/{job_id}/accept", headers=_H(r2_tok), timeout=30)
            assert a2.status_code == 409, f"expected 409, got {a2.status_code}: {a2.text}"
        finally:
            # Cleanup
            db.orders.delete_one({"id": order_id})
            db.delivery_jobs.delete_many({"order_id": order_id})
            db.courier_earnings.delete_many({"order_id": order_id})
            db.users.delete_one({"email": r2_email})


# ---------------------------------------------------------------------------
# Regression: existing seller fulfillment actions still work
# (acknowledge on a paid non-courier order)
# ---------------------------------------------------------------------------


class TestSellerFulfillmentRegression:
    def test_acknowledge_paid_order(self, session, buyer_tok, seller_tok, db):
        buyer = db.users.find_one({"email": BUYER[0]})
        seller = db.users.find_one({"email": SELLER[0]})
        item = db.items.find_one({"seller_id": seller["id"]}) or db.items.find_one({})
        order_id = str(uuid.uuid4())
        ref = f"test_{order_id[:8]}"
        db.orders.insert_one({
            "id": order_id, "buyer_id": buyer["id"], "seller_id": item["seller_id"],
            "item_id": item["id"], "item_name": "TEST_Ack Tee", "size": "M",
            "amount_cents": 100000, "currency": "KES", "status": "paid",
            "session_id": ref, "paystack_reference": ref,
            "platform_fee_cents": 15000, "seller_net_cents": 85000,
            "delivery_option": "pickup", "delivery_fee_cents": 0,
            "delivery_zone_key": "cbd_pickup", "delivery_zone_label": "Pick up at Nairobi CBD point",
            "shipping_address": {"recipient_name": "TEST_Buyer", "area": "CBD", "city": "Nairobi"},
            "created_at": datetime.now(timezone.utc),
        })
        try:
            r = session.post(
                f"{API}/seller/orders/{order_id}/fulfillment",
                json={"action": "acknowledge"},
                headers=_H(seller_tok),
                timeout=30,
            )
            assert r.status_code == 200, r.text
            row = db.orders.find_one({"id": order_id})
            assert row["status"] in ("in_fulfillment", "acknowledged"), f"got {row['status']}"
        finally:
            db.orders.delete_one({"id": order_id})

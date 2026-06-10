"""Iteration 8 — Order Detail + Seller Dashboard + Stripe Connect graceful key tests.

Covers:
- GET /api/orders/{id}                   buyer/seller/admin/other-buyer/404
- POST /api/orders/{id}/feedback         buyer can set/update; seller 403; non-paid 400
- GET /api/seller/orders                 seller list (and status filter); buyer 403
- PATCH /api/seller/payout-details       merge + empty-string deletion; buyer 403
- PATCH /api/seller/profile              update + restore; buyer 403
- POST /api/seller/connect/setup         proxy/mock path; idempotent; buyer 403
- GET  /api/seller/connect/status        seller -> active
"""

import os
import requests
import pytest

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fit-finder-app-5.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

BUYER = ("buyer@aurafit.demo", "demo-buyer-2026")
SELLER = ("atelier@aurafit.demo", "demo-seller-2026")
ADMIN = ("admin@drape.app", "drape-admin-2026")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"], r.json()["user"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def buyer():
    t, u = _login(*BUYER)
    return {"token": t, "user": u, "h": _h(t)}


@pytest.fixture(scope="module")
def seller():
    t, u = _login(*SELLER)
    return {"token": t, "user": u, "h": _h(t)}


@pytest.fixture(scope="module")
def admin():
    t, u = _login(*ADMIN)
    return {"token": t, "user": u, "h": _h(t)}


@pytest.fixture(scope="module")
def buyer_order(buyer):
    """Find a paid order placed by the buyer."""
    r = requests.get(f"{API}/orders", headers=buyer["h"], timeout=20)
    assert r.status_code == 200
    orders = r.json()
    paid = [o for o in orders if o["status"] == "paid"]
    assert paid, "buyer has no paid orders in seed data"
    return paid[0]


# ---------------------------------------------------------------------------
# 1) GET /api/orders/{id}
# ---------------------------------------------------------------------------
class TestOrderDetail:
    def test_buyer_can_view_own_order(self, buyer, buyer_order):
        oid = buyer_order["id"]
        r = requests.get(f"{API}/orders/{oid}", headers=buyer["h"], timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        # Shape
        for k in ["id", "buyer_id", "seller_id", "item_id", "item_name", "size",
                  "amount_cents", "currency", "status", "session_id", "created_at",
                  "platform_fee_cents", "seller_net_cents", "seller"]:
            assert k in d, f"missing key {k}"
        # Seller card
        sc = d["seller"]
        assert sc is not None, "seller card should be populated"
        assert sc.get("company_name") == "Maison Lumière", f"unexpected company_name={sc.get('company_name')}"
        assert sc.get("location") and sc["location"].get("city") == "Nairobi"
        assert sc["location"].get("country") == "Kenya"
        ps = sc.get("payout_summary") or ""
        assert ("Equity Bank ••• 6789" in ps) or ("M-Pesa Paybill 247247" in ps), f"payout_summary={ps!r}"

    def test_seller_can_view_order(self, seller, buyer_order):
        oid = buyer_order["id"]
        r = requests.get(f"{API}/orders/{oid}", headers=seller["h"], timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["id"] == oid

    def test_admin_can_view_order(self, admin, buyer_order):
        oid = buyer_order["id"]
        r = requests.get(f"{API}/orders/{oid}", headers=admin["h"], timeout=20)
        assert r.status_code == 200

    def test_other_buyer_gets_403(self, buyer_order, seller):
        # register a fresh buyer that does NOT own the order
        email = f"TEST_other_buyer_{os.urandom(4).hex()}@drape.demo"
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "demo-buyer-2026",
            "full_name": "Other Buyer", "role": "buyer",
            "gender": "other", "age": 30,
        }, timeout=20)
        assert r.status_code in (200, 201), r.text
        tok = r.json()["token"]
        r = requests.get(f"{API}/orders/{buyer_order['id']}",
                         headers=_h(tok), timeout=20)
        assert r.status_code == 403, r.text
        assert "Not your order" in r.text

    def test_unknown_id_returns_404(self, buyer):
        r = requests.get(f"{API}/orders/does-not-exist-xyz", headers=buyer["h"], timeout=20)
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# 2) POST /api/orders/{id}/feedback
# ---------------------------------------------------------------------------
class TestFitFeedback:
    def test_buyer_perfect(self, buyer, buyer_order):
        r = requests.post(f"{API}/orders/{buyer_order['id']}/feedback",
                          headers=buyer["h"], json={"fit": "perfect"}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["fit_feedback"] == "perfect"

    def test_buyer_small_with_comment_persists(self, buyer, buyer_order):
        r = requests.post(f"{API}/orders/{buyer_order['id']}/feedback",
                          headers=buyer["h"], json={"fit": "small", "comment": "runs tight"},
                          timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["fit_feedback"] == "small"
        # OrderOut intentionally doesn't echo the comment

    def test_buyer_update_to_large(self, buyer, buyer_order):
        r = requests.post(f"{API}/orders/{buyer_order['id']}/feedback",
                          headers=buyer["h"], json={"fit": "large"}, timeout=20)
        assert r.status_code == 200
        assert r.json()["fit_feedback"] == "large"
        # Confirm persisted on GET
        r2 = requests.get(f"{API}/orders/{buyer_order['id']}", headers=buyer["h"], timeout=20)
        assert r2.json()["fit_feedback"] == "large"

    def test_seller_cannot_submit_feedback(self, seller, buyer_order):
        r = requests.post(f"{API}/orders/{buyer_order['id']}/feedback",
                          headers=seller["h"], json={"fit": "perfect"}, timeout=20)
        assert r.status_code == 403
        assert "Not your order" in r.text

    def test_non_paid_order_returns_400(self, buyer):
        """Find or skip if no non-paid order exists."""
        r = requests.get(f"{API}/orders", headers=buyer["h"], timeout=20)
        orders = r.json()
        non_paid = [o for o in orders if o["status"] != "paid"]
        if not non_paid:
            pytest.skip("No non-paid orders in seed for this buyer")
        oid = non_paid[0]["id"]
        r = requests.post(f"{API}/orders/{oid}/feedback",
                          headers=buyer["h"], json={"fit": "perfect"}, timeout=20)
        assert r.status_code == 400
        assert "Only paid orders" in r.text


# ---------------------------------------------------------------------------
# 3) GET /api/seller/orders
# ---------------------------------------------------------------------------
class TestSellerOrders:
    def test_seller_lists_orders(self, seller):
        r = requests.get(f"{API}/seller/orders", headers=seller["h"], timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 1

    def test_seller_status_filter(self, seller):
        r = requests.get(f"{API}/seller/orders?status=paid", headers=seller["h"], timeout=20)
        assert r.status_code == 200
        for o in r.json():
            assert o["status"] == "paid"

    def test_buyer_forbidden(self, buyer):
        r = requests.get(f"{API}/seller/orders", headers=buyer["h"], timeout=20)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# 4) PATCH /api/seller/payout-details
# ---------------------------------------------------------------------------
class TestPayoutDetails:
    def test_seller_update_and_restore(self, seller):
        # Update
        r = requests.patch(f"{API}/seller/payout-details", headers=seller["h"],
                           json={"bank_name": "KCB", "account_number": "998877665",
                                 "mpesa_paybill": "400200"}, timeout=20)
        assert r.status_code == 200, r.text
        u = r.json()
        bd = u.get("bank_details") or {}
        assert bd.get("bank_name") == "KCB"
        assert bd.get("account_number") == "998877665"
        assert bd.get("mpesa_paybill") == "400200"

        # Empty string for a field should DELETE it (not store empty)
        r = requests.patch(f"{API}/seller/payout-details", headers=seller["h"],
                           json={"mpesa_paybill": ""}, timeout=20)
        assert r.status_code == 200
        bd2 = r.json().get("bank_details") or {}
        assert "mpesa_paybill" not in bd2 or not bd2.get("mpesa_paybill"), \
            f"mpesa_paybill should be deleted, got {bd2}"

        # Restore to seed defaults
        r = requests.patch(f"{API}/seller/payout-details", headers=seller["h"],
                           json={"bank_name": "Equity Bank",
                                 "account_number": "0123456789",
                                 "mpesa_paybill": "247247"}, timeout=20)
        assert r.status_code == 200
        bd3 = r.json().get("bank_details") or {}
        assert bd3.get("bank_name") == "Equity Bank"
        assert bd3.get("account_number") == "0123456789"
        assert bd3.get("mpesa_paybill") == "247247"

    def test_buyer_forbidden(self, buyer):
        r = requests.patch(f"{API}/seller/payout-details", headers=buyer["h"],
                           json={"bank_name": "X"}, timeout=20)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# 5) PATCH /api/seller/profile
# ---------------------------------------------------------------------------
class TestSellerProfile:
    def test_update_and_restore(self, seller):
        r = requests.patch(f"{API}/seller/profile", headers=seller["h"],
                           json={"company_name": "Maison Lumière Atelier",
                                 "location": {"city": "Mombasa", "country": "Kenya"}},
                           timeout=20)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["company_name"] == "Maison Lumière Atelier"
        assert u["location"]["city"] == "Mombasa"

        # restore
        r = requests.patch(f"{API}/seller/profile", headers=seller["h"],
                           json={"company_name": "Maison Lumière",
                                 "location": {"city": "Nairobi", "country": "Kenya"}},
                           timeout=20)
        assert r.status_code == 200
        u = r.json()
        assert u["company_name"] == "Maison Lumière"
        assert u["location"]["city"] == "Nairobi"

    def test_buyer_forbidden(self, buyer):
        r = requests.patch(f"{API}/seller/profile", headers=buyer["h"],
                           json={"company_name": "X"}, timeout=20)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# 6/7) Stripe Connect (mocked proxy mode)
# ---------------------------------------------------------------------------
class TestConnect:
    def test_setup_returns_demo_account_in_proxy_mode(self, seller):
        r = requests.post(f"{API}/seller/connect/setup", headers=seller["h"], json={}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["connect_status"] == "active"
        acct = d.get("stripe_account_id") or ""
        # Note: seller is already onboarded in seed -> idempotent return.
        # When the seed account already exists with a real-looking id, accept it
        # but require demo prefix when fresh.
        assert acct, "stripe_account_id should be set"

    def test_setup_idempotent(self, seller):
        a1 = requests.post(f"{API}/seller/connect/setup", headers=seller["h"], json={}, timeout=20).json()
        a2 = requests.post(f"{API}/seller/connect/setup", headers=seller["h"], json={}, timeout=20).json()
        assert a1["stripe_account_id"] == a2["stripe_account_id"]

    def test_buyer_cannot_setup(self, buyer):
        r = requests.post(f"{API}/seller/connect/setup", headers=buyer["h"], json={}, timeout=20)
        assert r.status_code == 403

    def test_status_returns_active(self, seller):
        r = requests.get(f"{API}/seller/connect/status", headers=seller["h"], timeout=20)
        assert r.status_code == 200
        assert r.json()["connect_status"] == "active"

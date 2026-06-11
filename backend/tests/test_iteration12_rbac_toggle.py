"""Iteration 12 — RBAC + role-toggle + fulfillment regression tests.

Covers:
  • POST /auth/login with as_role flips/onboards/respects admin
  • POST /user/toggle-role buyer↔seller, validation, token_version invalidation
  • POST /seller/orders/{id}/fulfillment state machine
"""

import os
import time

import pytest
import requests

BASE = (os.environ.get("EXPO_BACKEND_URL") or os.environ["EXPO_PUBLIC_BACKEND_URL"]).rstrip("/")
API = f"{BASE}/api"

SELLER_EMAIL = "atelier@aurafit.demo"
SELLER_PASSWORD = "demo-seller-2026"
BUYER_EMAIL = "buyer@aurafit.demo"
BUYER_PASSWORD = "demo-buyer-2026"
ADMIN_EMAIL = "admin@drape.app"
ADMIN_PASSWORD = "drape-admin-2026"


def _login(email, password, as_role=None):
    body = {"email": email, "password": password}
    if as_role is not None:
        body["as_role"] = as_role
    r = requests.post(f"{API}/auth/login", json=body, timeout=30)
    return r


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session", autouse=True)
def reset_demo_roles():
    """Ensure demo accounts are in their canonical roles before AND after tests."""
    yield
    # Best-effort: restore the seller account to role=seller.
    r = _login(SELLER_EMAIL, SELLER_PASSWORD)
    if r.status_code == 200:
        u = r.json()["user"]
        if u["role"] != "seller":
            tok = r.json()["token"]
            requests.post(
                f"{API}/user/toggle-role",
                json={"to": "seller"},
                headers=_h(tok),
                timeout=30,
            )
    # Buyer should remain buyer.
    r = _login(BUYER_EMAIL, BUYER_PASSWORD)
    if r.status_code == 200:
        u = r.json()["user"]
        if u["role"] != "buyer":
            tok = r.json()["token"]
            requests.post(
                f"{API}/user/toggle-role",
                json={"to": "buyer"},
                headers=_h(tok),
                timeout=30,
            )


# -------------------------- Login with as_role ----------------------------- #
class TestLoginAsRole:
    def test_buyer_default(self):
        r = _login(BUYER_EMAIL, BUYER_PASSWORD)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["role"] == "buyer"
        assert data["needs_seller_onboarding"] is False

    def test_buyer_as_seller_needs_onboarding(self):
        r = _login(BUYER_EMAIL, BUYER_PASSWORD, as_role="seller")
        assert r.status_code == 200, r.text
        data = r.json()
        # Spec: role stays buyer (no flip), client routed to onboarding
        assert data["user"]["role"] == "buyer"
        assert data["needs_seller_onboarding"] is True

    def test_seller_default(self):
        r = _login(SELLER_EMAIL, SELLER_PASSWORD)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "seller"

    def test_seller_as_buyer_flips(self):
        # Flip seller → buyer via login.
        r = _login(SELLER_EMAIL, SELLER_PASSWORD, as_role="buyer")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["role"] == "buyer"
        new_token = data["token"]
        # /auth/me must accept the new token
        me = requests.get(f"{API}/auth/me", headers=_h(new_token), timeout=30)
        assert me.status_code == 200
        assert me.json()["role"] == "buyer"
        # Now flip back to seller for the rest of the suite.
        back = requests.post(
            f"{API}/user/toggle-role",
            json={"to": "seller"},
            headers=_h(new_token),
            timeout=30,
        )
        assert back.status_code == 200, back.text
        assert back.json()["user"]["role"] == "seller"

    def test_admin_as_seller_ignored(self):
        r = _login(ADMIN_EMAIL, ADMIN_PASSWORD, as_role="seller")
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "admin"
        assert r.json()["needs_seller_onboarding"] is False


# -------------------------- Toggle role endpoint --------------------------- #
class TestToggleRole:
    def test_buyer_to_seller_without_company_name_400(self):
        login = _login(BUYER_EMAIL, BUYER_PASSWORD)
        assert login.status_code == 200
        tok = login.json()["token"]
        # Buyer demo has no company_name → 400
        r = requests.post(
            f"{API}/user/toggle-role",
            json={"to": "seller"},
            headers=_h(tok),
            timeout=30,
        )
        assert r.status_code == 400, r.text
        assert "Company name" in r.json().get("detail", "")

    def test_admin_cannot_toggle(self):
        login = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        tok = login.json()["token"]
        r = requests.post(
            f"{API}/user/toggle-role",
            json={"to": "buyer"},
            headers=_h(tok),
            timeout=30,
        )
        assert r.status_code == 403, r.text
        assert "Admins" in r.json().get("detail", "")

    def test_seller_toggle_to_buyer_invalidates_old_token(self):
        login = _login(SELLER_EMAIL, SELLER_PASSWORD)
        assert login.status_code == 200
        old_token = login.json()["token"]
        assert login.json()["user"]["role"] == "seller"

        # Flip seller → buyer with empty body
        r = requests.post(
            f"{API}/user/toggle-role",
            json={},
            headers=_h(old_token),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        new_token = data["token"]
        assert data["user"]["role"] == "buyer"
        assert new_token != old_token

        # Old token must now be rejected
        me_old = requests.get(f"{API}/auth/me", headers=_h(old_token), timeout=30)
        assert me_old.status_code == 401, me_old.text
        assert "expired" in me_old.json().get("detail", "").lower() or "session" in me_old.json().get("detail", "").lower()

        # New token works
        me_new = requests.get(f"{API}/auth/me", headers=_h(new_token), timeout=30)
        assert me_new.status_code == 200
        assert me_new.json()["role"] == "buyer"

        # Flip back to seller so other tests aren't affected
        back = requests.post(
            f"{API}/user/toggle-role",
            json={"to": "seller"},
            headers=_h(new_token),
            timeout=30,
        )
        assert back.status_code == 200
        assert back.json()["user"]["role"] == "seller"

    def test_buyer_to_seller_with_company_name_200(self):
        # Use a fresh ephemeral buyer so we don't dirty the demo buyer.
        email = f"TEST_toggle_{int(time.time()*1000)}@drape.demo"
        reg = requests.post(
            f"{API}/auth/register",
            json={
                "email": email,
                "password": "pw-test-2026",
                "full_name": "Test Toggle",
                "role": "buyer",
                "gender": "other",
                "age": 30,
            },
            timeout=30,
        )
        assert reg.status_code == 200, reg.text
        tok = reg.json()["token"]
        # Toggle to seller with required fields
        r = requests.post(
            f"{API}/user/toggle-role",
            json={
                "to": "seller",
                "company_name": "TEST Atelier",
                "location": {"city": "Nairobi", "country": "Kenya"},
            },
            headers=_h(tok),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["role"] == "seller"
        assert data["user"]["company_name"] == "TEST Atelier"
        assert data["token"] != tok
        # Old token is invalid
        me_old = requests.get(f"{API}/auth/me", headers=_h(tok), timeout=30)
        assert me_old.status_code == 401


# -------------------------- Fulfillment state machine ---------------------- #
class TestFulfillment:
    @classmethod
    def setup_class(cls):
        # Login seller and find a paid order. The seed creates one with status=paid.
        r = _login(SELLER_EMAIL, SELLER_PASSWORD)
        assert r.status_code == 200
        # Ensure role is seller (previous test may have flipped)
        if r.json()["user"]["role"] != "seller":
            tok = r.json()["token"]
            back = requests.post(
                f"{API}/user/toggle-role",
                json={"to": "seller"},
                headers=_h(tok),
                timeout=30,
            )
            assert back.status_code == 200
            cls.token = back.json()["token"]
        else:
            cls.token = r.json()["token"]

        orders = requests.get(
            f"{API}/seller/orders", headers=_h(cls.token), timeout=30
        ).json()
        paid = [o for o in orders if o["status"] == "paid"]
        if not paid:
            pytest.skip("No paid order available in seed data for fulfillment tests")
        cls.order_id = paid[0]["id"]

    def test_a_acknowledge_paid(self):
        r = requests.post(
            f"{API}/seller/orders/{self.order_id}/fulfillment",
            json={"action": "acknowledge"},
            headers=_h(self.token),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["order"]["status"] == "in_fulfillment"

    def test_b_ship_without_tracking_400(self):
        r = requests.post(
            f"{API}/seller/orders/{self.order_id}/fulfillment",
            json={"action": "ship"},
            headers=_h(self.token),
            timeout=30,
        )
        assert r.status_code == 400, r.text
        assert "tracking" in r.json().get("detail", "").lower()

    def test_c_ship_with_tracking(self):
        r = requests.post(
            f"{API}/seller/orders/{self.order_id}/fulfillment",
            json={
                "action": "ship",
                "tracking_number": "TEST-TRACK-001",
                "tracking_url": "https://carrier.test/TEST-TRACK-001",
            },
            headers=_h(self.token),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        order = r.json()["order"]
        assert order["status"] == "shipped"
        assert order["tracking_number"] == "TEST-TRACK-001"
        assert order.get("shipped_at")

    def test_d_acknowledge_after_shipped_illegal(self):
        r = requests.post(
            f"{API}/seller/orders/{self.order_id}/fulfillment",
            json={"action": "acknowledge"},
            headers=_h(self.token),
            timeout=30,
        )
        assert r.status_code == 400, r.text

    def test_e_deliver_shipped(self):
        r = requests.post(
            f"{API}/seller/orders/{self.order_id}/fulfillment",
            json={"action": "deliver"},
            headers=_h(self.token),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        order = r.json()["order"]
        assert order["status"] == "delivered"
        assert order.get("delivered_at")

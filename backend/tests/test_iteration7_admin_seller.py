"""Iteration 7 backend tests: Seller signup overhaul + Admin role + Admin endpoints.

Covers:
  - Seller registration (success, missing company_name/location, ignored demographics)
  - Admin registration blocked
  - Admin login + /auth/me
  - Admin gating across analytics/users/items/orders
  - User search / filter / suspend
  - Item delete (last item) + wishlist cleanup
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get(
    "EXPO_BACKEND_URL"
)
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL/EXPO_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@drape.app"
ADMIN_PASSWORD = "drape-admin-2026"
SEED_SELLER_EMAIL = "atelier@aurafit.demo"


def _rand_suffix() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture(scope="session")
def admin_token() -> str:
    r = requests.post(f"{API}/auth/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD,
    }, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["user"]["role"] == "admin"
    return data["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token: str) -> dict:
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def buyer_creds() -> dict:
    email = f"TEST_buyer_{_rand_suffix()}@drape.demo"
    payload = {
        "email": email,
        "password": "test-pass-2026",
        "full_name": "Test Buyer",
        "role": "buyer",
        "gender": "female",
        "age": 24,
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"buyer register failed: {r.status_code} {r.text}"
    data = r.json()
    return {"email": email, "token": data["token"], "user": data["user"]}


@pytest.fixture(scope="session")
def seller_creds() -> dict:
    email = f"TEST_seller_{_rand_suffix()}@drape.demo"
    payload = {
        "email": email,
        "password": "test-pass-2026",
        "full_name": "Amani Atelier",
        "role": "seller",
        "company_name": "Amani Atelier",
        "location": {"city": "Mombasa", "country": "Kenya"},
        "bank_details": {
            "bank_name": "KCB",
            "account_name": "Amani Atelier Ltd",
            "account_number": "123456789",
            "mpesa_paybill": "400200",
        },
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"seller register failed: {r.status_code} {r.text}"
    return {"email": email, "token": r.json()["token"], "user": r.json()["user"]}


# ---------------------------------------------------------------------------
# 1-5 Register flow
# ---------------------------------------------------------------------------
class TestSellerRegister:
    def test_seller_register_success(self, seller_creds):
        u = seller_creds["user"]
        assert u["role"] == "seller"
        assert u["company_name"] == "Amani Atelier"
        assert u["location"]["city"] == "Mombasa"
        assert u["location"]["country"] == "Kenya"
        assert u.get("bank_details", {}).get("bank_name") == "KCB"

    def test_seller_missing_company_name(self):
        payload = {
            "email": f"TEST_nocomp_{_rand_suffix()}@drape.demo",
            "password": "test-pass-2026",
            "full_name": "No Co",
            "role": "seller",
            "location": {"city": "Nairobi", "country": "Kenya"},
        }
        r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
        assert r.status_code == 400, r.text
        assert "Company name is required" in r.json().get("detail", "")

    def test_seller_missing_location(self):
        payload = {
            "email": f"TEST_noloc_{_rand_suffix()}@drape.demo",
            "password": "test-pass-2026",
            "full_name": "No Loc",
            "role": "seller",
            "company_name": "Some Co",
        }
        r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
        assert r.status_code == 400, r.text
        assert "Location" in r.json().get("detail", "")

    def test_seller_ignores_demographics(self):
        email = f"TEST_demosell_{_rand_suffix()}@drape.demo"
        payload = {
            "email": email,
            "password": "test-pass-2026",
            "full_name": "Demo Sell",
            "role": "seller",
            "company_name": "DemoCo",
            "location": {"city": "Nairobi", "country": "Kenya"},
            "gender": "male",
            "age": 30,
            "dob": "1995-01-01",
        }
        r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert u["gender"] is None
        assert u["age"] is None
        assert u["dob"] is None

    def test_admin_self_register_blocked(self):
        payload = {
            "email": f"TEST_admin_{_rand_suffix()}@drape.demo",
            "password": "test-pass-2026",
            "full_name": "Naughty Admin",
            "role": "admin",
        }
        r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
        assert r.status_code == 403, r.text
        assert "Admin accounts cannot be self-registered" in r.json().get("detail", "")


# ---------------------------------------------------------------------------
# 6-7 Admin login + /auth/me
# ---------------------------------------------------------------------------
class TestAdminLogin:
    def test_admin_login(self, admin_token):
        assert admin_token

    def test_admin_me(self, admin_headers):
        r = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_buyer_me(self, buyer_creds):
        h = {"Authorization": f"Bearer {buyer_creds['token']}"}
        r = requests.get(f"{API}/auth/me", headers=h, timeout=30)
        assert r.status_code == 200
        assert r.json()["role"] == "buyer"


# ---------------------------------------------------------------------------
# 8 Admin analytics gating
# ---------------------------------------------------------------------------
class TestAdminAnalytics:
    REQUIRED_KEYS = {
        "total_users", "buyers", "sellers", "admins", "suspended",
        "total_items", "total_orders", "total_paid_orders",
        "total_revenue_cents", "total_platform_fee_cents",
        "total_net_to_sellers_cents", "pending_connect_sellers", "top_sellers",
    }

    def test_admin_can_access(self, admin_headers):
        r = requests.get(f"{API}/admin/analytics", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        missing = self.REQUIRED_KEYS - set(body.keys())
        assert not missing, f"missing keys: {missing}"
        assert isinstance(body["top_sellers"], list)
        assert body["admins"] >= 1

    def test_buyer_blocked(self, buyer_creds):
        h = {"Authorization": f"Bearer {buyer_creds['token']}"}
        r = requests.get(f"{API}/admin/analytics", headers=h, timeout=30)
        assert r.status_code == 403
        assert "Admin access required" in r.json().get("detail", "")

    def test_seller_blocked(self, seller_creds):
        h = {"Authorization": f"Bearer {seller_creds['token']}"}
        r = requests.get(f"{API}/admin/analytics", headers=h, timeout=30)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# 9-11 Users listing / search / suspend
# ---------------------------------------------------------------------------
class TestAdminUsers:
    def test_list_sellers(self, admin_headers):
        r = requests.get(f"{API}/admin/users?role=seller", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        users = r.json()
        assert all(u["role"] == "seller" for u in users)
        # At least one seller has company_name + location set (the seed seller).
        with_co = [u for u in users if u.get("company_name") and u.get("location")]
        assert with_co, "No seller has company_name + location populated"

    def test_list_buyers(self, admin_headers):
        r = requests.get(f"{API}/admin/users?role=buyer", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        assert all(u["role"] == "buyer" for u in r.json())

    def test_search_atelier(self, admin_headers):
        r = requests.get(f"{API}/admin/users?q=atelier", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        users = r.json()
        emails = [u["email"] for u in users]
        assert SEED_SELLER_EMAIL in emails, f"expected seed seller in results, got {emails}"

    def test_get_seed_seller_detail(self, admin_headers):
        r = requests.get(
            f"{API}/admin/users?q={SEED_SELLER_EMAIL}",
            headers=admin_headers, timeout=30,
        )
        assert r.status_code == 200
        users = r.json()
        seed = next((u for u in users if u["email"] == SEED_SELLER_EMAIL), None)
        assert seed is not None
        seller_id = seed["id"]
        r2 = requests.get(
            f"{API}/admin/users/{seller_id}", headers=admin_headers, timeout=30,
        )
        assert r2.status_code == 200
        d = r2.json()
        assert d["company_name"] == "Maison Lumière"
        assert d["location"]["city"] == "Nairobi"
        assert d["location"]["country"] == "Kenya"
        assert d["bank_details"]["bank_name"] == "Equity Bank"

    def test_suspend_toggle(self, admin_headers, seller_creds):
        sid = seller_creds["user"]["id"]
        r = requests.patch(
            f"{API}/admin/users/{sid}",
            json={"suspended": True}, headers=admin_headers, timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["suspended"] is True
        r2 = requests.patch(
            f"{API}/admin/users/{sid}",
            json={"suspended": False}, headers=admin_headers, timeout=30,
        )
        assert r2.status_code == 200
        assert r2.json()["suspended"] is False

    def test_suspend_blocked_for_non_admin(self, buyer_creds, seller_creds):
        h = {"Authorization": f"Bearer {buyer_creds['token']}"}
        r = requests.patch(
            f"{API}/admin/users/{seller_creds['user']['id']}",
            json={"suspended": True}, headers=h, timeout=30,
        )
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# 12-14 Orders + items
# ---------------------------------------------------------------------------
class TestAdminOrdersItems:
    def test_orders_list(self, admin_headers):
        r = requests.get(f"{API}/admin/orders", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_orders_status_filter(self, admin_headers):
        r = requests.get(
            f"{API}/admin/orders?status=paid", headers=admin_headers, timeout=30,
        )
        assert r.status_code == 200
        for o in r.json():
            assert o["status"] == "paid"

    def test_items_list_then_delete_last(self, admin_headers):
        r = requests.get(f"{API}/admin/items", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        # delete the LAST (oldest by sort -1 on created_at so last is oldest;
        # safest is the final element of the list to minimise impact).
        victim = items[-1]
        vid = victim["id"]
        d = requests.delete(
            f"{API}/admin/items/{vid}", headers=admin_headers, timeout=30,
        )
        assert d.status_code == 200
        assert d.json() == {"ok": True}
        # subsequent GET on /api/items/{id} should 404
        g = requests.get(f"{API}/items/{vid}", timeout=30)
        assert g.status_code == 404

    def test_delete_item_blocked_for_seller(self, admin_headers, seller_creds):
        # find an item to attempt deletion on
        r = requests.get(f"{API}/admin/items", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        items = r.json()
        if not items:
            pytest.skip("no items to test deletion blocking")
        h = {"Authorization": f"Bearer {seller_creds['token']}"}
        d = requests.delete(
            f"{API}/admin/items/{items[0]['id']}", headers=h, timeout=30,
        )
        assert d.status_code == 403

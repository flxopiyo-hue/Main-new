"""Iteration 21 — Oromona rebrand backend regression tests.

Covers:
  * New admin credentials (admin@oromona.com / oromona-admin-2026) work
    and old admin@drape.app credentials are rejected.
  * GET /api/subs/me for a fresh buyer returns plan_amount_kes=199 and
    gate.multi_angle_allowed=true.
  * POST /api/subs/checkout returns a paystack authorization_url and
    uses the Oromona Premium plan_code PLN_vh12k4j5951wd9v.
  * seed.py dry-run import does not raise.
  * Seller regression: atelier@aurafit.com still logs in and can list items.
"""

import importlib.util
import os
import sys
from pathlib import Path

import pytest
import requests


BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


# ---------- Auth / admin migration ----------
class TestAdminCredentialsMigration:
    def test_new_admin_login_succeeds(self, api_client):
        res = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@oromona.com", "password": "oromona-admin-2026"},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        assert "token" in data or "access_token" in data
        user = data.get("user") or {}
        assert user.get("role") == "admin"
        assert user.get("email") == "admin@oromona.com"

    def test_old_admin_login_fails(self, api_client):
        res = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@drape.app", "password": "drape-admin-2026"},
        )
        assert res.status_code in (400, 401, 403, 404), res.text


# ---------- Buyer subs/me + checkout ----------
class TestBuyerSubscriptionRebrand:
    @pytest.fixture(scope="class")
    def buyer_token(self, api_client):
        res = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "buyer@aurafit.com", "password": "demo-buyer-2026"},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        token = data.get("token") or data.get("access_token")
        assert token
        return token

    def test_subs_me_price_and_multi_angle_gate(self, api_client, buyer_token):
        res = api_client.get(
            f"{BASE_URL}/api/subs/me",
            headers={"Authorization": f"Bearer {buyer_token}"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        sub = body.get("subscription") or {}
        gate = body.get("gate") or {}
        assert sub.get("plan_amount_kes") == 199, f"expected 199, got {sub!r}"
        assert gate.get("multi_angle_allowed") is True

    def test_checkout_returns_paystack_url_with_oromona_plan(self, api_client, buyer_token):
        res = api_client.post(
            f"{BASE_URL}/api/subs/checkout",
            headers={"Authorization": f"Bearer {buyer_token}"},
            json={},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        url = data.get("authorization_url") or (data.get("data") or {}).get("authorization_url")
        assert url, f"missing authorization_url in {data}"
        assert "checkout.paystack.com" in url, url
        # Optional: plan_code in response if surfaced
        plan_code = data.get("plan_code") or (data.get("data") or {}).get("plan")
        if plan_code:
            assert plan_code == "PLN_vh12k4j5951wd9v", plan_code


# ---------- Seed script sanity ----------
class TestSeedScriptImport:
    def test_seed_module_imports_cleanly(self):
        # Import as a module without running __main__
        seed_path = Path("/app/backend/seed.py")
        spec = importlib.util.spec_from_file_location("_oromona_seed_dryrun", seed_path)
        assert spec and spec.loader
        mod = importlib.util.module_from_spec(spec)
        # Loading executes top-level code but not the __main__ block
        spec.loader.exec_module(mod)  # should not raise
        assert mod.ADMIN["email"] == "admin@oromona.com"
        assert mod.ADMIN["password"] == "oromona-admin-2026"


# ---------- Seller regression ----------
class TestSellerRegression:
    @pytest.fixture(scope="class")
    def seller_token(self, api_client):
        res = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "atelier@aurafit.com", "password": "demo-seller-2026"},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        return data.get("token") or data.get("access_token")

    def test_seller_login_and_list_items(self, api_client, seller_token):
        assert seller_token
        # try common seller-items endpoints
        candidates = ["/api/seller/items", "/api/items/mine", "/api/seller/inventory"]
        last_status = None
        for path in candidates:
            res = api_client.get(
                f"{BASE_URL}{path}",
                headers={"Authorization": f"Bearer {seller_token}"},
            )
            last_status = (path, res.status_code, res.text[:200])
            if res.status_code == 200:
                data = res.json()
                items = data if isinstance(data, list) else data.get("items") or data.get("data")
                assert isinstance(items, list)
                assert len(items) >= 1
                return
        pytest.fail(f"No seller items endpoint returned 200; last tried={last_status}")

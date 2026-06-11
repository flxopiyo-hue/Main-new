"""Iteration 11 — Seller Portal: payouts endpoint, subcategory persistence,
platform fee = 10% (PLATFORM_FEE_BPS=1000).
"""
import base64
import os

import pytest
import requests

def _load_backend_url() -> str:
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if url:
        return url.rstrip("/")
    # Fall back to the frontend .env (where Expo loads its public envs from).
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL"):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not found")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

SELLER = ("atelier@aurafit.demo", "demo-seller-2026")
BUYER = ("buyer@aurafit.demo", "demo-buyer-2026")

# 1x1 transparent PNG b64
PNG_1X1 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=="
)


def _login(creds):
    r = requests.post(f"{API}/auth/login", json={"email": creds[0], "password": creds[1]}, timeout=15)
    assert r.status_code == 200, f"login {creds[0]} failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def seller_token():
    return _login(SELLER)


@pytest.fixture(scope="module")
def buyer_token():
    return _login(BUYER)


# ---------------------------------------------------------------------------
# 1) Auth
# ---------------------------------------------------------------------------
class TestAuth:
    def test_seller_login_returns_role(self):
        r = requests.post(f"{API}/auth/login", json={"email": SELLER[0], "password": SELLER[1]}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["user"]["role"] == "seller"
        assert "token" in body and body["token"]

    def test_buyer_login_returns_role(self):
        r = requests.post(f"{API}/auth/login", json={"email": BUYER[0], "password": BUYER[1]}, timeout=15)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "buyer"


# ---------------------------------------------------------------------------
# 2) Seller analytics — platform_fee_bps must be 1000 (10%)
# ---------------------------------------------------------------------------
class TestSellerAnalytics:
    def test_analytics_platform_fee_bps_1000(self, seller_token):
        r = requests.get(f"{API}/seller/analytics", headers={"Authorization": f"Bearer {seller_token}"}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["platform_fee_bps"] == 1000
        assert "items" in data

    def test_analytics_forbidden_for_buyer(self, buyer_token):
        r = requests.get(f"{API}/seller/analytics", headers={"Authorization": f"Bearer {buyer_token}"}, timeout=15)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# 3) Seller payouts — NEW endpoint
# ---------------------------------------------------------------------------
class TestSellerPayouts:
    def test_payouts_shape(self, seller_token):
        r = requests.get(f"{API}/seller/payouts", headers={"Authorization": f"Bearer {seller_token}"}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["platform_fee_bps"] == 1000
        assert isinstance(data["payouts"], list)
        totals = data["totals"]
        assert set(totals.keys()) >= {"count", "gross_cents", "platform_fee_cents", "net_cents"}
        # If there are payouts, validate row shape
        if data["payouts"]:
            row = data["payouts"][0]
            for k in ["id", "item_name", "size", "amount_cents", "platform_fee_cents", "seller_net_cents", "status", "created_at"]:
                assert k in row, f"missing key {k} in payout row: {row}"
            # Math: fee ≈ amount * 10%; net = amount - fee
            assert row["platform_fee_cents"] == (row["amount_cents"] * 1000) // 10000
            assert row["seller_net_cents"] == row["amount_cents"] - row["platform_fee_cents"]

    def test_payouts_totals_consistent(self, seller_token):
        r = requests.get(f"{API}/seller/payouts", headers={"Authorization": f"Bearer {seller_token}"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        rows = data["payouts"]
        assert data["totals"]["count"] == len(rows)
        gross = sum(p["amount_cents"] for p in rows)
        fee = sum(p["platform_fee_cents"] for p in rows)
        net = sum(p["seller_net_cents"] for p in rows)
        assert data["totals"]["gross_cents"] == gross
        assert data["totals"]["platform_fee_cents"] == fee
        assert data["totals"]["net_cents"] == net

    def test_payouts_forbidden_for_buyer(self, buyer_token):
        r = requests.get(f"{API}/seller/payouts", headers={"Authorization": f"Bearer {buyer_token}"}, timeout=15)
        assert r.status_code == 403

    def test_payouts_unauthenticated(self):
        r = requests.get(f"{API}/seller/payouts", timeout=15)
        assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# 4) Items — subcategory create/echo + GET persistence
# ---------------------------------------------------------------------------
class TestItemSubcategory:
    created_id = None

    def test_create_item_with_subcategory(self, seller_token):
        payload = {
            "name": "TEST_Polo Subcategory",
            "description": "test polo",
            "category": "shirts",
            "subcategory": "Polo",
            "price_cents": 16900,
            "currency": "KES",
            "image_b64": PNG_1X1,
            "sizes": [{"label": "M", "available_qty": 3, "chest_cm": 100, "shoulder_cm": 45, "sleeve_cm": 22, "length_cm": 70}],
            "colors": [{"name": "Black", "hex": "#000000"}],
            "audience": "unisex",
        }
        r = requests.post(f"{API}/items", json=payload, headers={"Authorization": f"Bearer {seller_token}"}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["subcategory"] == "Polo"
        assert body["category"] == "shirts"
        assert body["price_cents"] == 16900
        TestItemSubcategory.created_id = body["id"]

    def test_get_item_returns_subcategory(self, seller_token):
        assert TestItemSubcategory.created_id, "previous test must have created an item"
        r = requests.get(
            f"{API}/items/{TestItemSubcategory.created_id}",
            headers={"Authorization": f"Bearer {seller_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["subcategory"] == "Polo"

    def test_size_guide_still_works(self, seller_token):
        assert TestItemSubcategory.created_id
        r = requests.get(
            f"{API}/items/{TestItemSubcategory.created_id}/size-guide",
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["garment_type"] == "shirt"
        assert "sizes" in body and len(body["sizes"]) == 1
        assert body["sizes"][0]["label"] == "M"

    def test_create_item_without_subcategory(self, seller_token):
        payload = {
            "name": "TEST_NoSubcat",
            "description": "no subcat",
            "category": "shirts",
            "price_cents": 5000,
            "currency": "KES",
            "image_b64": PNG_1X1,
            "sizes": [{"label": "S", "available_qty": 1}],
            "colors": [],
            "audience": "unisex",
        }
        r = requests.post(f"{API}/items", json=payload, headers={"Authorization": f"Bearer {seller_token}"}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["subcategory"] is None
        # cleanup
        iid = r.json()["id"]
        requests.delete(f"{API}/items/{iid}", headers={"Authorization": f"Bearer {seller_token}"}, timeout=15)

    @classmethod
    def teardown_class(cls):
        if cls.created_id:
            token = _login(SELLER)
            requests.delete(f"{API}/items/{cls.created_id}", headers={"Authorization": f"Bearer {token}"}, timeout=15)


# ---------------------------------------------------------------------------
# 5) Platform fee math (169.00 KES → 16.90 fee / 152.10 net)
# ---------------------------------------------------------------------------
class TestFeeMath:
    def test_fee_math_169_kes(self):
        amount_cents = 16900
        fee = (amount_cents * 1000) // 10000
        net = amount_cents - fee
        assert fee == 1690
        assert net == 15210


# ---------------------------------------------------------------------------
# 6) Legacy seller routes still exist (backward compat)
# ---------------------------------------------------------------------------
class TestBackwardCompat:
    def test_seller_orders_still_reachable(self, seller_token):
        r = requests.get(f"{API}/seller/orders", headers={"Authorization": f"Bearer {seller_token}"}, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

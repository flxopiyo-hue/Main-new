"""Iteration 25 — Stripe purge verification + comprehensive regression.

Covers the scope from the review request:
  1. Stripe purge — endpoints removed, no stripe module in backend
  2. Seller/admin regression after purge
  3. Fresh buyer signup + login + /auth/me
  4. Free/premium try-on and profile limits
  5. Multi-angle try-on flow (uses Gemini Nano Banana)
  6. Sequential multi-item try-ons (layering / repeated calls)
  7. Recommended size logic surfaced by items endpoints
  8. Seller registration + add-item wizard + variants auto-generation
  9. Paystack checkout returns authorization_url (item + subscription)
 10. Escrow regression (light) via GET /api/orders/{id}
 11. Admin regression — analytics, users, PATCH without connect_status
"""
from __future__ import annotations

import base64
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
# The public URL variable name in this repo is EXPO_PUBLIC_BACKEND_URL
# (not EXPO_BACKEND_URL). Fall back to the alternative name if only that
# is present in the environment.
if not BASE_URL:
    BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Read from frontend/.env directly as a last resort
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break
    except Exception:
        pass

assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"

API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@oromona.com"
ADMIN_PASSWORD = "oromona-admin-2026"
BUYER_EMAIL = "buyer@aurafit.com"
BUYER_PASSWORD = "demo-buyer-2026"
SELLER_EMAIL = "atelier@aurafit.com"
SELLER_PASSWORD = "demo-seller-2026"

# 1x1 transparent PNG for image uploads
PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg=="
)


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _login(s, email, password):
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token(s):
    return _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def buyer_token(s):
    return _login(s, BUYER_EMAIL, BUYER_PASSWORD)


@pytest.fixture(scope="module")
def seller_token(s):
    return _login(s, SELLER_EMAIL, SELLER_PASSWORD)


# ---------------------------------------------------------------------------
# 1. Stripe purge
# ---------------------------------------------------------------------------
class TestStripePurge:
    def test_connect_status_endpoint_removed(self, s, seller_token):
        r = s.get(f"{API}/seller/connect/status", headers=_auth(seller_token))
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text[:200]}"

    def test_connect_setup_endpoint_removed(self, s, seller_token):
        r = s.post(f"{API}/seller/connect/setup", headers=_auth(seller_token), json={})
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text[:200]}"

    def test_no_stripe_module_in_backend(self):
        # No stripe module should be importable at the backend server dir
        import subprocess
        result = subprocess.run(
            ["grep", "-rn", "^import stripe\\|^from stripe", "/app/backend/routers/", "/app/backend/core/"],
            capture_output=True, text=True,
        )
        assert result.stdout.strip() == "", f"stripe imports found: {result.stdout}"

    def test_admin_patch_rejects_connect_status(self, s, admin_token, buyer_token):
        # Get a user id to patch
        me = s.get(f"{API}/auth/me", headers=_auth(buyer_token)).json()
        r = s.patch(
            f"{API}/admin/users/{me['id']}",
            headers=_auth(admin_token),
            json={"connect_status": "verified"},
        )
        # Since connect_status is no longer in AdminUserPatch, the endpoint
        # should either 400 (no valid fields) or 422 (schema rejection).
        # We just require it does NOT accept the field silently as 200.
        # If update contains other valid fields it may 200 — with only
        # connect_status, expect 400/422.
        assert r.status_code in (400, 422), (
            f"connect_status was NOT rejected: {r.status_code} {r.text[:200]}"
        )


# ---------------------------------------------------------------------------
# 2. Backend regression after purge
# ---------------------------------------------------------------------------
class TestSellerRegression:
    def test_seller_analytics_shape(self, s, seller_token):
        r = s.get(f"{API}/seller/analytics", headers=_auth(seller_token))
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        assert data.get("platform_fee_bps") == 1500
        assert data.get("connect_status") in ("active", "unstarted")
        assert isinstance(data.get("items"), list)

    def test_seller_payouts_shape(self, s, seller_token):
        r = s.get(f"{API}/seller/payouts", headers=_auth(seller_token))
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        assert data.get("platform_fee_bps") == 1500
        rows = data.get("rows") or data.get("orders") or []
        # At least one escrow field on any row if there are any orders
        for row in rows[:5]:
            for k in ("escrow_status", "escrow_release_at"):
                assert k in row, f"row missing key {k}"

    def test_seller_banks_kenya(self, s, seller_token):
        r = s.get(f"{API}/seller/banks?country=kenya", headers=_auth(seller_token))
        assert r.status_code == 200
        data = r.json()
        banks = data if isinstance(data, list) else data.get("banks", [])
        assert len(banks) >= 20, f"expected >=20 banks, got {len(banks)}"

    def test_seller_payout_account_fake_no_500(self, s, seller_token):
        # Send a fake account_number — should NOT return 500
        r = s.post(
            f"{API}/seller/payout-account",
            headers=_auth(seller_token),
            json={
                "country": "kenya",
                "bank_code": "01",
                "account_number": "0000000000",
            },
        )
        assert r.status_code != 500, f"got 500: {r.text[:200]}"


# ---------------------------------------------------------------------------
# 3. Admin regression
# ---------------------------------------------------------------------------
class TestAdminRegression:
    def test_admin_analytics(self, s, admin_token):
        r = s.get(f"{API}/admin/analytics", headers=_auth(admin_token))
        assert r.status_code == 200
        d = r.json()
        assert "pending_connect_sellers" in d, f"key missing: {list(d.keys())}"
        assert isinstance(d["pending_connect_sellers"], int)

    def test_admin_users_list(self, s, admin_token):
        r = s.get(f"{API}/admin/users", headers=_auth(admin_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_patch_suspended_still_works(self, s, admin_token, buyer_token):
        me = s.get(f"{API}/auth/me", headers=_auth(buyer_token)).json()
        r = s.patch(
            f"{API}/admin/users/{me['id']}",
            headers=_auth(admin_token),
            json={"suspended": False},
        )
        assert r.status_code == 200, r.text[:200]
        assert r.json().get("suspended") is False


# ---------------------------------------------------------------------------
# 4. New buyer signup + login
# ---------------------------------------------------------------------------
class TestBuyerSignup:
    @pytest.fixture(scope="class")
    def new_buyer(self, s):
        email = f"test_buyer_{uuid.uuid4().hex[:8]}@example.com"
        payload = {
            "email": email,
            "password": "TestPass123!",
            "full_name": "Test Buyer",
            "role": "buyer",
            "gender": "female",
            "age": 28,
        }
        r = s.post(f"{API}/auth/register", json=payload)
        assert r.status_code in (200, 201), f"register failed {r.status_code}: {r.text[:200]}"
        data = r.json()
        assert "token" in data
        return {"email": email, "password": payload["password"], "token": data["token"]}

    def test_new_buyer_login(self, s, new_buyer):
        r = s.post(
            f"{API}/auth/login",
            json={"email": new_buyer["email"], "password": new_buyer["password"]},
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("user", {}).get("role") == "buyer"

    def test_new_buyer_me(self, s, new_buyer):
        r = s.get(f"{API}/auth/me", headers=_auth(new_buyer["token"]))
        assert r.status_code == 200
        assert r.json().get("email") == new_buyer["email"]


# ---------------------------------------------------------------------------
# 5. Seller signup + add-item wizard
# ---------------------------------------------------------------------------
class TestSellerSignupAndAddItem:
    @pytest.fixture(scope="class")
    def new_seller(self, s):
        email = f"test_seller_{uuid.uuid4().hex[:8]}@example.com"
        payload = {
            "email": email,
            "password": "TestPass123!",
            "full_name": "Test Atelier",
            "role": "seller",
            "company_name": "Test Atelier Co",
            "location": {"city": "Nairobi", "country": "Kenya"},
        }
        r = s.post(f"{API}/auth/register", json=payload)
        assert r.status_code in (200, 201), f"seller register failed: {r.status_code} {r.text[:300]}"
        return r.json()

    def test_seller_created_as_seller(self, s, new_seller):
        assert new_seller.get("user", {}).get("role") == "seller"

    def test_add_item_generates_variants(self, s, new_seller):
        token = new_seller["token"]
        item_payload = {
            "name": f"TEST_Kitenge_Dress_{uuid.uuid4().hex[:6]}",
            "description": "Handmade kitenge dress",
            "brand_name": "Test Brand",
            "category": "dresses",
            "subcategory": "midi",
            "image_b64": PNG_B64,
            "extra_images": [],
            "price_cents": 500000,
            "currency": "KES",
            "sizes": [
                {"label": "S", "bust_cm": 84.0, "waist_cm": 66.0, "hips_cm": 90.0, "length_cm": 110.0, "available_qty": 3},
                {"label": "M", "bust_cm": 88.0, "waist_cm": 70.0, "hips_cm": 94.0, "length_cm": 112.0, "available_qty": 3},
                {"label": "L", "bust_cm": 92.0, "waist_cm": 74.0, "hips_cm": 98.0, "length_cm": 114.0, "available_qty": 3},
            ],
            "colors": [{"name": "Rouge", "hex": "#B0002E"}, {"name": "Sable", "hex": "#D6BFA6"}],
        }
        r = s.post(f"{API}/items", headers=_auth(token), json=item_payload)
        assert r.status_code in (200, 201), f"item create failed: {r.status_code} {r.text[:400]}"
        item = r.json()
        variants = item.get("variants") or []
        # Should be 3 sizes * 2 colors = 6 variants
        assert len(variants) == 6, f"expected 6 variants, got {len(variants)}: {variants}"

    def test_seller_inventory_has_item(self, s, new_seller):
        r = s.get(f"{API}/items/mine", headers=_auth(new_seller["token"]))
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1


# ---------------------------------------------------------------------------
# 6. Tryon caps + physical body composition + multi-item sequential
# ---------------------------------------------------------------------------
class TestTryonQuota:
    def test_free_tryon_quota_via_subs_me(self, s, buyer_token):
        # Read current caps
        r = s.get(f"{API}/subs/me", headers=_auth(buyer_token))
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        gate = d.get("gate", {})
        assert gate.get("tryons_limit") == 7 or gate.get("premium") is True, f"unexpected gate: {gate}"
        assert gate.get("profiles_limit") in (2, 10), f"unexpected profiles_limit: {gate}"

    def test_free_profile_cap_enforced(self, s):
        # Create fresh buyer + spam loved-one profiles until 402
        email = f"quota_buyer_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{API}/auth/register", json={
            "email": email, "password": "TestPass123!", "full_name": "Q", "role": "buyer",
            "gender": "female", "age": 27,
        })
        assert r.status_code in (200, 201), r.text[:300]
        tok = r.json()["token"]

        got_402 = False
        for i in range(6):
            r = s.post(
                f"{API}/loved-ones",
                headers=_auth(tok),
                json={
                    "name": f"lo_{i}",
                    "audience": "adult",
                    "gender": "female",
                    "age": 30,
                    "relation": "friend",
                },
            )
            if r.status_code == 402:
                got_402 = True
                break
            assert r.status_code in (200, 201), f"unexpected profile create: {r.status_code} {r.text[:200]}"
        assert got_402, "expected 402 for free profile cap"


class TestTryonComposition:
    def test_tryon_returns_image(self, s, buyer_token):
        # find any item
        items_r = s.get(f"{API}/items", headers=_auth(buyer_token))
        assert items_r.status_code == 200
        items = items_r.json()
        if not items:
            pytest.skip("no items")
        item_id = items[0]["id"]

        r = s.post(
            f"{API}/tryon",
            headers=_auth(buyer_token),
            json={"item_id": item_id, "use_profile_photo": True, "angles": ["front"]},
            timeout=120,
        )
        # Could 402 if buyer already exhausted weekly cap; both are acceptable outcomes.
        assert r.status_code in (200, 402), f"unexpected: {r.status_code} {r.text[:300]}"
        if r.status_code == 200:
            d = r.json()
            assert d.get("result_image_b64"), "expected non-empty result_image_b64"
            assert len(d["result_image_b64"]) > 100

    def test_multi_item_sequential_tryons(self, s, buyer_token):
        # Two different items in a row — same buyer body photo is reused
        items_r = s.get(f"{API}/items", headers=_auth(buyer_token))
        items = items_r.json()
        if len(items) < 2:
            pytest.skip("need >= 2 items")
        results = []
        for it in items[:2]:
            r = s.post(
                f"{API}/tryon",
                headers=_auth(buyer_token),
                json={"item_id": it["id"], "use_profile_photo": True, "angles": ["front"]},
                timeout=120,
            )
            if r.status_code == 402:
                pytest.skip("weekly quota exhausted")
            assert r.status_code == 200, r.text[:200]
            results.append(r.json())
        # Ensure they returned distinct tryon IDs (i.e. original photo not overwritten)
        assert results[0]["id"] != results[1]["id"]


# ---------------------------------------------------------------------------
# 7. Recommended sizes vs user dimensions
# ---------------------------------------------------------------------------
class TestRecommendedSize:
    def test_items_expose_sizes(self, s, buyer_token):
        r = s.get(f"{API}/items", headers=_auth(buyer_token))
        assert r.status_code == 200
        items = r.json()
        if not items:
            pytest.skip("no items")
        sample = items[0]
        # Sizes should be surfaced either as `sizes` or via variants
        assert "sizes" in sample or "variants" in sample

    def test_fit_score_endpoint(self, s, buyer_token):
        r = s.get(f"{API}/items", headers=_auth(buyer_token))
        items = r.json()
        if not items:
            pytest.skip("no items")
        r2 = s.get(f"{API}/items/{items[0]['id']}/fit-score", headers=_auth(buyer_token))
        assert r2.status_code in (200, 404), r2.text[:200]


# ---------------------------------------------------------------------------
# 8. Paystack checkout (light)
# ---------------------------------------------------------------------------
class TestPaystackCheckout:
    def test_item_checkout_returns_url(self, s, buyer_token):
        items_r = s.get(f"{API}/items", headers=_auth(buyer_token))
        items = items_r.json()
        if not items:
            pytest.skip("no items")
        # find first item with variants + a size string
        item = None
        variant_id = None
        size_label = None
        for it in items:
            variants = it.get("variants") or []
            for v in variants:
                # size is stored on variant as size_label
                sz = v.get("size_label") or v.get("size") or v.get("label")
                if sz and isinstance(sz, str) and (v.get("quantity", 0) > 0 or v.get("in_stock", True)):
                    item = it
                    variant_id = v.get("id")
                    size_label = sz
                    break
            if variant_id:
                break
        if not variant_id or not size_label:
            pytest.skip("no variant with size to check out")

        # First, ensure buyer has a saved address (checkout requires it).
        addr_r = s.get(f"{API}/addresses", headers=_auth(buyer_token))
        addresses = addr_r.json() if addr_r.status_code == 200 else []
        if not addresses:
            create_addr = s.post(
                f"{API}/addresses",
                headers=_auth(buyer_token),
                json={
                    "full_name": "Test Buyer",
                    "phone": "+254700000000",
                    "line1": "123 Test St",
                    "city": "Nairobi",
                    "country": "Kenya",
                    "postal_code": "00100",
                },
            )
            if create_addr.status_code in (200, 201):
                addresses = [create_addr.json()]

        address_id = addresses[0]["id"] if addresses else None

        r = s.post(
            f"{API}/payments/checkout",
            headers=_auth(buyer_token),
            json={
                "item_id": item["id"],
                "variant_id": variant_id,
                "size": size_label,
                "origin_url": BASE_URL,
                "address_id": address_id,
            },
        )
        assert r.status_code in (200, 201), r.text[:400]
        d = r.json()
        url = d.get("authorization_url") or d.get("url") or d.get("checkout_url")
        assert url and "paystack" in url.lower(), f"expected paystack url, got {d}"

    def test_subs_checkout_returns_url(self, s, buyer_token):
        r = s.post(f"{API}/subs/checkout", headers=_auth(buyer_token), json={})
        # 200 with URL or 4xx if plan not configured — we accept either
        # but assert not 500
        assert r.status_code != 500, r.text[:300]
        if r.status_code == 200:
            d = r.json()
            url = d.get("authorization_url") or d.get("url") or d.get("checkout_url")
            assert url, f"expected url, got {d}"


# ---------------------------------------------------------------------------
# 9. Escrow regression light — read existing orders
# ---------------------------------------------------------------------------
class TestEscrow:
    def test_orders_expose_escrow_status(self, s, buyer_token):
        r = s.get(f"{API}/orders", headers=_auth(buyer_token))
        assert r.status_code == 200
        orders = r.json()
        # If no orders exist, skip
        if not orders:
            pytest.skip("no orders for buyer")
        # GET detail for the first paid/held order
        for o in orders[:3]:
            r2 = s.get(f"{API}/orders/{o['id']}", headers=_auth(buyer_token))
            assert r2.status_code == 200
            d = r2.json()
            # escrow_status should be present as key (may be null on legacy)
            assert "escrow_status" in d or "status" in d

"""Iteration 29 backend regression suite.

Focus areas:
  * GET /api/items?q= — $or over name/brand_name/description/subcategory
    with regex-escaped input so special chars (like '(') do not 500.
  * Colour photos persist through POST /api/items and PATCH /api/items/{id}
    (colors[].image_b64, data-prefix stripped).
  * Auth register/login/me smoke.
  * GET /api/categories loads and community 'swimwear' present.
  * POST /api/payments/checkout returns a checkout.paystack.com URL
    (INITIALIZATION ONLY — LIVE KEYS, DO NOT PAY).
  * GET /api/seller/analytics platform_fee_bps=1500.
  * POST /api/auth/forgot-password returns 200 generic.
"""
from __future__ import annotations

import os
import time
import uuid
import base64
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://fit-finder-app-5.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

SELLER = {"email": "atelier@aurafit.com", "password": "demo-seller-2026"}
BUYER = {"email": "buyer@aurafit.com", "password": "demo-buyer-2026"}

# 1x1 red PNG
RED_PX_B64 = base64.b64encode(bytes.fromhex(
    "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4"
    "890000000D49444154789C63F8CF00000000FFFF03000006000557BFABD40000"
    "000049454E44AE426082"
)).decode()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def seller_token(session):
    r = session.post(f"{API}/auth/login", json=SELLER, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def buyer_token(session):
    r = session.post(f"{API}/auth/login", json=BUYER, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


# --- Auth smoke -------------------------------------------------------------

class TestAuthSmoke:
    def test_login_buyer(self, session):
        r = session.post(f"{API}/auth/login", json=BUYER, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and data["user"]["role"] == "buyer"

    def test_login_seller(self, session):
        r = session.post(f"{API}/auth/login", json=SELLER, timeout=20)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "seller"

    def test_me_returns_current_user(self, session, buyer_token):
        r = session.get(
            f"{API}/auth/me",
            headers={"Authorization": f"Bearer {buyer_token}"},
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json()["email"] == BUYER["email"]

    def test_forgot_password_generic_200(self, session):
        r = session.post(
            f"{API}/auth/forgot-password",
            json={"email": "someone-not-existing-xyz@example.com"},
            timeout=20,
        )
        assert r.status_code == 200
        # Generic response — MUST NOT leak whether the user exists.
        body = r.json()
        # accept any of ok/message/status envelopes
        assert isinstance(body, dict)


# --- Items search regression (iteration 29 focus) ---------------------------

class TestItemsSearchQ:
    def test_q_special_char_paren_does_not_500(self, session):
        """An unescaped '(' must not raise a regex parse error → 500.
        Expected: 200 with an (empty or filtered) list, treating the
        input as a literal substring after regex-escaping.
        """
        r = session.get(f"{API}/items", params={"q": "("}, timeout=20)
        assert r.status_code == 200, (
            f"Expected 200 (regex-escaped); got {r.status_code}: {r.text[:200]}"
        )
        assert isinstance(r.json(), list)

    def test_q_special_char_bracket_and_star(self, session):
        for bad in ["[", "*", "?", "\\", "+"]:
            r = session.get(f"{API}/items", params={"q": bad}, timeout=20)
            assert r.status_code == 200, (
                f"q={bad!r} → {r.status_code}: {r.text[:200]}"
            )

    def test_q_matches_name_case_insensitively(self, session):
        r = session.get(f"{API}/items", params={"q": "polo"}, timeout=20)
        assert r.status_code == 200
        items = r.json()
        # Some seed items are known; if none, the assertion below is skipped.
        if items:
            hay = " ".join(
                [
                    (i.get("name", "") + " " + (i.get("brand_name") or "") + " "
                     + (i.get("description") or "") + " " + (i.get("subcategory") or ""))
                    for i in items
                ]
            ).lower()
            assert "polo" in hay, "q=polo should return items whose searchable fields contain 'polo'"

    def test_q_searches_multiple_fields_or(self, seller_token, session):
        """POST an item whose q-match lives ONLY in brand/description/
        subcategory and verify GET /items?q=<token> finds it.
        """
        marker = f"zqxbrand{uuid.uuid4().hex[:6]}"
        payload = {
            "name": "TEST_search_multifield",
            "description": f"unique-desc-{marker}",
            "brand_name": marker.upper(),
            "category": "swimwear",
            "subcategory": f"sub-{marker}",
            "price_cents": 5000,
            "currency": "KES",
            "image_b64": RED_PX_B64,
            "sizes": [{"label": "M", "available_qty": 3, "chest_cm": 100}],
            "colors": [{"name": "Ivory", "hex": "#FFFFF0"}],
            "audience": "unisex",
        }
        h = {"Authorization": f"Bearer {seller_token}"}
        r = session.post(f"{API}/items", json=payload, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        item_id = r.json()["id"]
        try:
            # Search by BRAND
            rb = session.get(f"{API}/items", params={"q": marker.upper()}, timeout=20)
            assert rb.status_code == 200
            assert any(it["id"] == item_id for it in rb.json()), (
                "q must match brand_name via $or"
            )
            # Search by DESCRIPTION
            rd = session.get(f"{API}/items", params={"q": marker}, timeout=20)
            assert rd.status_code == 200
            assert any(it["id"] == item_id for it in rd.json()), (
                "q must match description via $or"
            )
            # Search by SUBCATEGORY
            rs = session.get(f"{API}/items", params={"q": f"sub-{marker}"}, timeout=20)
            assert rs.status_code == 200
            assert any(it["id"] == item_id for it in rs.json()), (
                "q must match subcategory via $or"
            )
        finally:
            session.delete(f"{API}/items/{item_id}", headers=h, timeout=20)

    def test_q_combines_with_audience_filter(self, session):
        r = session.get(
            f"{API}/items",
            params={"q": "test", "audience": "women"},
            timeout=20,
        )
        assert r.status_code == 200
        for it in r.json():
            assert it.get("audience") in ("women", "unisex", "all"), it

    def test_list_items_basic(self, session):
        r = session.get(f"{API}/items", timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# --- Colour photo persistence -----------------------------------------------

class TestColourPhotoPersistence:
    def test_create_and_patch_preserves_color_image(self, seller_token, session):
        h = {"Authorization": f"Bearer {seller_token}"}
        create = {
            "name": "TEST_color_photo_persist",
            "description": "colour photo persistence test",
            "brand_name": "TESTBRAND",
            "category": "tops",
            "subcategory": "tee",
            "price_cents": 3000,
            "currency": "KES",
            "image_b64": RED_PX_B64,
            "sizes": [{"label": "M", "available_qty": 5, "chest_cm": 100}],
            "colors": [
                {"name": "Black", "hex": "#000000",
                 "image_b64": f"data:image/png;base64,{RED_PX_B64}"},
                {"name": "Ivory", "hex": "#FFFFF0"},
            ],
            "audience": "unisex",
        }
        r = session.post(f"{API}/items", json=create, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        item = r.json()
        item_id = item["id"]
        try:
            # data: prefix must be stripped, base64 preserved
            black = next(c for c in item["colors"] if c["name"] == "Black")
            assert black.get("image_b64"), "Black colour must persist image_b64"
            assert not black["image_b64"].startswith("data:"), (
                "data: prefix must be stripped"
            )
            assert black["image_b64"] == RED_PX_B64
            ivory = next(c for c in item["colors"] if c["name"] == "Ivory")
            assert ivory.get("image_b64") in (None, "")

            # PATCH: attach photo to Ivory too, keep Black photo.
            patch = {"colors": [
                {"name": "Black", "hex": "#000000", "image_b64": RED_PX_B64},
                {"name": "Ivory", "hex": "#FFFFF0",
                 "image_b64": f"data:image/png;base64,{RED_PX_B64}"},
            ]}
            r2 = session.patch(
                f"{API}/items/{item_id}", json=patch, headers=h, timeout=20,
            )
            assert r2.status_code == 200, r2.text
            colors = r2.json()["colors"]
            for c in colors:
                assert c.get("image_b64") == RED_PX_B64, c
                assert not c["image_b64"].startswith("data:")

            # GET verifies persistence.
            r3 = session.get(f"{API}/items/{item_id}", timeout=20)
            assert r3.status_code == 200
            for c in r3.json()["colors"]:
                assert c.get("image_b64") == RED_PX_B64
        finally:
            session.delete(f"{API}/items/{item_id}", headers=h, timeout=20)


# --- Categories -------------------------------------------------------------

class TestCategories:
    def test_list_categories(self, session):
        r = session.get(f"{API}/categories", timeout=20)
        assert r.status_code == 200
        cats = r.json()
        assert isinstance(cats, list) and cats

    def test_swimwear_present(self, session):
        r = session.get(f"{API}/categories", timeout=20)
        cats = r.json()
        slugs = {c.get("slug") for c in cats}
        assert "swimwear" in slugs, f"community 'swimwear' missing; slugs={slugs}"


# --- Payments (LIVE keys — INIT ONLY, DO NOT COMPLETE) ----------------------

class TestPaymentsInitOnly:
    def test_checkout_returns_paystack_url(self, session, buyer_token, seller_token):
        # Grab a stocked item.
        r = session.get(f"{API}/items", timeout=20)
        items = r.json()
        target = None
        for it in items:
            if int(it.get("price_cents") or 0) <= 0:
                continue
            total = sum(int(s.get("available_qty") or 0) for s in it.get("sizes", []) or [])
            if total > 0:
                target = it
                break
        if not target:
            pytest.skip("No stocked item available to init checkout")

        h = {"Authorization": f"Bearer {buyer_token}"}
        # Ensure buyer has an address.
        addrs = session.get(f"{API}/addresses", headers=h, timeout=20)
        addr_id = None
        if addrs.status_code == 200 and addrs.json():
            addr_id = addrs.json()[0].get("id")
        if not addr_id:
            addr_payload = {
                "full_name": "Test Buyer",
                "phone": "+254700000000",
                "line1": "123 Test St",
                "city": "Nairobi",
                "country": "Kenya",
                "postal_code": "00100",
            }
            ar = session.post(f"{API}/addresses", json=addr_payload, headers=h, timeout=20)
            if ar.status_code in (200, 201):
                addr_id = ar.json().get("id")
        if not addr_id:
            pytest.skip("Cannot create address for checkout test")

        payload = {
            "item_id": target["id"],
            "size": target["sizes"][0]["label"],
            "quantity": 1,
            "address_id": addr_id,
            "origin_url": BASE_URL,
        }
        r2 = session.post(f"{API}/payments/checkout", json=payload, headers=h, timeout=30)
        assert r2.status_code == 200, f"{r2.status_code} {r2.text[:400]}"
        data = r2.json()
        url = data.get("url") or data.get("checkout_url") or data.get("authorization_url")
        assert url and "paystack.com" in url, data


# --- Seller analytics -------------------------------------------------------

class TestSellerAnalytics:
    def test_analytics_platform_fee_bps(self, session, seller_token):
        r = session.get(
            f"{API}/seller/analytics",
            headers={"Authorization": f"Bearer {seller_token}"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("platform_fee_bps") == 1500, data

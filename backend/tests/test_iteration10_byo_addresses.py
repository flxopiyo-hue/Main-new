"""Iteration 10 backend tests: BYO Try-On + multi-address delivery book.

Covers:
- BYO Garment Try-On validation + role gating
- Address CRUD (create/list/patch/set-default/delete + defaulting semantics)
- Checkout requires address_id and snapshots shipping_address into orders
- Order detail surfaces shipping_address
"""

import os
import base64
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fit-finder-app-5.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

BUYER_EMAIL = "buyer@aurafit.demo"
BUYER_PASS = "demo-buyer-2026"
SELLER_EMAIL = "atelier@aurafit.demo"
SELLER_PASS = "demo-seller-2026"

# tiny 1x1 jpg-ish bytes (any base64 string works for validation paths)
TINY_B64 = base64.b64encode(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00").decode()


# ---------------------------------------------------------------------------
# Auth fixtures
# ---------------------------------------------------------------------------
def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def buyer_token():
    return _login(BUYER_EMAIL, BUYER_PASS)


@pytest.fixture(scope="module")
def seller_token():
    return _login(SELLER_EMAIL, SELLER_PASS)


@pytest.fixture
def buyer_headers(buyer_token):
    return {"Authorization": f"Bearer {buyer_token}", "Content-Type": "application/json"}


@pytest.fixture
def seller_headers(seller_token):
    return {"Authorization": f"Bearer {seller_token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _cleanup_addresses(headers):
    r = requests.get(f"{API}/addresses", headers=headers, timeout=20)
    if r.status_code == 200:
        for a in r.json():
            requests.delete(f"{API}/addresses/{a['id']}", headers=headers, timeout=20)


# ---------------------------------------------------------------------------
# BYO Try-On validation tests (skipping full Gemini render to keep fast)
# ---------------------------------------------------------------------------
class TestBYOValidation:
    def test_byo_missing_garment_returns_400(self, buyer_headers):
        body = {"garment_b64": "", "use_profile_photo": True, "profile_id": "self", "angles": ["front"]}
        r = requests.post(f"{API}/tryon/garment", json=body, headers=buyer_headers, timeout=30)
        # Pydantic may catch empty string as missing; either 400 or 422 acceptable
        assert r.status_code in (400, 422), f"got {r.status_code}: {r.text}"
        if r.status_code == 400:
            assert "garment" in r.text.lower()

    def test_byo_invalid_profile_id_returns_404(self, buyer_headers):
        body = {
            "garment_b64": TINY_B64,
            "garment_type": "shirt",
            "use_profile_photo": True,
            "profile_id": "nonexistent-uuid-zzzz",
            "angles": ["front"],
        }
        r = requests.post(f"{API}/tryon/garment", json=body, headers=buyer_headers, timeout=30)
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"

    def test_byo_seller_forbidden(self, seller_headers):
        body = {
            "garment_b64": TINY_B64,
            "use_profile_photo": True,
            "profile_id": "self",
            "angles": ["front"],
        }
        r = requests.post(f"{API}/tryon/garment", json=body, headers=seller_headers, timeout=30)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        assert "buyer" in r.text.lower()


# ---------------------------------------------------------------------------
# Address CRUD
# ---------------------------------------------------------------------------
class TestAddressCRUD:
    @pytest.fixture(autouse=True)
    def _setup(self, buyer_headers):
        _cleanup_addresses(buyer_headers)
        yield
        _cleanup_addresses(buyer_headers)

    def test_create_first_address_is_default(self, buyer_headers):
        body = {
            "label": "home",
            "recipient_name": "Avery Lin",
            "phone": "+254712345678",
            "building_estate": "Sunshine Court",
            "house_number": "A-12",
            "city": "Nairobi",
            "country": "Kenya",
        }
        r = requests.post(f"{API}/addresses", json=body, headers=buyer_headers, timeout=20)
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["id"]
        assert a["is_default"] is True
        assert a["label"] == "home"
        assert a["recipient_name"] == "Avery Lin"

    def test_second_address_not_default_and_list_sorted(self, buyer_headers):
        # 1st = home (default)
        h = requests.post(f"{API}/addresses", json={
            "label": "home", "recipient_name": "Avery Lin", "phone": "+254712345678",
            "city": "Nairobi", "country": "Kenya",
        }, headers=buyer_headers).json()
        # 2nd = office
        o = requests.post(f"{API}/addresses", json={
            "label": "office", "recipient_name": "Avery Lin", "phone": "+254700000000",
            "building_estate": "WeWork", "city": "Nairobi", "country": "Kenya",
        }, headers=buyer_headers).json()
        assert o["is_default"] is False

        r = requests.get(f"{API}/addresses", headers=buyer_headers, timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 2
        assert items[0]["is_default"] is True  # default first
        assert items[0]["id"] == h["id"]

    def test_patch_address_updates_fields(self, buyer_headers):
        a = requests.post(f"{API}/addresses", json={
            "label": "office", "recipient_name": "Avery Lin", "phone": "+254700000000",
            "city": "Nairobi", "country": "Kenya",
        }, headers=buyer_headers).json()
        r = requests.patch(
            f"{API}/addresses/{a['id']}",
            json={"recipient_name": "Avery W", "delivery_notes": "Reception desk"},
            headers=buyer_headers, timeout=20,
        )
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["recipient_name"] == "Avery W"
        assert updated["delivery_notes"] == "Reception desk"

    def test_set_default_moves_default_flag(self, buyer_headers):
        h = requests.post(f"{API}/addresses", json={
            "label": "home", "recipient_name": "Avery", "phone": "+254712345678",
            "city": "Nairobi", "country": "Kenya",
        }, headers=buyer_headers).json()
        o = requests.post(f"{API}/addresses", json={
            "label": "office", "recipient_name": "Avery", "phone": "+254700000000",
            "city": "Nairobi", "country": "Kenya",
        }, headers=buyer_headers).json()
        r = requests.post(f"{API}/addresses/{o['id']}/default", headers=buyer_headers, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["is_default"] is True

        # Verify with GET that home is no longer default
        lst = requests.get(f"{API}/addresses", headers=buyer_headers).json()
        by_id = {x["id"]: x for x in lst}
        assert by_id[o["id"]]["is_default"] is True
        assert by_id[h["id"]]["is_default"] is False

    def test_delete_default_promotes_remaining(self, buyer_headers):
        h = requests.post(f"{API}/addresses", json={
            "label": "home", "recipient_name": "Avery", "phone": "+254712345678",
            "city": "Nairobi", "country": "Kenya",
        }, headers=buyer_headers).json()
        o = requests.post(f"{API}/addresses", json={
            "label": "office", "recipient_name": "Avery", "phone": "+254700000000",
            "city": "Nairobi", "country": "Kenya",
        }, headers=buyer_headers).json()
        # Make office default, then delete it — home should become default
        requests.post(f"{API}/addresses/{o['id']}/default", headers=buyer_headers)
        d = requests.delete(f"{API}/addresses/{o['id']}", headers=buyer_headers, timeout=20)
        assert d.status_code == 200, d.text
        lst = requests.get(f"{API}/addresses", headers=buyer_headers).json()
        assert len(lst) == 1
        assert lst[0]["id"] == h["id"]
        assert lst[0]["is_default"] is True

    def test_seller_forbidden(self, seller_headers):
        body = {
            "label": "home", "recipient_name": "X", "phone": "+254700000000",
            "city": "Nairobi", "country": "Kenya",
        }
        r = requests.post(f"{API}/addresses", json=body, headers=seller_headers, timeout=20)
        assert r.status_code == 403, r.text

    def test_cross_tenant_404(self, buyer_headers):
        # PATCH/DELETE on a fake/different-user address id → 404
        r = requests.patch(f"{API}/addresses/nope-not-mine", json={"city": "X"}, headers=buyer_headers)
        assert r.status_code == 404
        r = requests.delete(f"{API}/addresses/nope-not-mine", headers=buyer_headers)
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Checkout requires address + snapshots shipping address
# ---------------------------------------------------------------------------
class TestCheckoutAddress:
    @pytest.fixture(autouse=True)
    def _setup(self, buyer_headers):
        _cleanup_addresses(buyer_headers)
        yield
        _cleanup_addresses(buyer_headers)

    def _any_item_id(self):
        r = requests.get(f"{API}/items", timeout=20)
        assert r.status_code == 200, r.text
        items = r.json()
        assert items, "no seeded items"
        return items[0]

    def test_checkout_missing_address_400(self, buyer_headers):
        item = self._any_item_id()
        body = {
            "item_id": item["id"],
            "size": item["sizes"][0]["label"],
            "color": (item.get("colors") or [{"name": ""}])[0].get("name", ""),
            "origin_url": "https://example.test",
        }
        r = requests.post(f"{API}/payments/checkout", json=body, headers=buyer_headers, timeout=30)
        assert r.status_code == 400, r.text
        assert "address" in r.text.lower()

    def test_checkout_with_other_user_address_404(self, buyer_headers):
        item = self._any_item_id()
        body = {
            "item_id": item["id"],
            "size": item["sizes"][0]["label"],
            "origin_url": "https://example.test",
            "address_id": "definitely-not-mine-uuid",
        }
        r = requests.post(f"{API}/payments/checkout", json=body, headers=buyer_headers, timeout=30)
        assert r.status_code == 404, r.text
        assert "address" in r.text.lower()

    def test_checkout_with_address_creates_order_with_shipping_snapshot(self, buyer_headers):
        # Create address
        addr = requests.post(f"{API}/addresses", json={
            "label": "home", "recipient_name": "Avery Lin", "phone": "+254712345678",
            "building_estate": "Sunshine Court", "house_number": "A-12",
            "city": "Nairobi", "country": "Kenya",
            "delivery_notes": "Call guard at gate.",
        }, headers=buyer_headers).json()
        item = self._any_item_id()
        body = {
            "item_id": item["id"],
            "size": item["sizes"][0]["label"],
            "origin_url": "https://example.test",
            "address_id": addr["id"],
        }
        r = requests.post(f"{API}/payments/checkout", json=body, headers=buyer_headers, timeout=60)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["session_id"]
        assert out["url"].startswith("http")

        # Find the just-created order and verify shipping_address snapshot
        orders = requests.get(f"{API}/orders", headers=buyer_headers, timeout=20).json()
        order = next((o for o in orders if o["session_id"] == out["session_id"]), None)
        assert order is not None, "order not found after checkout"
        detail = requests.get(f"{API}/orders/{order['id']}", headers=buyer_headers, timeout=20)
        assert detail.status_code == 200
        d = detail.json()
        assert d.get("shipping_address") is not None
        ship = d["shipping_address"]
        assert ship["city"] == "Nairobi"
        assert ship["country"] == "Kenya"
        assert ship["building_estate"] == "Sunshine Court"
        assert ship["recipient_name"] == "Avery Lin"

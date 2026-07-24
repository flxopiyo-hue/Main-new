"""Iteration 26 backend tests.

Coverage:
- Categories: listing, search (q), audience filter, POST auth-gate + canonicalisation/near-dup merge.
- Items: category canonicalisation on POST + PATCH, explicit variant id assignment/preservation, sizes roll-up.
- Items: buyer discovery by community-slug filter.
- Quick regression: buyer/seller auth, /auth/me, paystack checkout URL, seller analytics platform_fee_bps.
"""
from __future__ import annotations

import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get(
    "BACKEND_URL",
    "https://fit-finder-app-5.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

SELLER_EMAIL = "atelier@aurafit.com"
SELLER_PASSWORD = "demo-seller-2026"
BUYER_EMAIL = "buyer@aurafit.com"
BUYER_PASSWORD = "demo-buyer-2026"


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(api, email, password):
    r = api.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def seller_token(api):
    return _login(api, SELLER_EMAIL, SELLER_PASSWORD)


@pytest.fixture(scope="module")
def buyer_token(api):
    return _login(api, BUYER_EMAIL, BUYER_PASSWORD)


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --------------------------------------------------------------------------
# Categories
# --------------------------------------------------------------------------
class TestCategories:
    def test_list_categories_has_seeds(self, api):
        r = api.get(f"{API}/categories")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        slugs = {c["slug"] for c in data}
        # 6 system seed slugs must all be present
        for expected in ["shirts", "dresses", "pants", "outerwear", "shoes", "accessories"]:
            assert expected in slugs, f"missing seed slug {expected}"

    def test_list_categories_search_swim(self, api):
        # Only meaningful if swimwear community category exists (main agent seeded it).
        r = api.get(f"{API}/categories", params={"q": "swim"})
        assert r.status_code == 200
        data = r.json()
        slugs = [c["slug"] for c in data]
        assert any("swim" in s for s in slugs), f"expected swim* match, got {slugs}"

    def test_list_categories_audience_men(self, api):
        r = api.get(f"{API}/categories", params={"audience": "men"})
        assert r.status_code == 200
        for c in r.json():
            assert "men" in c["audiences"], f"{c['slug']} leaked into audience=men"

    def test_post_category_requires_auth(self, api):
        r = api.post(f"{API}/categories", json={"label": "Foo", "audiences": ["unisex"]})
        assert r.status_code in (401, 403), r.status_code

    def test_post_category_buyer_forbidden(self, api, buyer_token):
        r = requests.post(
            f"{API}/categories",
            json={"label": "BuyerAttempt", "audiences": ["unisex"]},
            headers=_h(buyer_token),
        )
        assert r.status_code in (401, 403), r.text

    def test_post_category_seller_canonicalises_near_dup(self, api, seller_token):
        # Use a unique base label per test run.
        base = f"TESTKikoy{uuid.uuid4().hex[:6]}Wrap"
        r1 = requests.post(
            f"{API}/categories",
            json={"label": base, "audiences": ["women"]},
            headers=_h(seller_token),
        )
        assert r1.status_code == 200, r1.text
        first = r1.json()
        assert first["slug"] == base.lower(), first
        assert "women" in first["audiences"]

        # Add plural — should return the SAME row and merge audience.
        r2 = requests.post(
            f"{API}/categories",
            json={"label": base + "s", "audiences": ["men"]},
            headers=_h(seller_token),
        )
        assert r2.status_code == 200, r2.text
        second = r2.json()
        assert second["slug"] == first["slug"], (first, second)
        assert set(second["audiences"]) >= {"women", "men"}

        # Add spaced+lowercased — same canonical slug (spaces collapsed).
        spaced = base.replace("Wrap", " Wrap").lower()
        r3 = requests.post(
            f"{API}/categories",
            json={"label": spaced, "audiences": ["unisex"]},
            headers=_h(seller_token),
        )
        assert r3.status_code == 200, r3.text
        third = r3.json()
        assert third["slug"] == first["slug"], (first, third)


# --------------------------------------------------------------------------
# Items — category canonicalisation + variants
# --------------------------------------------------------------------------
def _tiny_png_b64():
    # 1x1 transparent PNG
    return (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mMAAQAABQAB"
        "DQottAAAAABJRU5ErkJggg=="
    )


class TestItemsVariants:
    created_ids: list[str] = []

    def test_create_item_freetext_category_and_variants(self, api, seller_token):
        payload = {
            "name": f"TEST Swim Item {uuid.uuid4().hex[:6]}",
            "description": "Test swim item",
            "category": "Swim Wear",  # free-text; canonicalises to 'swimwear'
            "price_cents": 250000,
            "currency": "KES",
            "image_b64": _tiny_png_b64(),
            "audience": "women",
            "sizes": [
                {"label": "M", "available_qty": 4},
                {"label": "L", "available_qty": 6},
            ],
            "colors": [
                {"name": "Coral", "hex": "#FF7F50"},
                {"name": "Navy", "hex": "#001F3F"},
            ],
            "variants": [
                {"id": "", "size_label": "M", "color_name": "Coral", "color_hex": "#FF7F50",
                 "quantity": 3, "price_cents_override": 275000, "disabled": False},
                {"id": "", "size_label": "M", "color_name": "Navy", "color_hex": "#001F3F",
                 "quantity": 1, "disabled": False},
                {"id": "", "size_label": "L", "color_name": "Coral", "color_hex": "#FF7F50",
                 "quantity": 2, "disabled": True},
                {"id": "", "size_label": "L", "color_name": "Navy", "color_hex": "#001F3F",
                 "quantity": 4, "disabled": False},
            ],
        }
        r = requests.post(f"{API}/items", json=payload, headers=_h(seller_token))
        assert r.status_code == 200, r.text
        item = r.json()
        TestItemsVariants.created_ids.append(item["id"])

        # canonical slug
        assert item["category"] == "swimwear", item["category"]
        # variants got UUIDs
        assert item.get("variants") and len(item["variants"]) == 4
        ids = [v["id"] for v in item["variants"]]
        assert all(ids), "empty variant id detected"
        assert len(set(ids)) == 4, "duplicate variant ids"
        # price override persisted
        m_coral = next(v for v in item["variants"] if v["size_label"] == "M" and v["color_name"] == "Coral")
        assert m_coral.get("price_cents_override") == 275000
        # sizes roll-up = sum of non-disabled variants
        sizes_map = {s["label"]: s["available_qty"] for s in item["sizes"]}
        assert sizes_map["M"] == 4, f"M rollup wrong: {sizes_map}"
        # L variants: Coral disabled(2 excluded) + Navy 4 = 4
        assert sizes_map["L"] == 4, f"L rollup wrong (disabled combo must be excluded): {sizes_map}"

    def test_patch_item_category_and_variant_id_preservation(self, api, seller_token):
        assert TestItemsVariants.created_ids, "prior create test must run first"
        item_id = TestItemsVariants.created_ids[-1]
        # Fetch current variants to capture ids
        r_get = requests.get(f"{API}/items/{item_id}", headers=_h(seller_token))
        assert r_get.status_code == 200
        prior = r_get.json()
        prior_ids = {
            (v["size_label"], (v.get("color_name") or "").lower()): v["id"]
            for v in prior["variants"]
        }
        # PATCH with category='swimwears' (plural — should stay 'swimwear')
        # Send variants without ids for existing (size,color) combos
        patch_variants = [
            {"id": "", "size_label": "M", "color_name": "Coral", "color_hex": "#FF7F50",
             "quantity": 5, "price_cents_override": 280000, "disabled": False},
            {"id": "", "size_label": "M", "color_name": "Navy", "color_hex": "#001F3F",
             "quantity": 2, "disabled": False},
            {"id": "", "size_label": "L", "color_name": "Coral", "color_hex": "#FF7F50",
             "quantity": 2, "disabled": True},
            {"id": "", "size_label": "L", "color_name": "Navy", "color_hex": "#001F3F",
             "quantity": 3, "disabled": False},
        ]
        r = requests.patch(
            f"{API}/items/{item_id}",
            json={"category": "swimwears", "variants": patch_variants},
            headers=_h(seller_token),
        )
        assert r.status_code == 200, r.text
        patched = r.json()
        assert patched["category"] == "swimwear", patched["category"]
        # ids preserved by (size,color)
        for v in patched["variants"]:
            key = (v["size_label"], (v.get("color_name") or "").lower())
            assert v["id"] == prior_ids[key], f"id churned for {key}: {v['id']} != {prior_ids[key]}"
        # roll-up recomputed w/o disabled combo
        sizes_map = {s["label"]: s["available_qty"] for s in patched["sizes"]}
        assert sizes_map["M"] == 7
        assert sizes_map["L"] == 3  # L Coral disabled excluded

    def test_get_items_by_community_slug(self, api, buyer_token):
        r = requests.get(
            f"{API}/items",
            params={"category": "swimwear"},
            headers=_h(buyer_token),
        )
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        # At least our just-created one should be listed.
        our_ids = set(TestItemsVariants.created_ids)
        assert any(it["id"] in our_ids for it in items), \
            f"none of created ids {our_ids} appear in category=swimwear listing"

    def test_cleanup_delete_created_items(self, api, seller_token):
        for iid in TestItemsVariants.created_ids:
            r = requests.delete(f"{API}/items/{iid}", headers=_h(seller_token))
            assert r.status_code in (200, 404), r.text


# --------------------------------------------------------------------------
# Regression — auth, /me, paystack checkout, analytics
# --------------------------------------------------------------------------
class TestRegression:
    def test_buyer_register_and_login(self, api):
        email = f"TESTbuyer_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(
            f"{API}/auth/register",
            json={
                "email": email,
                "password": "TestPass123!",
                "full_name": "Test Buyer",
                "role": "buyer",
                "gender": "female",
                "age": 28,
            },
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data
        assert data["user"]["role"] == "buyer"

        r2 = requests.post(
            f"{API}/auth/login",
            json={"email": email, "password": "TestPass123!"},
        )
        assert r2.status_code == 200
        assert r2.json()["user"]["role"] == "buyer"

    def test_seller_register_with_company_and_location(self, api):
        email = f"TESTseller_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(
            f"{API}/auth/register",
            json={
                "email": email,
                "password": "TestPass123!",
                "full_name": "Test Seller",
                "role": "seller",
                "company_name": "TEST Brand Co",
                "location": {"city": "Nairobi", "country": "Kenya"},
            },
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["role"] == "seller"
        assert data["user"].get("company_name") == "TEST Brand Co"

    def test_auth_me(self, api, buyer_token):
        r = requests.get(f"{API}/auth/me", headers=_h(buyer_token))
        assert r.status_code == 200, r.text
        me = r.json()
        assert me.get("email") == BUYER_EMAIL
        assert me.get("role") == "buyer"

    def test_seller_analytics_platform_fee(self, api, seller_token):
        r = requests.get(f"{API}/seller/analytics", headers=_h(seller_token))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("platform_fee_bps") == 1500, data

    def test_payments_checkout_returns_paystack_url(self, api, buyer_token, seller_token):
        # Need an item to checkout against. Find one from seller inventory.
        r = requests.get(f"{API}/items/mine", headers=_h(seller_token))
        assert r.status_code == 200
        items = r.json()
        assert items, "seller has no items to purchase against"
        # pick first non-paused item with a size
        item = next(
            (
                it
                for it in items
                if not it.get("is_paused") and it.get("sizes")
            ),
            None,
        )
        if not item:
            pytest.skip("no purchasable item available")
        size_label = item["sizes"][0]["label"]

        # Buyer needs a saved address for checkout — fetch or create one.
        addr_r = requests.get(f"{API}/addresses", headers=_h(buyer_token))
        address_id = None
        if addr_r.status_code == 200 and addr_r.json():
            address_id = addr_r.json()[0].get("id")
        if not address_id:
            new_addr = requests.post(
                f"{API}/addresses",
                json={
                    "recipient_name": "Test Buyer",
                    "phone": "+254700000000",
                    "line1": "1 Test Rd",
                    "city": "Nairobi",
                    "country": "Kenya",
                    "postal_code": "00100",
                    "is_default": True,
                },
                headers=_h(buyer_token),
            )
            if new_addr.status_code in (200, 201):
                address_id = new_addr.json().get("id")

        payload = {
            "item_id": item["id"],
            "size": size_label,
            "origin_url": BASE_URL,
        }
        if address_id:
            payload["address_id"] = address_id
        r = requests.post(
            f"{API}/payments/checkout",
            json=payload,
            headers=_h(buyer_token),
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Paystack authorization URL
        url = data.get("authorization_url") or data.get("url") or data.get("checkout_url")
        assert url and "paystack" in url.lower(), f"no paystack url in {data}"

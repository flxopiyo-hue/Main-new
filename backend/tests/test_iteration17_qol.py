"""Iteration 17 — pre-Phase-E QoL backend tests.

Covers:
  - PATCH /api/items/{id} — partial update as owner (200) / non-owner (403)
  - POST /api/items/{id}/duplicate — clones with (Copy) suffix, is_paused=true (200) / non-owner (403)
  - GET /api/items?brand= — case-insensitive substring on brand_name
  - GET /api/items — excludes paused items by default
  - Startup migration price_cents normalization: seeded item price_cents >= 1_000_000 (KES) with cents_normalized flag
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fit-finder-app-5.preview.emergentagent.com").rstrip("/")

SELLER = {"email": "atelier@aurafit.demo", "password": "demo-seller-2026"}
BUYER = {"email": "buyer@aurafit.demo", "password": "demo-buyer-2026"}


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(api, creds):
    r = api.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def seller_token(api):
    return _login(api, SELLER)


@pytest.fixture(scope="module")
def buyer_token(api):
    # Buyer needs to be a seller to attempt cross-owner PATCH — register a second seller instead.
    # We'll register a fresh seller here for non-owner tests.
    email = f"TEST_seller_{int(time.time())}@aurafit.demo"
    payload = {
        "email": email,
        "password": "TestPass123!",
        "full_name": "TEST Other Seller",
        "role": "seller",
        "company_name": "Other Atelier",
        "location": {"city": "Nairobi", "country": "Kenya"},
    }
    r = api.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# Migration — price_cents normalization
# ---------------------------------------------------------------------------
class TestPriceCentsMigration:
    def test_seeded_items_are_normalized(self, api):
        r = api.get(f"{BASE_URL}/api/items", timeout=30)
        assert r.status_code == 200
        items = r.json()
        assert len(items) > 0, "no items returned by GET /api/items"
        kes_items = [i for i in items if i.get("currency") == "KES"]
        assert len(kes_items) > 0, "no KES items seeded"
        for it in kes_items:
            # Seed defines prices in the 12900..34900 major-KSh range; normalized => *100 => >= 1_000_000
            assert it["price_cents"] >= 1_000_000, (
                f"item {it['name']} has price_cents={it['price_cents']} — expected >=1_000_000 (normalized)"
            )


# ---------------------------------------------------------------------------
# Brand filter
# ---------------------------------------------------------------------------
class TestBrandFilter:
    def test_brand_case_insensitive_substring(self, api, seller_token):
        # First, seed a listing with a known brand via PATCH on an existing item.
        # We'll create a small test item so we can guarantee a brand_name.
        r = api.get(f"{BASE_URL}/api/items/mine", headers=_auth(seller_token), timeout=30)
        assert r.status_code == 200
        mine = r.json()
        assert len(mine) > 0
        target = mine[0]
        # Ensure brand_name is set to "Maison Lumière" (a known-ish label)
        r2 = api.patch(
            f"{BASE_URL}/api/items/{target['id']}",
            headers=_auth(seller_token),
            json={"brand_name": "Maison Lumière"},
            timeout=30,
        )
        assert r2.status_code == 200
        assert r2.json()["brand_name"] == "Maison Lumière"

        # Case-insensitive substring "maison"
        r3 = api.get(f"{BASE_URL}/api/items", params={"brand": "maison"}, timeout=30)
        assert r3.status_code == 200
        results = r3.json()
        assert any(i["id"] == target["id"] for i in results), (
            "brand=maison substring did not match Maison Lumière"
        )
        # Upper-case check
        r4 = api.get(f"{BASE_URL}/api/items", params={"brand": "MAISON"}, timeout=30)
        assert r4.status_code == 200
        assert any(i["id"] == target["id"] for i in r4.json())


# ---------------------------------------------------------------------------
# PATCH ownership
# ---------------------------------------------------------------------------
class TestPatchItem:
    def test_owner_patch_partial(self, api, seller_token):
        r = api.get(f"{BASE_URL}/api/items/mine", headers=_auth(seller_token), timeout=30)
        assert r.status_code == 200
        target = r.json()[0]
        orig_name = target["name"]

        # Patch just the price
        r2 = api.patch(
            f"{BASE_URL}/api/items/{target['id']}",
            headers=_auth(seller_token),
            json={"price_cents": 999999},
            timeout=30,
        )
        assert r2.status_code == 200
        body = r2.json()
        assert body["price_cents"] == 999999
        assert body["name"] == orig_name, "other fields must be preserved on partial patch"

        # GET verify persistence
        r3 = api.get(f"{BASE_URL}/api/items/{target['id']}", timeout=30)
        assert r3.status_code == 200
        assert r3.json()["price_cents"] == 999999

        # Restore
        api.patch(
            f"{BASE_URL}/api/items/{target['id']}",
            headers=_auth(seller_token),
            json={"price_cents": target["price_cents"]},
            timeout=30,
        )

    def test_non_owner_patch_forbidden(self, api, seller_token, buyer_token):
        r = api.get(f"{BASE_URL}/api/items/mine", headers=_auth(seller_token), timeout=30)
        target = r.json()[0]
        r2 = api.patch(
            f"{BASE_URL}/api/items/{target['id']}",
            headers=_auth(buyer_token),
            json={"price_cents": 111},
            timeout=30,
        )
        assert r2.status_code == 403, f"expected 403 for non-owner PATCH, got {r2.status_code}"

    def test_patch_is_paused_hides_from_discover(self, api, seller_token):
        # Create a fresh throwaway item to pause without affecting other tests.
        create_payload = {
            "name": "TEST Pause Item",
            "description": "test",
            "category": "shirts",
            "price_cents": 100000,
            "currency": "KES",
            "image_b64": "aGVsbG8=",
            "sizes": [{"label": "M", "available_qty": 1}],
            "colors": [],
            "audience": "unisex",
        }
        r = api.post(f"{BASE_URL}/api/items", headers=_auth(seller_token), json=create_payload, timeout=30)
        assert r.status_code == 200
        item_id = r.json()["id"]
        try:
            # Pause
            rp = api.patch(
                f"{BASE_URL}/api/items/{item_id}",
                headers=_auth(seller_token),
                json={"is_paused": True},
                timeout=30,
            )
            assert rp.status_code == 200
            assert rp.json()["is_paused"] is True

            # GET /api/items should exclude paused
            rl = api.get(f"{BASE_URL}/api/items", timeout=30)
            assert rl.status_code == 200
            ids = [i["id"] for i in rl.json()]
            assert item_id not in ids, "paused item still visible in GET /api/items"
        finally:
            api.delete(f"{BASE_URL}/api/items/{item_id}", headers=_auth(seller_token), timeout=30)


# ---------------------------------------------------------------------------
# Duplicate
# ---------------------------------------------------------------------------
class TestDuplicateItem:
    def test_owner_duplicate_creates_paused_copy(self, api, seller_token):
        r = api.get(f"{BASE_URL}/api/items/mine", headers=_auth(seller_token), timeout=30)
        target = r.json()[0]

        rd = api.post(
            f"{BASE_URL}/api/items/{target['id']}/duplicate",
            headers=_auth(seller_token),
            timeout=30,
        )
        assert rd.status_code == 200, f"duplicate failed: {rd.status_code} {rd.text}"
        clone = rd.json()
        try:
            assert clone["id"] != target["id"]
            assert clone["name"].endswith("(Copy)"), f"expected (Copy) suffix, got {clone['name']}"
            assert clone["is_paused"] is True
            assert clone["seller_id"] == target["seller_id"]
            assert clone["price_cents"] == target["price_cents"]
            # GET verify
            g = api.get(f"{BASE_URL}/api/items/{clone['id']}", timeout=30)
            assert g.status_code == 200
            assert g.json()["is_paused"] is True
        finally:
            api.delete(f"{BASE_URL}/api/items/{clone['id']}", headers=_auth(seller_token), timeout=30)

    def test_non_owner_duplicate_forbidden(self, api, seller_token, buyer_token):
        r = api.get(f"{BASE_URL}/api/items/mine", headers=_auth(seller_token), timeout=30)
        target = r.json()[0]
        rd = api.post(
            f"{BASE_URL}/api/items/{target['id']}/duplicate",
            headers=_auth(buyer_token),
            timeout=30,
        )
        assert rd.status_code == 403, f"expected 403 non-owner duplicate, got {rd.status_code}"

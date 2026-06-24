"""Iteration 14: multi-photo gallery + brand_name persistence on Items."""
import os
import base64
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://fit-finder-app-5.preview.emergentagent.com"
).rstrip("/")
SELLER = {"email": "atelier@aurafit.demo", "password": "demo-seller-2026"}

# Tiny 1x1 PNGs (different colors so we can verify ordering)
def _b64(color: bytes) -> str:
    # Minimal solid PNG via a pre-built 1x1 PNG header is overkill — just
    # use unique base64 strings since backend stores blobs as-is.
    return base64.b64encode(b"IMG-" + color).decode()

P0 = _b64(b"PRIMARY")
E1 = _b64(b"EXTRA1")
E2 = _b64(b"EXTRA2")
E3 = _b64(b"EXTRA3")
E4 = _b64(b"EXTRA4")
E5 = _b64(b"EXTRA5")


@pytest.fixture(scope="module")
def seller_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={**SELLER, "as_role": "seller"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(seller_token):
    return {"Authorization": f"Bearer {seller_token}", "Content-Type": "application/json"}


def _base_payload(**overrides):
    p = {
        "name": "TEST_Multiphoto Item",
        "description": "TEST description",
        "category": "shirts",
        "price_cents": 9900,
        "currency": "USD",
        "image_b64": P0,
        "extra_images": [],
        "sizes": [{"label": "M", "chest_cm": 100, "shoulder_cm": 45, "sleeve_cm": 60, "length_cm": 70, "available_qty": 3}],
        "colors": [],
        "audience": "unisex",
    }
    p.update(overrides)
    return p


class TestMultiPhotoBrand:
    created_ids = []

    def test_create_with_brand_and_3_extras(self, headers):
        payload = _base_payload(
            name="TEST_Brand 4 Images",
            brand_name="TEST_BrandX",
            extra_images=[E1, E2, E3],
        )
        r = requests.post(f"{BASE_URL}/api/items", json=payload, headers=headers)
        assert r.status_code == 200, r.text
        d = r.json()
        TestMultiPhotoBrand.created_ids.append(d["id"])

        # brand echoed
        assert d.get("brand_name") == "TEST_BrandX"
        # images array length = 4
        assert isinstance(d.get("images"), list)
        assert len(d["images"]) == 4, f"expected 4 images got {len(d['images'])}"
        # primary echoes images[0]
        assert d["image_b64"] == d["images"][0]
        assert d["images"][0] == P0
        # order preserved
        assert d["images"][1] == E1
        assert d["images"][2] == E2
        assert d["images"][3] == E3

    def test_cap_at_5(self, headers):
        payload = _base_payload(
            name="TEST_Cap5",
            brand_name="TEST_CapBrand",
            extra_images=[E1, E2, E3, E4, E5],  # 5 extras → 6 total but pydantic max_length=4
        )
        r = requests.post(f"{BASE_URL}/api/items", json=payload, headers=headers)
        # Pydantic model enforces max 4 extras → 422; server caps via slice anyway.
        # Accept either: validation rejection OR a successful 5-image cap.
        if r.status_code == 422:
            # Now try 4 extras explicitly — server slicing caps to 5 total.
            payload["extra_images"] = [E1, E2, E3, E4]
            r = requests.post(f"{BASE_URL}/api/items", json=payload, headers=headers)
            assert r.status_code == 200, r.text
            d = r.json()
            TestMultiPhotoBrand.created_ids.append(d["id"])
            assert len(d["images"]) == 5
        else:
            assert r.status_code == 200, r.text
            d = r.json()
            TestMultiPhotoBrand.created_ids.append(d["id"])
            assert len(d["images"]) == 5, f"server should cap to 5, got {len(d['images'])}"

    def test_list_items_carries_brand_and_images(self, headers):
        r = requests.get(f"{BASE_URL}/api/items?seller_id=&audience=all", headers=headers)
        # Audience=all is allowed by router; otherwise omit filter.
        if r.status_code != 200:
            r = requests.get(f"{BASE_URL}/api/items", headers=headers)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        # Find one of the TEST items we created
        found = next((x for x in items if x["id"] in TestMultiPhotoBrand.created_ids), None)
        assert found is not None, "Newly created TEST item not present in /api/items"
        assert "brand_name" in found
        assert "images" in found and isinstance(found["images"], list)
        assert len(found["images"]) >= 1
        assert found["images"][0] == found["image_b64"]

    def test_get_item_back_compat(self, headers):
        # GET a single item we just created to verify gallery is full.
        if not TestMultiPhotoBrand.created_ids:
            pytest.skip("No created items")
        iid = TestMultiPhotoBrand.created_ids[0]
        r = requests.get(f"{BASE_URL}/api/items/{iid}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["brand_name"] == "TEST_BrandX"
        assert len(d["images"]) == 4
        assert d["images"][0] == d["image_b64"]

    @classmethod
    def teardown_class(cls):
        # Best-effort cleanup
        try:
            r = requests.post(f"{BASE_URL}/api/auth/login", json={**SELLER, "as_role": "seller"})
            token = r.json().get("token")
            if not token:
                return
            h = {"Authorization": f"Bearer {token}"}
            for iid in cls.created_ids:
                requests.delete(f"{BASE_URL}/api/items/{iid}", headers=h)
        except Exception:
            pass

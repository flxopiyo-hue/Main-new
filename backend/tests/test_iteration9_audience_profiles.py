"""Iteration 9 — Audience Profiles + Single-currency + Bottom-nav fix.

Backend coverage:
  - Loved-ones CRUD
  - Unified profile switcher (/profiles/all, /profiles/active)
  - Items audience + kid_age_group filter
  - Try-on profile_id parameter
"""

from __future__ import annotations

import os
import uuid
from typing import Any, Dict, List, Optional

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or "https://fit-finder-app-5.preview.emergentagent.com"
API = f"{BASE_URL}/api"

BUYER = {"email": "buyer@aurafit.demo", "password": "demo-buyer-2026"}
SELLER = {"email": "atelier@aurafit.demo", "password": "demo-seller-2026"}


def _login(creds: Dict[str, str]) -> str:
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def buyer_token() -> str:
    return _login(BUYER)


@pytest.fixture(scope="module")
def seller_token() -> str:
    return _login(SELLER)


def H(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# Cleanup: wipe loved-ones we created at end of module
# ---------------------------------------------------------------------------
_created_ids: List[str] = []


@pytest.fixture(scope="module", autouse=True)
def cleanup_loved_ones(buyer_token: str):
    yield
    for lid in _created_ids:
        try:
            requests.delete(f"{API}/loved-ones/{lid}", headers=H(buyer_token), timeout=10)
        except Exception:
            pass
    # Reset active to self
    try:
        requests.post(f"{API}/profiles/active", headers=H(buyer_token),
                      json={"profile_id": "self"}, timeout=10)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# 1. GET /api/profiles/all
# ---------------------------------------------------------------------------
class TestProfilesAll:
    def test_buyer_profiles_all_returns_self_first(self, buyer_token):
        r = requests.get(f"{API}/profiles/all", headers=H(buyer_token), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list) and len(data) >= 1
        me = data[0]
        assert me["id"] == "self"
        assert me["is_self"] is True
        assert me["name"] == "Me"
        assert me["audience"] == "adult"
        # buyer seed user has front + side photos
        assert "has_front_photo" in me and "has_side_photo" in me

    def test_seller_profiles_all_does_not_500(self, seller_token):
        r = requests.get(f"{API}/profiles/all", headers=H(seller_token), timeout=15)
        assert r.status_code in (200, 403), f"Unexpected {r.status_code}: {r.text}"
        if r.status_code == 200:
            data = r.json()
            assert isinstance(data, list) and len(data) >= 1
            assert data[0]["id"] == "self"


# ---------------------------------------------------------------------------
# 2. POST/PATCH/DELETE /api/loved-ones
# ---------------------------------------------------------------------------
class TestLovedOnesCRUD:
    def test_create_kid_loved_one(self, buyer_token):
        payload = {
            "name": "Mateo",
            "audience": "kid",
            "gender": "male",
            "age": 8,
            "relation": "son",
            "measurements": {"height_cm": 130},
        }
        r = requests.post(f"{API}/loved-ones", headers=H(buyer_token), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == "Mateo"
        assert d["audience"] == "kid"
        assert d["gender"] == "male"
        assert d["age"] == 8
        assert d["relation"] == "son"
        assert d["measurements"]["height_cm"] == 130
        assert d["has_front_photo"] is False
        _created_ids.append(d["id"])
        pytest.mateo_id = d["id"]  # type: ignore

    def test_create_kid_without_age_400(self, buyer_token):
        payload = {"name": "BadKid", "audience": "kid", "gender": "male"}
        r = requests.post(f"{API}/loved-ones", headers=H(buyer_token), json=payload, timeout=15)
        assert r.status_code == 400, r.text
        assert "Age is required" in r.json().get("detail", "")

    def test_seller_cannot_create_loved_one(self, seller_token):
        payload = {"name": "X", "audience": "adult", "gender": "female"}
        r = requests.post(f"{API}/loved-ones", headers=H(seller_token), json=payload, timeout=15)
        assert r.status_code == 403, r.text

    def test_list_loved_ones_contains_mateo(self, buyer_token):
        r = requests.get(f"{API}/loved-ones", headers=H(buyer_token), timeout=15)
        assert r.status_code == 200
        names = [d["name"] for d in r.json()]
        assert "Mateo" in names

    def test_patch_loved_one(self, buyer_token):
        mid = getattr(pytest, "mateo_id", None)
        assert mid, "Mateo must have been created"
        r = requests.patch(f"{API}/loved-ones/{mid}", headers=H(buyer_token),
                           json={"name": "Mateo M.", "age": 9}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == "Mateo M."
        assert d["age"] == 9

    def test_patch_other_users_loved_one_404(self, buyer_token):
        # Create a fake uuid -> should 404 (not 403, per spec)
        fake = str(uuid.uuid4())
        r = requests.patch(f"{API}/loved-ones/{fake}", headers=H(buyer_token),
                           json={"name": "X"}, timeout=15)
        assert r.status_code == 404, r.text

    def test_delete_loved_one(self, buyer_token):
        # Create a fresh one so we don't lose mateo (used in tryon test)
        payload = {"name": "TEST_ToDelete", "audience": "adult", "gender": "female", "age": 30}
        c = requests.post(f"{API}/loved-ones", headers=H(buyer_token), json=payload, timeout=15)
        assert c.status_code == 200
        cid = c.json()["id"]
        r = requests.delete(f"{API}/loved-ones/{cid}", headers=H(buyer_token), timeout=15)
        assert r.status_code == 200
        # Confirm gone
        lst = requests.get(f"{API}/loved-ones", headers=H(buyer_token), timeout=15).json()
        assert cid not in [d["id"] for d in lst]


# ---------------------------------------------------------------------------
# 3. Active profile switcher
# ---------------------------------------------------------------------------
class TestActiveProfile:
    def test_set_active_self(self, buyer_token):
        r = requests.post(f"{API}/profiles/active", headers=H(buyer_token),
                          json={"profile_id": "self"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["profile_id"] == "self"
        assert d["profile"]["is_self"] is True

    def test_set_active_loved_one(self, buyer_token):
        mid = getattr(pytest, "mateo_id", None)
        assert mid
        r = requests.post(f"{API}/profiles/active", headers=H(buyer_token),
                          json={"profile_id": mid}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["profile_id"] == mid
        assert d["profile"]["is_self"] is False
        assert d["profile"]["name"].startswith("Mateo")

    def test_set_active_nonexistent_404(self, buyer_token):
        fake = str(uuid.uuid4())
        r = requests.post(f"{API}/profiles/active", headers=H(buyer_token),
                          json={"profile_id": fake}, timeout=15)
        assert r.status_code == 404

    def test_get_active_persisted(self, buyer_token):
        mid = getattr(pytest, "mateo_id", None)
        # Ensure active is set to mateo
        requests.post(f"{API}/profiles/active", headers=H(buyer_token),
                      json={"profile_id": mid}, timeout=15)
        r = requests.get(f"{API}/profiles/active", headers=H(buyer_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["profile_id"] == mid

    def test_delete_active_falls_back_to_self(self, buyer_token):
        # Create a temp loved-one, set as active, delete, then get-active should be self
        c = requests.post(f"{API}/loved-ones", headers=H(buyer_token),
                          json={"name": "TEMP_ACTIVE", "audience": "adult",
                                "gender": "female", "age": 25}, timeout=15)
        cid = c.json()["id"]
        requests.post(f"{API}/profiles/active", headers=H(buyer_token),
                      json={"profile_id": cid}, timeout=15)
        requests.delete(f"{API}/loved-ones/{cid}", headers=H(buyer_token), timeout=15)
        r = requests.get(f"{API}/profiles/active", headers=H(buyer_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["profile_id"] == "self"


# ---------------------------------------------------------------------------
# 4. Items audience + kid_age_group filtering
# ---------------------------------------------------------------------------
class TestItemsAudienceFilter:
    def test_items_kids(self, buyer_token):
        r = requests.get(f"{API}/items?audience=kids", headers=H(buyer_token), timeout=15)
        assert r.status_code == 200
        for it in r.json():
            assert it["audience"] == "kids"

    def test_items_kids_with_age_group(self, buyer_token):
        r = requests.get(f"{API}/items?audience=kids&kid_age_group=6-9",
                         headers=H(buyer_token), timeout=15)
        assert r.status_code == 200
        # Empty result is OK, but each item's sizes (if any) should include 6/7/8
        for it in r.json():
            labels = [s["label"] for s in it.get("sizes", [])]
            assert any(lbl in ("6", "7", "8") for lbl in labels), labels

    def test_items_no_param_infers_audience(self, buyer_token):
        r = requests.get(f"{API}/items", headers=H(buyer_token), timeout=15)
        assert r.status_code == 200
        # buyer is female → audience filter should be women / unisex
        for it in r.json():
            assert it["audience"] in ("women", "unisex"), it["audience"]


# ---------------------------------------------------------------------------
# 5. Try-on with profile_id
# ---------------------------------------------------------------------------
class TestTryOnProfileId:
    def _pick_item_id(self, buyer_token: str) -> Optional[str]:
        r = requests.get(f"{API}/items", headers=H(buyer_token), timeout=15)
        items = r.json()
        return items[0]["id"] if items else None

    def test_tryon_with_nonexistent_profile_id_404(self, buyer_token):
        iid = self._pick_item_id(buyer_token)
        if not iid:
            pytest.skip("No items to try on")
        fake = str(uuid.uuid4())
        r = requests.post(
            f"{API}/tryon",
            headers=H(buyer_token),
            json={"item_id": iid, "use_profile_photo": True,
                  "profile_id": fake, "angles": ["front"]},
            timeout=30,
        )
        assert r.status_code == 404, r.text
        assert "Profile not found" in r.json().get("detail", "")

    def test_tryon_accepts_profile_id_self(self, buyer_token):
        """Verify the endpoint ACCEPTS the profile_id field with value 'self'.

        We do a quick request and verify it is not rejected for schema reasons
        (i.e. NOT 422). We allow 200/400/502 since Gemini render is heavy.
        """
        iid = self._pick_item_id(buyer_token)
        if not iid:
            pytest.skip("No items to try on")
        r = requests.post(
            f"{API}/tryon",
            headers=H(buyer_token),
            json={"item_id": iid, "use_profile_photo": True,
                  "profile_id": "self", "angles": ["front"]},
            timeout=120,
        )
        # 422 would mean schema rejection of profile_id — that's a bug.
        assert r.status_code != 422, f"profile_id schema rejected: {r.text}"
        # We allow either a real success (200) or an AI/server failure (502),
        # or a 400 missing-photo (shouldn't happen for seed buyer).
        assert r.status_code in (200, 400, 502), f"{r.status_code}: {r.text[:300]}"

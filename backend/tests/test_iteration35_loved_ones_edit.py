"""Iteration 35 — Editable Loved Ones.

Covers:
  * GET /api/loved-ones/{id} returns LovedOneDetail with base64 photo fields
  * 401 without auth, 404 for other user's id, 404 for unknown id
  * Full end-to-end: POST → GET → PATCH (name + one photo + one measurement) → GET → DELETE → GET 404
  * PATCH accepts measurements, photos, preferred_size, preferred_shoe_size
  * List regression — GET /api/loved-ones still returns LovedOneOut (no photo b64)
"""

from __future__ import annotations

import base64
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fit-finder-app-5.preview.emergentagent.com").rstrip("/")

# 1x1 transparent PNG (base64, no data: prefix)
PNG_1X1 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
PNG_1X1_RED = base64.b64encode(bytes.fromhex(
    "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA6300FCCFC0000000030001"
    "5D2BB1AE0000000049454E44AE426082"
)).decode()


def _register_buyer():
    email = f"TEST_lo_edit_{uuid.uuid4().hex[:10]}@example.com"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={
            "email": email,
            "password": "TestPass123!",
            "full_name": "LO Edit Tester",
            "role": "buyer",
            "gender": "female",
            "age": 30,
        },
        timeout=30,
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return data["token"], data["user"]["id"], email


@pytest.fixture(scope="module")
def buyer_a():
    token, uid, email = _register_buyer()
    return {"token": token, "id": uid, "email": email}


@pytest.fixture(scope="module")
def buyer_b():
    token, uid, email = _register_buyer()
    return {"token": token, "id": uid, "email": email}


def _headers(token: str):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# GET /api/loved-ones/{id} — auth + ownership
# ---------------------------------------------------------------------------
class TestGetLovedOneAuth:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/loved-ones/some-id", timeout=15)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"

    def test_unknown_id_returns_404(self, buyer_a):
        r = requests.get(
            f"{BASE_URL}/api/loved-ones/{uuid.uuid4()}",
            headers=_headers(buyer_a["token"]),
            timeout=15,
        )
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# End-to-end CRUD with photos + measurements
# ---------------------------------------------------------------------------
class TestLovedOneFullCycle:
    created_id: str = ""

    def test_1_create_full_loved_one(self, buyer_a):
        payload = {
            "name": "TEST_Avery",
            "audience": "adult",
            "gender": "female",
            "age": 28,
            "relation": "Wife",
            "measurements": {
                "height_cm": 165.0,
                "chest_cm": 92.0,
                "waist_cm": 70.0,
                "hips_cm": 95.0,
                "shoulders_cm": 40.0,
                "inseam_cm": 78.0,
            },
            "preferred_size": "M",
            "preferred_shoe_size": "38",
            "front_photo_b64": PNG_1X1,
            "side_photo_b64": PNG_1X1,
            "three_quarter_photo_b64": PNG_1X1,
        }
        r = requests.post(
            f"{BASE_URL}/api/loved-ones",
            headers=_headers(buyer_a["token"]),
            json=payload,
            timeout=30,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body["name"] == "TEST_Avery"
        assert body["has_front_photo"] is True
        assert body["has_side_photo"] is True
        assert body["has_three_quarter_photo"] is True
        assert body["preferred_size"] == "M"
        assert body["preferred_shoe_size"] == "38"
        assert body["measurements"]["chest_cm"] == 92.0
        TestLovedOneFullCycle.created_id = body["id"]

    def test_2_get_detail_returns_photo_b64(self, buyer_a):
        lo_id = TestLovedOneFullCycle.created_id
        assert lo_id, "create test must have run first"
        r = requests.get(
            f"{BASE_URL}/api/loved-ones/{lo_id}",
            headers=_headers(buyer_a["token"]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # All 3 photos as raw base64 (no data: prefix)
        for k in ("front_photo_b64", "side_photo_b64", "three_quarter_photo_b64"):
            assert body.get(k), f"{k} missing"
            assert not body[k].startswith("data:"), f"{k} should not have data: prefix"
        # Identity + measurements preserved
        assert body["name"] == "TEST_Avery"
        assert body["relation"] == "Wife"
        assert body["age"] == 28
        assert body["gender"] == "female"
        assert body["measurements"]["waist_cm"] == 70.0
        assert body["preferred_size"] == "M"
        assert body["preferred_shoe_size"] == "38"

    def test_3_list_does_not_leak_photo_b64(self, buyer_a):
        r = requests.get(
            f"{BASE_URL}/api/loved-ones",
            headers=_headers(buyer_a["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        arr = r.json()
        assert any(x["id"] == TestLovedOneFullCycle.created_id for x in arr)
        for x in arr:
            assert "front_photo_b64" not in x
            assert "side_photo_b64" not in x
            assert "three_quarter_photo_b64" not in x

    def test_4_other_user_cannot_access(self, buyer_b):
        lo_id = TestLovedOneFullCycle.created_id
        r = requests.get(
            f"{BASE_URL}/api/loved-ones/{lo_id}",
            headers=_headers(buyer_b["token"]),
            timeout=15,
        )
        assert r.status_code == 404, f"expected 404 for cross-tenant, got {r.status_code}"

    def test_5_patch_updates_name_photo_and_measurement(self, buyer_a):
        lo_id = TestLovedOneFullCycle.created_id
        patch_body = {
            "name": "TEST_Avery_Renamed",
            "measurements": {"chest_cm": 95.0},
            "front_photo_b64": PNG_1X1_RED,
        }
        r = requests.patch(
            f"{BASE_URL}/api/loved-ones/{lo_id}",
            headers=_headers(buyer_a["token"]),
            json=patch_body,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "TEST_Avery_Renamed"
        assert body["measurements"]["chest_cm"] == 95.0
        # Other measurements untouched
        assert body["measurements"]["waist_cm"] == 70.0
        assert body["measurements"]["hips_cm"] == 95.0
        # Preferred size still there
        assert body["preferred_size"] == "M"
        assert body["preferred_shoe_size"] == "38"

    def test_6_get_after_patch_reflects_changes(self, buyer_a):
        lo_id = TestLovedOneFullCycle.created_id
        r = requests.get(
            f"{BASE_URL}/api/loved-ones/{lo_id}",
            headers=_headers(buyer_a["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["name"] == "TEST_Avery_Renamed"
        assert body["measurements"]["chest_cm"] == 95.0
        # The front photo should now be the red variant, not the original
        assert body["front_photo_b64"] == PNG_1X1_RED
        # Side + three-quarter unchanged
        assert body["side_photo_b64"] == PNG_1X1
        assert body["three_quarter_photo_b64"] == PNG_1X1

    def test_7_delete_and_verify_404(self, buyer_a):
        lo_id = TestLovedOneFullCycle.created_id
        r = requests.delete(
            f"{BASE_URL}/api/loved-ones/{lo_id}",
            headers=_headers(buyer_a["token"]),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True

        r2 = requests.get(
            f"{BASE_URL}/api/loved-ones/{lo_id}",
            headers=_headers(buyer_a["token"]),
            timeout=15,
        )
        assert r2.status_code == 404


# ---------------------------------------------------------------------------
# PATCH accepts individual fields separately
# ---------------------------------------------------------------------------
class TestLovedOnePatchFields:
    def test_patch_accepts_preferred_sizes(self, buyer_a):
        # Create a minimal loved-one
        create = requests.post(
            f"{BASE_URL}/api/loved-ones",
            headers=_headers(buyer_a["token"]),
            json={"name": "TEST_PatchTarget", "audience": "adult", "gender": "male"},
            timeout=15,
        )
        assert create.status_code == 200
        lo_id = create.json()["id"]

        # PATCH preferred sizes only
        r = requests.patch(
            f"{BASE_URL}/api/loved-ones/{lo_id}",
            headers=_headers(buyer_a["token"]),
            json={"preferred_size": "L", "preferred_shoe_size": "44"},
            timeout=15,
        )
        assert r.status_code == 200
        b = r.json()
        assert b["preferred_size"] == "L"
        assert b["preferred_shoe_size"] == "44"

        # PATCH photo only
        r2 = requests.patch(
            f"{BASE_URL}/api/loved-ones/{lo_id}",
            headers=_headers(buyer_a["token"]),
            json={"side_photo_b64": PNG_1X1},
            timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json()["has_side_photo"] is True

        # Cleanup
        requests.delete(
            f"{BASE_URL}/api/loved-ones/{lo_id}",
            headers=_headers(buyer_a["token"]),
            timeout=15,
        )

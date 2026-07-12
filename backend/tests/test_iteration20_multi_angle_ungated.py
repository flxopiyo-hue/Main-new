"""Iteration 20 — Multi-angle is now UNGATED for Free users.

User clarified: Free tier SHOULD support multi-angle try-ons. The only
Free-tier limits are the 7-per-week try-on cap and the 2-body-profile cap.
Multi-angle is available on every tier.

Rules validated:
  1. Free user + angles=['front','side','back'] on /tryon         → NOT 402 for multi_angle
  2. Free user + angles=['front','side','back'] on /tryon/outfit  → NOT 402 for multi_angle
  3. Free user + angles=['front','side','back'] on /tryon/garment → NOT 402 for multi_angle
  4. GET /subs/me for Free user → gate.multi_angle_allowed == True
  5. Free user with 7 tryons in last 7d → /tryon returns 402 feature='tryon_weekly_limit'
  6. Free user with 2 body_profiles → POST /loved-ones returns 402 feature='profile_limit'
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env", override=False)
load_dotenv("/app/frontend/.env", override=False)

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").strip('"').rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

BUYER_EMAIL = "buyer@aurafit.com"
BUYER_PASSWORD = "demo-buyer-2026"
SELLER_EMAIL = "atelier@aurafit.com"
SELLER_PASSWORD = "demo-seller-2026"

TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAj"
    "CB0C8AAAAASUVORK5CYII="
)


def _login(email: str, password: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=20,
    )
    assert r.status_code == 200, f"login {email} → {r.status_code}: {r.text[:200]}"
    return r.json()["token"]


def _headers(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _mongo():
    mongo_url = (os.environ.get("MONGO_URL") or "").strip('"')
    db_name = (os.environ.get("DB_NAME") or "").strip('"')
    if not mongo_url or not db_name:
        pytest.skip("MONGO_URL/DB_NAME not available")
    client = MongoClient(mongo_url)
    return client[db_name]


@pytest.fixture(scope="module")
def buyer_token() -> str:
    return _login(BUYER_EMAIL, BUYER_PASSWORD)


@pytest.fixture(scope="module")
def seller_token() -> str:
    return _login(SELLER_EMAIL, SELLER_PASSWORD)


@pytest.fixture(scope="module")
def any_item_id(seller_token: str) -> str:
    r = requests.get(f"{BASE_URL}/api/items", timeout=20)
    assert r.status_code == 200, r.text
    items = r.json()
    assert items, "No items in /api/items"
    return items[0]["id"]


@pytest.fixture(scope="module", autouse=True)
def _reset_buyer_free_and_clean():
    """Ensure buyer is Free tier and clear stray TEST_ tryons/profiles."""
    db = _mongo()
    db.users.update_one(
        {"email": BUYER_EMAIL},
        {"$set": {"subscription_tier": "free", "subscription_status": None}},
    )
    buyer = db.users.find_one({"email": BUYER_EMAIL}, {"id": 1, "_id": 0})
    if buyer:
        db.tryons.delete_many({"user_id": buyer["id"], "id": {"$regex": "^TEST_"}})
        db.body_profiles.delete_many({"user_id": buyer["id"], "id": {"$regex": "^TEST_"}})
    yield
    if buyer:
        db.tryons.delete_many({"user_id": buyer["id"], "id": {"$regex": "^TEST_"}})
        db.body_profiles.delete_many({"user_id": buyer["id"], "id": {"$regex": "^TEST_"}})


# ---------------------------------------------------------------------------
# 1. Free user + multi-angle /tryon should NOT be blocked by multi_angle paywall
# ---------------------------------------------------------------------------
def test_free_multi_angle_tryon_not_paywalled(buyer_token, any_item_id):
    r = requests.post(
        f"{BASE_URL}/api/tryon",
        headers=_headers(buyer_token),
        json={
            "item_id": any_item_id,
            "angles": ["front", "side", "back"],
            "body_photo_b64": TINY_PNG_B64,
        },
        timeout=180,
    )
    if r.status_code == 402:
        detail = (r.json().get("detail") or {})
        assert detail.get("feature") != "multi_angle", (
            f"Free user must NOT be paywalled for multi_angle anymore: {detail}"
        )
        # tryon_weekly_limit is the only allowed 402 here
        assert detail.get("feature") == "tryon_weekly_limit", detail
    else:
        # 200 (success with multiple images) or 502 (LLM couldn't render our tiny stub)
        assert r.status_code in {200, 502}, f"unexpected {r.status_code}: {r.text[:300]}"
        if r.status_code == 200:
            body = r.json()
            assert "images" in body and isinstance(body["images"], list)
            # Must have at least the front render — ideally 3.
            assert len(body["images"]) >= 1


# ---------------------------------------------------------------------------
# 2. Free user + multi-angle /tryon/outfit not paywalled
# ---------------------------------------------------------------------------
def test_free_multi_angle_outfit_not_paywalled(buyer_token, any_item_id):
    r = requests.post(
        f"{BASE_URL}/api/tryon/outfit",
        headers=_headers(buyer_token),
        json={
            "item_ids": [any_item_id],
            "angles": ["front", "side", "back"],
            "body_photo_b64": TINY_PNG_B64,
        },
        timeout=180,
    )
    if r.status_code == 402:
        detail = (r.json().get("detail") or {})
        assert detail.get("feature") != "multi_angle", detail
        assert detail.get("feature") == "tryon_weekly_limit", detail
    else:
        assert r.status_code in {200, 502}, f"unexpected {r.status_code}: {r.text[:300]}"


# ---------------------------------------------------------------------------
# 3. Free user + multi-angle /tryon/garment (BYO) not paywalled
# ---------------------------------------------------------------------------
def test_free_multi_angle_byo_not_paywalled(buyer_token):
    r = requests.post(
        f"{BASE_URL}/api/tryon/garment",
        headers=_headers(buyer_token),
        json={
            "garment_b64": TINY_PNG_B64,
            "body_photo_b64": TINY_PNG_B64,
            "angles": ["front", "side", "back"],
            "garment_type": "shirt",
            "label": "TEST_iter20_byo",
        },
        timeout=180,
    )
    if r.status_code == 402:
        detail = (r.json().get("detail") or {})
        assert detail.get("feature") != "multi_angle", detail
        assert detail.get("feature") == "tryon_weekly_limit", detail
    else:
        assert r.status_code in {200, 502}, f"unexpected {r.status_code}: {r.text[:300]}"


# ---------------------------------------------------------------------------
# 4. GET /subs/me — gate.multi_angle_allowed must be True for Free user
# ---------------------------------------------------------------------------
def test_subs_me_multi_angle_allowed_true(buyer_token):
    r = requests.get(f"{BASE_URL}/api/subs/me", headers=_headers(buyer_token), timeout=20)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
    body = r.json()
    gate = body.get("gate") or {}
    assert gate.get("multi_angle_allowed") is True, (
        f"gate.multi_angle_allowed must be True for Free user, got: {gate}"
    )
    # Free-tier sanity check
    assert gate.get("premium") is False, gate
    assert gate.get("tryons_limit") == 7, gate
    assert gate.get("profiles_limit") == 2, gate


# ---------------------------------------------------------------------------
# 5. Weekly try-on cap still enforced (dry-insert 7 tryons directly in DB).
# ---------------------------------------------------------------------------
def test_free_weekly_cap_still_enforced(buyer_token, any_item_id):
    db = _mongo()
    buyer = db.users.find_one({"email": BUYER_EMAIL}, {"id": 1, "_id": 0})
    assert buyer, "buyer must exist"
    now = datetime.now(timezone.utc)
    # Wipe TEST_ tryons and insert 7 fresh rows in the rolling 7-day window.
    db.tryons.delete_many({"user_id": buyer["id"], "id": {"$regex": "^TEST_iter20_cap_"}})
    docs = [
        {
            "id": f"TEST_iter20_cap_{i}_{uuid.uuid4()}",
            "user_id": buyer["id"],
            "item_id": any_item_id,
            "created_at": now - timedelta(hours=i + 1),
            "result_image_b64": "",
            "images": [],
        }
        for i in range(7)
    ]
    db.tryons.insert_many(docs)
    try:
        r = requests.post(
            f"{BASE_URL}/api/tryon",
            headers=_headers(buyer_token),
            json={
                "item_id": any_item_id,
                "angles": ["front"],
                "body_photo_b64": TINY_PNG_B64,
            },
            timeout=30,
        )
        assert r.status_code == 402, f"expected 402 weekly cap, got {r.status_code}: {r.text[:200]}"
        detail = (r.json().get("detail") or {})
        assert detail.get("code") == "paywall", detail
        assert detail.get("feature") == "tryon_weekly_limit", detail
    finally:
        db.tryons.delete_many({"user_id": buyer["id"], "id": {"$regex": "^TEST_iter20_cap_"}})


# ---------------------------------------------------------------------------
# 6. Profile cap still enforced — Free = 2 max.
# ---------------------------------------------------------------------------
def test_free_profile_cap_still_enforced(buyer_token):
    db = _mongo()
    buyer = db.users.find_one({"email": BUYER_EMAIL}, {"id": 1, "_id": 0})
    assert buyer, "buyer must exist"
    # Clean out anything previously created + also existing user profiles → seed exactly 2.
    db.body_profiles.delete_many({"user_id": buyer["id"]})
    now = datetime.now(timezone.utc)
    db.body_profiles.insert_many([
        {
            "id": f"TEST_iter20_prof_{i}",
            "user_id": buyer["id"],
            "name": f"TEST_prof_{i}",
            "gender": "female",
            "age": 30,
            "measurements": {},
            "created_at": now,
        }
        for i in range(2)
    ])
    try:
        r = requests.post(
            f"{BASE_URL}/api/loved-ones",
            headers=_headers(buyer_token),
            json={"name": "TEST_iter20_3rd", "audience": "adult", "gender": "female", "age": 25, "measurements": {}},
            timeout=20,
        )
        assert r.status_code == 402, f"expected 402 profile_limit, got {r.status_code}: {r.text[:200]}"
        detail = (r.json().get("detail") or {})
        assert detail.get("code") == "paywall", detail
        assert detail.get("feature") == "profile_limit", detail
    finally:
        db.body_profiles.delete_many({"user_id": buyer["id"]})

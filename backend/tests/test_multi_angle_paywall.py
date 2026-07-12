"""Iteration 19 — Multi-angle try-on paywall gating.

Bug from iteration 18 user report: Free user tapped multi-angle
try-on but backend silently truncated angles to front and returned
a single front image. Fix: backend now raises 402 paywall(feature=
'multi_angle') when a Free user requests >1 angle from any of the
three try-on endpoints (/tryon, /tryon/outfit, /tryon/byo aka
/tryon/garment).

Rules validated in this file:
  1. Free user + angles=['front','side','back'] on /tryon        → 402 multi_angle
  2. Free user + angles=['front']                on /tryon        → 200 (front img)
  3. Free user + angles=['front','side','back'] on /tryon/outfit → 402 multi_angle
  4. Free user + angles=['front','side','back'] on /tryon/garment→ 402 multi_angle
  5. Premium user + angles=[...multi] on all three endpoints     → 200
"""
from __future__ import annotations

import os
import pytest
import requests
from dotenv import load_dotenv

# Load backend .env for MONGO_URL/DB_NAME (values include quotes literally).
load_dotenv("/app/backend/.env", override=False)
load_dotenv("/app/frontend/.env", override=False)

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").strip('"').rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

BUYER_EMAIL = "buyer@aurafit.com"
BUYER_PASSWORD = "demo-buyer-2026"
SELLER_EMAIL = "atelier@aurafit.com"
SELLER_PASSWORD = "demo-seller-2026"

# Tiny 1x1 PNG for body/garment stubs — big enough that Pydantic accepts,
# small enough not to bloat network. Nano Banana errors before we return
# but only AFTER gating runs, so 402 always fires first for the paywall tests.
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAj"
    "CB0C8AAAAASUVORK5CYII="
)


# ---------------------------------------------------------------------------
# Fixtures — auth tokens, seed an item id.
# ---------------------------------------------------------------------------
def _login(email: str, password: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        timeout=20,
    )
    assert r.status_code == 200, f"login {email} → {r.status_code}: {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def buyer_token() -> str:
    return _login(BUYER_EMAIL, BUYER_PASSWORD)


@pytest.fixture(scope="module")
def seller_token() -> str:
    return _login(SELLER_EMAIL, SELLER_PASSWORD)


@pytest.fixture(scope="module")
def any_item_id(seller_token: str) -> str:
    """Grab any live seller item id to try on."""
    r = requests.get(f"{BASE_URL}/api/items", timeout=20)
    assert r.status_code == 200, r.text
    items = r.json()
    assert items, "No items in /api/items; seed.py must run first"
    return items[0]["id"]


def _headers(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# Ensure buyer is Free (reset just in case a prior test flipped premium).
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module", autouse=True)
def _ensure_buyer_is_free():
    """Direct-mongo poke — if buyer got flipped to premium in a prior
    iteration test we reset before running paywall assertions.
    """
    from pymongo import MongoClient
    mongo_url = (os.environ.get("MONGO_URL") or "").strip('"')
    db_name = (os.environ.get("DB_NAME") or "").strip('"')
    if not mongo_url or not db_name:
        pytest.skip("MONGO_URL/DB_NAME not available for module setup")
    client = MongoClient(mongo_url)
    db = client[db_name]
    db.users.update_one(
        {"email": BUYER_EMAIL},
        {"$set": {"subscription_tier": "free", "subscription_status": None}},
    )
    yield
    # (No teardown — leave as free.)


# ---------------------------------------------------------------------------
# 1. Free user multi-angle /tryon → 402 paywall.multi_angle
# ---------------------------------------------------------------------------
def test_free_user_multi_angle_tryon_returns_402(buyer_token, any_item_id):
    r = requests.post(
        f"{BASE_URL}/api/tryon",
        headers=_headers(buyer_token),
        json={
            "item_id": any_item_id,
            "angles": ["front", "side", "back"],
            "body_photo_b64": TINY_PNG_B64,
        },
        timeout=30,
    )
    assert r.status_code == 402, f"expected 402 paywall, got {r.status_code}: {r.text[:200]}"
    body = r.json()
    detail = body.get("detail") or {}
    assert detail.get("code") == "paywall", f"detail.code should be paywall, got {detail}"
    assert detail.get("feature") == "multi_angle", f"detail.feature should be multi_angle, got {detail}"


# ---------------------------------------------------------------------------
# 2. Free user SINGLE angle /tryon should NOT be blocked by multi_angle.
#    (Might still fail on Nano Banana or 402 tryon_weekly_limit — we only
#    assert we don't get 402 multi_angle.)
# ---------------------------------------------------------------------------
def test_free_user_single_angle_tryon_not_multi_angle_blocked(buyer_token, any_item_id):
    r = requests.post(
        f"{BASE_URL}/api/tryon",
        headers=_headers(buyer_token),
        json={
            "item_id": any_item_id,
            "angles": ["front"],
            "body_photo_b64": TINY_PNG_B64,
        },
        timeout=90,
    )
    # Not blocked by multi_angle paywall.
    if r.status_code == 402:
        detail = (r.json().get("detail") or {})
        assert detail.get("feature") != "multi_angle", (
            f"single-angle should not raise multi_angle paywall: {detail}"
        )
        # Weekly-limit paywall is acceptable here (means user is out of tries).
        assert detail.get("feature") in {"tryon_weekly_limit"}, detail
    else:
        # 200 (success) or 502 (LLM couldn't render our tiny stub) both prove
        # the multi_angle gate did NOT trigger.
        assert r.status_code in {200, 502}, f"unexpected {r.status_code}: {r.text[:200]}"


# ---------------------------------------------------------------------------
# 3. Free user multi-angle /tryon/outfit → 402 paywall.multi_angle
# ---------------------------------------------------------------------------
def test_free_user_multi_angle_outfit_returns_402(buyer_token, any_item_id):
    r = requests.post(
        f"{BASE_URL}/api/tryon/outfit",
        headers=_headers(buyer_token),
        json={
            "item_ids": [any_item_id],
            "angles": ["front", "side", "back"],
            "body_photo_b64": TINY_PNG_B64,
        },
        timeout=30,
    )
    assert r.status_code == 402, f"expected 402, got {r.status_code}: {r.text[:200]}"
    detail = r.json().get("detail") or {}
    assert detail.get("code") == "paywall"
    assert detail.get("feature") == "multi_angle"


# ---------------------------------------------------------------------------
# 4. Free user multi-angle /tryon/garment (BYO) → 402 paywall.multi_angle
# ---------------------------------------------------------------------------
def test_free_user_multi_angle_byo_returns_402(buyer_token):
    r = requests.post(
        f"{BASE_URL}/api/tryon/garment",
        headers=_headers(buyer_token),
        json={
            "garment_b64": TINY_PNG_B64,
            "body_photo_b64": TINY_PNG_B64,
            "angles": ["front", "side", "back"],
            "garment_type": "shirt",
            "label": "TEST_paywall_byo",
        },
        timeout=30,
    )
    assert r.status_code == 402, f"expected 402, got {r.status_code}: {r.text[:200]}"
    detail = r.json().get("detail") or {}
    assert detail.get("code") == "paywall"
    assert detail.get("feature") == "multi_angle"


# ---------------------------------------------------------------------------
# 5. Premium user multi-angle passes the gate.
#    Flip buyer→premium in DB, hit endpoints, then reset. Since Nano Banana
#    against a 1x1 PNG stub will return 502 (no images), we just assert we
#    got past the paywall — i.e. status ≠ 402.
# ---------------------------------------------------------------------------
@pytest.fixture
def _flip_to_premium():
    from pymongo import MongoClient
    mongo_url = (os.environ.get("MONGO_URL") or "").strip('"')
    db_name = (os.environ.get("DB_NAME") or "").strip('"')
    if not mongo_url or not db_name:
        pytest.skip("MONGO_URL/DB_NAME not available for module setup")
    client = MongoClient(mongo_url)
    db = client[db_name]
    db.users.update_one(
        {"email": BUYER_EMAIL},
        {"$set": {"subscription_tier": "premium", "subscription_status": "trialing"}},
    )
    try:
        yield
    finally:
        db.users.update_one(
            {"email": BUYER_EMAIL},
            {"$set": {"subscription_tier": "free", "subscription_status": None}},
        )


def test_premium_user_multi_angle_tryon_not_gated(_flip_to_premium, buyer_token, any_item_id):
    r = requests.post(
        f"{BASE_URL}/api/tryon",
        headers=_headers(buyer_token),
        json={
            "item_id": any_item_id,
            "angles": ["front", "side", "back"],
            "body_photo_b64": TINY_PNG_B64,
        },
        timeout=120,
    )
    # Must not be paywalled anymore. 200 (success) or 502 (LLM couldn't
    # render 1x1 stub) both prove the gate is open.
    assert r.status_code != 402, f"premium user got paywalled: {r.text[:200]}"
    assert r.status_code in {200, 502}, f"unexpected {r.status_code}: {r.text[:200]}"


def test_premium_user_multi_angle_outfit_not_gated(_flip_to_premium, buyer_token, any_item_id):
    r = requests.post(
        f"{BASE_URL}/api/tryon/outfit",
        headers=_headers(buyer_token),
        json={
            "item_ids": [any_item_id],
            "angles": ["front", "side", "back"],
            "body_photo_b64": TINY_PNG_B64,
        },
        timeout=120,
    )
    assert r.status_code != 402, f"premium user got paywalled on outfit: {r.text[:200]}"
    assert r.status_code in {200, 502}


def test_premium_user_multi_angle_byo_not_gated(_flip_to_premium, buyer_token):
    r = requests.post(
        f"{BASE_URL}/api/tryon/garment",
        headers=_headers(buyer_token),
        json={
            "garment_b64": TINY_PNG_B64,
            "body_photo_b64": TINY_PNG_B64,
            "angles": ["front", "side", "back"],
            "garment_type": "shirt",
            "label": "TEST_paywall_byo_premium",
        },
        timeout=120,
    )
    assert r.status_code != 402, f"premium user got paywalled on BYO: {r.text[:200]}"
    assert r.status_code in {200, 502}

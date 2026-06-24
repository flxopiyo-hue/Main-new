"""Phase C — Fit Match Score endpoint tests + Phase D foundation
(per-dimension narration) + stock visibility on items.

Endpoint under test: GET /api/items/{id}/fit-score
"""

from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
if not BASE_URL:
    BASE_URL = "https://fit-finder-app-5.preview.emergentagent.com"

BUYER = {"email": "buyer@aurafit.demo", "password": "demo-buyer-2026"}
SELLER = {"email": "atelier@aurafit.demo", "password": "demo-seller-2026"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"], r.json()["user"]


@pytest.fixture(scope="module")
def buyer_session():
    token, user = _login(BUYER)
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s, user


@pytest.fixture(scope="module")
def seller_session():
    token, user = _login(SELLER)
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s, user


_TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


@pytest.fixture(scope="module")
def items(seller_session):
    """Build a deterministic fully-dimensioned TEST_ shirt + a TEST_ shoes
    item via the seller account so fit-score has real per-size data to
    score against. Also returns the full /items list for stock checks.
    Cleans up at session end.
    """
    s, _ = seller_session
    created_ids = []

    shirt_payload = {
        "name": "TEST_FitShirt",
        "description": "Fit-score regression shirt",
        "category": "shirts",
        "price_cents": 5000,
        "image_b64": _TINY_PNG_B64,
        "garment_type": "shirt",
        "audience": "unisex",
        "sizes": [
            {"label": "S", "chest_cm": 92, "shoulder_cm": 42, "sleeve_cm": 60, "length_cm": 68, "available_qty": 8},
            {"label": "M", "chest_cm": 98, "shoulder_cm": 44, "sleeve_cm": 62, "length_cm": 70, "available_qty": 3},
            {"label": "L", "chest_cm": 106, "shoulder_cm": 46, "sleeve_cm": 64, "length_cm": 72, "available_qty": 0},
        ],
        "colors": [{"name": "Navy", "hex": "#1a2f4e"}],
    }
    r = s.post(f"{BASE_URL}/api/items", json=shirt_payload, timeout=20)
    assert r.status_code == 200, f"create shirt failed: {r.status_code} {r.text}"
    shirt = r.json()
    created_ids.append(shirt["id"])

    shoes_payload = {
        "name": "TEST_FitShoes",
        "description": "Fit-score regression shoes (unscorable)",
        "category": "shoes",
        "price_cents": 4000,
        "image_b64": _TINY_PNG_B64,
        "garment_type": "shoes",
        "audience": "unisex",
        "sizes": [
            {"label": "42", "available_qty": 4},
            {"label": "43", "available_qty": 0},
        ],
        "colors": [{"name": "Black", "hex": "#000000"}],
    }
    r = s.post(f"{BASE_URL}/api/items", json=shoes_payload, timeout=20)
    assert r.status_code == 200, f"create shoes failed: {r.status_code} {r.text}"
    shoes = r.json()
    created_ids.append(shoes["id"])

    r = requests.get(f"{BASE_URL}/api/items", timeout=20)
    arr = r.json() if r.status_code == 200 else []

    yield {"shirt": shirt, "shoes": shoes, "all": arr}

    for iid in created_ids:
        s.delete(f"{BASE_URL}/api/items/{iid}", timeout=20)


# ─────────────────────────  PHASE C — Fit Match  ─────────────────────────

class TestFitScoreShirt:
    def test_buyer_authed_shirt_returns_scorable(self, buyer_session, items):
        if not items["shirt"]:
            pytest.skip("No shirt item with dimensions found in seed data")
        s, _ = buyer_session
        shirt = items["shirt"]
        r = s.get(f"{BASE_URL}/api/items/{shirt['id']}/fit-score", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["scorable"] is True, body
        assert isinstance(body["score"], (int, float))
        assert 0 <= body["score"] <= 100
        assert body["color"] in ("green", "amber", "red")
        labels = [sz["label"] for sz in shirt["sizes"]]
        assert body["recommended_size"] in labels
        assert isinstance(body["per_size"], list) and len(body["per_size"]) > 0
        # at least one dimension has a narrative (Phase D foundation)
        any_narr = False
        for ps in body["per_size"]:
            for d in ps["dimensions"]:
                if d.get("narrative"):
                    any_narr = True
                    # narrative is "<label> <key>" e.g. "perfect chest"
                    assert isinstance(d["diff"], (int, float))
                    break
            if any_narr:
                break
        assert any_narr, "Expected at least one dimension with narrative"
        # Color matches score band
        score = body["score"]
        expected = "green" if score >= 75 else ("amber" if score >= 50 else "red")
        assert body["color"] == expected

    def test_anonymous_returns_200_not_scorable(self, items):
        if not items["shirt"]:
            pytest.skip("No shirt")
        r = requests.get(f"{BASE_URL}/api/items/{items['shirt']['id']}/fit-score", timeout=20)
        # MUST NOT 401
        assert r.status_code == 200, f"Expected 200 for anon, got {r.status_code}: {r.text}"
        body = r.json()
        assert body["scorable"] is False
        assert body["score"] is None


class TestFitScoreShoes:
    def test_shoes_not_scorable(self, buyer_session, items):
        if not items["shoes"]:
            pytest.skip("No shoes item")
        s, _ = buyer_session
        r = s.get(f"{BASE_URL}/api/items/{items['shoes']['id']}/fit-score", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["scorable"] is False
        assert body["score"] is None
        assert "Body-fit measurements aren't applicable" in (body.get("reason") or "")


class TestFitScoreProfiles:
    """Test loved-one profile resolution + cross-user isolation."""

    @pytest.fixture(scope="class")
    def loved_ones(self, buyer_session):
        """Create two loved-ones with different measurements; cleanup after."""
        s, _ = buyer_session
        created = []
        for name, chest in [("TEST_Petite", 80), ("TEST_Broad", 115)]:
            payload = {
                "name": name,
                "audience": "adult",
                "gender": "female",
                "measurements": {
                    "height_cm": 170,
                    "chest_cm": chest,
                    "waist_cm": chest - 15,
                    "hips_cm": chest + 5,
                    "shoulders_cm": 38 if chest < 100 else 46,
                },
            }
            r = s.post(f"{BASE_URL}/api/loved-ones", json=payload, timeout=20)
            assert r.status_code == 200, r.text
            created.append(r.json())
        yield created
        for lo in created:
            s.delete(f"{BASE_URL}/api/loved-ones/{lo['id']}", timeout=20)

    def test_profile_id_resolves_loved_one(self, buyer_session, items, loved_ones):
        if not items["shirt"]:
            pytest.skip("No shirt")
        s, _ = buyer_session
        shirt_id = items["shirt"]["id"]
        scores = []
        for lo in loved_ones:
            r = s.get(
                f"{BASE_URL}/api/items/{shirt_id}/fit-score?profile_id={lo['id']}",
                timeout=20,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["scorable"] is True, body
            scores.append(body["score"])
        # Petite vs Broad with very different chests should produce different scores
        assert scores[0] != scores[1], f"Expected different scores for different bodies, got {scores}"

    def test_other_users_profile_returns_404(self, buyer_session, items):
        """Random/fake profile_id (not owned by caller) → 404."""
        if not items["shirt"]:
            pytest.skip("No shirt")
        s, _ = buyer_session
        fake_id = str(uuid.uuid4())
        r = s.get(
            f"{BASE_URL}/api/items/{items['shirt']['id']}/fit-score?profile_id={fake_id}",
            timeout=20,
        )
        assert r.status_code == 404, f"Expected 404, got {r.status_code}: {r.text}"

    def test_seller_owned_profile_not_visible_to_buyer(self, buyer_session, seller_session, items):
        """If seller has a loved-one, buyer asking with that id should 404."""
        if not items["shirt"]:
            pytest.skip("No shirt")
        ss, _ = seller_session
        bs, _ = buyer_session
        # Create a loved-one on seller's account
        payload = {
            "name": "TEST_SellerLO",
            "audience": "adult",
            "measurements": {"height_cm": 175, "chest_cm": 95},
        }
        r = ss.post(f"{BASE_URL}/api/loved-ones", json=payload, timeout=20)
        if r.status_code != 200:
            # sellers may not be allowed loved-ones — skip
            pytest.skip(f"Could not create seller loved-one: {r.status_code} {r.text}")
        seller_lo = r.json()
        try:
            r = bs.get(
                f"{BASE_URL}/api/items/{items['shirt']['id']}/fit-score?profile_id={seller_lo['id']}",
                timeout=20,
            )
            assert r.status_code == 404, f"Cross-user leak! got {r.status_code}: {r.text}"
        finally:
            ss.delete(f"{BASE_URL}/api/loved-ones/{seller_lo['id']}", timeout=20)


class TestFitScoreNarration:
    """Phase D — per-dimension narration shape."""

    def test_narrative_values_are_human_phrases(self, buyer_session, items):
        if not items["shirt"]:
            pytest.skip("No shirt")
        s, _ = buyer_session
        r = s.get(f"{BASE_URL}/api/items/{items['shirt']['id']}/fit-score", timeout=20)
        assert r.status_code == 200
        body = r.json()
        allowed = {"very tight", "snug", "perfect", "roomy", "very roomy"}
        seen = set()
        for ps in body["per_size"]:
            for d in ps["dimensions"]:
                if d.get("narrative"):
                    head = d["narrative"].split(" ")[0]
                    # narrative could start with "very" (two words)
                    if head == "very":
                        head = " ".join(d["narrative"].split(" ")[:2])
                    seen.add(head)
        assert seen, "No narrative phrases observed"
        # all observed heads belong to the allowed set
        assert all(h in allowed for h in seen), f"Unexpected narration phrases: {seen}"


class TestItemNotFound:
    def test_unknown_item_returns_404(self, buyer_session):
        s, _ = buyer_session
        r = s.get(f"{BASE_URL}/api/items/{uuid.uuid4()}/fit-score", timeout=20)
        assert r.status_code == 404


# ─────────────────────────  Stock visibility  ─────────────────────────

class TestStock:
    """The stockBadge helper is frontend-only, but the data it depends on
    (sizes[].available_qty) is delivered by GET /api/items/{id}. We just
    validate the contract: available_qty is a non-negative integer per size,
    and the totals plumb through to the API."""

    def test_items_carry_available_qty(self, items):
        for it in items["all"][:10]:
            for sz in it.get("sizes", []) or []:
                assert "available_qty" in sz
                assert isinstance(sz["available_qty"], int)
                assert sz["available_qty"] >= 0

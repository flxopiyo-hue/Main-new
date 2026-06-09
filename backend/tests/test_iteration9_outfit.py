"""Iteration 9 — Multi-garment outfit try-on backend regression tests.

Covers the new POST /api/tryon/outfit endpoint plus garment_type inference,
validation, history rendering, share endpoint, single-item regression, and
preferences/auto-currency.

Run:  pytest /app/backend/tests/test_iteration9_outfit.py -v \
        --junitxml=/app/test_reports/pytest/iteration9_results.xml
"""

from __future__ import annotations

import base64
import os
import time
import uuid
from typing import Any, Dict, List, Optional

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://fit-finder-app-5.preview.emergentagent.com",
).rstrip("/")

SELLER_EMAIL = "atelier@aurafit.demo"
SELLER_PASSWORD = "demo-seller-2026"
BUYER_EMAIL = "buyer@aurafit.demo"
BUYER_PASSWORD = "demo-buyer-2026"

# 1×1 PNG (white) — sufficient base64 payload for image fields in tests.
_TINY_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg=="
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def http() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(http: requests.Session, email: str, password: str) -> Dict[str, Any]:
    r = http.post(
        f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}
    )
    assert r.status_code == 200, f"Login {email} failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def seller(http: requests.Session) -> Dict[str, Any]:
    return _login(http, SELLER_EMAIL, SELLER_PASSWORD)


@pytest.fixture(scope="module")
def buyer(http: requests.Session) -> Dict[str, Any]:
    return _login(http, BUYER_EMAIL, BUYER_PASSWORD)


def _auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Garment-type inference on existing seeded items
# ---------------------------------------------------------------------------
class TestGarmentTypeInference:
    """Verify GET /api/items exposes the new garment_type field and the
    inference keyword priority handles edge cases (e.g. Belted Trench Coat
    must classify as outerwear, NOT belt)."""

    EXPECTED = {
        "Selvedge Denim": "trousers",
        "Tailored Linen Shirt": "shirt",
        "Belted Trench Coat": "outerwear",
        "Editorial Slip Dress": "dress",
        "Pointed Leather Mule": "shoes",
    }

    def test_items_expose_garment_type(self, http: requests.Session) -> None:
        r = http.get(f"{BASE_URL}/api/items")
        assert r.status_code == 200
        items = r.json()
        assert len(items) > 0
        by_name = {it["name"]: it for it in items}
        for name, expected in self.EXPECTED.items():
            assert name in by_name, f"Seed item {name!r} missing"
            actual = by_name[name].get("garment_type")
            assert actual == expected, f"{name!r} expected {expected}, got {actual!r}"


# ---------------------------------------------------------------------------
# Seller CRUD with garment_type — inference and explicit override
# ---------------------------------------------------------------------------
class TestSellerCreateGarmentType:
    """Verify POST /api/items infers garment_type when not provided, and
    persists an explicit value when provided. Cleans up after itself."""

    def _payload(self, name: str, category: str, **extra: Any) -> Dict[str, Any]:
        return {
            "name": name,
            "description": "TEST item",
            "category": category,
            "price_cents": 1500,
            "image_b64": _TINY_PNG,
            "sizes": [{"label": "M", "available_qty": 1}],
            "colors": [],
            "audience": "unisex",
            **extra,
        }

    def test_post_item_without_garment_type_infers(
        self, http: requests.Session, seller: Dict[str, Any]
    ) -> None:
        # Use a name that triggers a non-trivial inference path: "Bomber" → outerwear
        name = f"TEST_Bomber_{uuid.uuid4().hex[:8]}"
        r = http.post(
            f"{BASE_URL}/api/items",
            json=self._payload(name, "outerwear"),
            headers=_auth(seller["token"]),
        )
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["garment_type"] == "outerwear"
        item_id = created["id"]
        try:
            # Re-fetch via GET /api/items and confirm persisted value is "outerwear"
            list_r = http.get(f"{BASE_URL}/api/items", headers=_auth(seller["token"]))
            assert list_r.status_code == 200
            match = next(
                (it for it in list_r.json() if it["id"] == item_id), None
            )
            assert match is not None, "Created item missing in /items"
            assert match["garment_type"] == "outerwear"
        finally:
            del_r = http.delete(
                f"{BASE_URL}/api/items/{item_id}", headers=_auth(seller["token"])
            )
            assert del_r.status_code == 200

    def test_post_item_with_explicit_garment_type_persists(
        self, http: requests.Session, seller: Dict[str, Any]
    ) -> None:
        # waistcoat would NOT be inferred from category 'shirts' alone
        # (it would default to 'shirt'), so explicit setting matters.
        name = f"TEST_NoVestKeyword_{uuid.uuid4().hex[:8]}"
        r = http.post(
            f"{BASE_URL}/api/items",
            json=self._payload(name, "shirts", garment_type="waistcoat"),
            headers=_auth(seller["token"]),
        )
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["garment_type"] == "waistcoat"
        item_id = created["id"]
        try:
            get_r = http.get(f"{BASE_URL}/api/items/{item_id}")
            assert get_r.status_code == 200
            assert get_r.json()["garment_type"] == "waistcoat"
        finally:
            http.delete(
                f"{BASE_URL}/api/items/{item_id}", headers=_auth(seller["token"])
            )


# ---------------------------------------------------------------------------
# OutfitTryOnIn Pydantic validation
# ---------------------------------------------------------------------------
class TestOutfitValidation:
    """Pydantic min_length=1 / max_length=8 constraints + 404 for bogus ids."""

    def test_empty_item_ids_returns_422(
        self, http: requests.Session, buyer: Dict[str, Any]
    ) -> None:
        r = http.post(
            f"{BASE_URL}/api/tryon/outfit",
            json={"item_ids": [], "use_profile_photo": True, "angles": ["front"]},
            headers=_auth(buyer["token"]),
        )
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"

    def test_too_many_item_ids_returns_422(
        self, http: requests.Session, buyer: Dict[str, Any]
    ) -> None:
        nine_ids = [str(uuid.uuid4()) for _ in range(9)]
        r = http.post(
            f"{BASE_URL}/api/tryon/outfit",
            json={
                "item_ids": nine_ids,
                "use_profile_photo": True,
                "angles": ["front"],
            },
            headers=_auth(buyer["token"]),
        )
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"

    def test_all_bogus_ids_returns_404(
        self, http: requests.Session, buyer: Dict[str, Any]
    ) -> None:
        r = http.post(
            f"{BASE_URL}/api/tryon/outfit",
            json={
                "item_ids": [str(uuid.uuid4()), str(uuid.uuid4())],
                "use_profile_photo": True,
                "angles": ["front"],
            },
            headers=_auth(buyer["token"]),
        )
        assert r.status_code == 404, f"Expected 404, got {r.status_code}: {r.text}"


# ---------------------------------------------------------------------------
# End-to-end outfit try-on (real Gemini call)
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def seeded_items_by_name(http: requests.Session) -> Dict[str, Dict[str, Any]]:
    r = http.get(f"{BASE_URL}/api/items")
    assert r.status_code == 200
    return {it["name"]: it for it in r.json()}


class TestOutfitEndToEnd:
    """Live Gemini Nano Banana outfit generation. If the LLM is rate-limited
    or credits exhausted (5xx), we SKIP rather than fail the suite."""

    @pytest.fixture(scope="class")
    def two_item_tryon(
        self,
        http: requests.Session,
        buyer: Dict[str, Any],
        seeded_items_by_name: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Any]:
        shirt = seeded_items_by_name["Tailored Linen Shirt"]
        trousers = seeded_items_by_name["Selvedge Denim"]
        # Intentionally supply trousers BEFORE shirt so the layer sort has
        # something to re-order — the response item_id must be the shirt's.
        r = http.post(
            f"{BASE_URL}/api/tryon/outfit",
            json={
                "item_ids": [trousers["id"], shirt["id"]],
                "use_profile_photo": True,
                "angles": ["front"],
            },
            headers=_auth(buyer["token"]),
            timeout=180,
        )
        if r.status_code >= 500:
            pytest.skip(f"Nano Banana unavailable: {r.status_code} {r.text[:200]}")
        assert r.status_code == 200, f"Outfit try-on failed: {r.status_code} {r.text[:500]}"
        data = r.json()
        data["_shirt_id"] = shirt["id"]
        data["_trousers_id"] = trousers["id"]
        return data

    def test_two_item_outfit_response_shape(
        self, two_item_tryon: Dict[str, Any]
    ) -> None:
        d = two_item_tryon
        # Backward-compat headline image present and non-empty
        assert d["result_image_b64"], "result_image_b64 must be non-empty"
        assert isinstance(d["images"], list)
        assert len(d["images"]) == 1, f"images list len={len(d['images'])}, expected 1"
        assert d["images"][0]["angle"] == "front"
        assert d["images"][0]["image_b64"]
        # First sorted item should be the shirt (layer 20) not trousers (30)
        assert d["item_id"] == d["_shirt_id"], (
            f"Expected shirt id ({d['_shirt_id']}) as headline item, got {d['item_id']}"
        )

    def test_two_item_outfit_persisted_in_history(
        self,
        http: requests.Session,
        buyer: Dict[str, Any],
        two_item_tryon: Dict[str, Any],
    ) -> None:
        # Allow a tiny propagation delay
        time.sleep(0.5)
        h = http.get(
            f"{BASE_URL}/api/tryon/history", headers=_auth(buyer["token"])
        )
        assert h.status_code == 200
        history = h.json()
        assert isinstance(history, list)
        # The new outfit should be near the top.
        match = next((t for t in history if t["id"] == two_item_tryon["id"]), None)
        assert match is not None, "Outfit try-on missing in /history"
        # It must not break the response shape for any legacy single-item try-on.
        for t in history:
            assert "result_image_b64" in t and "images" in t
        # Confirm images[] populated for the outfit row
        assert len(match["images"]) >= 1
        assert match["images"][0]["image_b64"]

    def test_share_outfit_tryon_returns_watermarked_image(
        self,
        http: requests.Session,
        buyer: Dict[str, Any],
        two_item_tryon: Dict[str, Any],
    ) -> None:
        s = http.get(
            f"{BASE_URL}/api/tryon/{two_item_tryon['id']}/share",
            params={"fmt": "square", "angle": "front"},
            headers=_auth(buyer["token"]),
        )
        assert s.status_code == 200, s.text
        share = s.json()
        assert share["image_b64"]
        # Must decode as a valid image
        raw = base64.b64decode(share["image_b64"])
        assert len(raw) > 1000  # non-trivial payload
        assert "caption" in share and share["caption"]

    @pytest.fixture(scope="class")
    def three_item_tryon(
        self,
        http: requests.Session,
        seller: Dict[str, Any],
        buyer: Dict[str, Any],
        seeded_items_by_name: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Any]:
        shirt = seeded_items_by_name["Tailored Linen Shirt"]
        trousers = seeded_items_by_name["Selvedge Denim"]
        # No belt in seed data — create a temporary one as the seller.
        belt_payload = {
            "name": f"TEST_Classic_Belt_{uuid.uuid4().hex[:8]}",
            "description": "TEST belt",
            "category": "accessories",
            "price_cents": 2500,
            "image_b64": _TINY_PNG,
            "sizes": [{"label": "M", "available_qty": 1}],
            "colors": [],
            "audience": "unisex",
        }
        cr = http.post(
            f"{BASE_URL}/api/items",
            json=belt_payload,
            headers=_auth(seller["token"]),
        )
        assert cr.status_code == 200, cr.text
        belt = cr.json()
        assert belt["garment_type"] == "belt", (
            f"Belt inference broke: got {belt['garment_type']}"
        )
        try:
            r = http.post(
                f"{BASE_URL}/api/tryon/outfit",
                json={
                    "item_ids": [trousers["id"], shirt["id"], belt["id"]],
                    "use_profile_photo": True,
                    "angles": ["front"],
                },
                headers=_auth(buyer["token"]),
                timeout=180,
            )
            if r.status_code >= 500:
                pytest.skip(
                    f"Nano Banana unavailable for 3-item outfit: {r.status_code}"
                )
            assert r.status_code == 200, r.text
            data = r.json()
            data["_belt_id"] = belt["id"]
            data["_shirt_id"] = shirt["id"]
            data["_trousers_id"] = trousers["id"]
            data["_belt_name"] = belt_payload["name"]
            data["_shirt_name"] = shirt["name"]
            data["_trousers_name"] = trousers["name"]
            yield data
        finally:
            http.delete(
                f"{BASE_URL}/api/items/{belt['id']}",
                headers=_auth(seller["token"]),
            )

    def test_three_item_outfit_fit_summary_mentions_all(
        self,
        http: requests.Session,
        buyer: Dict[str, Any],
        three_item_tryon: Dict[str, Any],
    ) -> None:
        d = three_item_tryon
        assert d["fit_summary"], "fit_summary must be populated for outfit try-ons"
        for nm in (d["_shirt_name"], d["_trousers_name"], d["_belt_name"]):
            assert nm in d["fit_summary"], (
                f"fit_summary missing '{nm}': {d['fit_summary']!r}"
            )
        # Headline item must still be the shirt (lowest layer among the three)
        assert d["item_id"] == d["_shirt_id"]


# ---------------------------------------------------------------------------
# Regression: single-item try-on + listing endpoints unchanged
# ---------------------------------------------------------------------------
class TestRegression:
    def test_single_item_tryon_still_works(
        self,
        http: requests.Session,
        buyer: Dict[str, Any],
        seeded_items_by_name: Dict[str, Dict[str, Any]],
    ) -> None:
        shirt = seeded_items_by_name["Tailored Linen Shirt"]
        r = http.post(
            f"{BASE_URL}/api/tryon",
            json={
                "item_id": shirt["id"],
                "use_profile_photo": True,
                "angles": ["front"],
            },
            headers=_auth(buyer["token"]),
            timeout=180,
        )
        if r.status_code >= 500:
            pytest.skip(f"Nano Banana unavailable: {r.status_code}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["item_id"] == shirt["id"]
        assert d["result_image_b64"]
        assert len(d["images"]) == 1
        assert d["images"][0]["angle"] == "front"

    @pytest.mark.parametrize(
        "path,auth_required",
        [
            ("/api/items?category=shirts", False),
            ("/api/feed", True),
            ("/api/wishlist", True),
            ("/api/orders", True),
            ("/api/collections", False),
        ],
    )
    def test_supporting_endpoints_return_200(
        self,
        http: requests.Session,
        buyer: Dict[str, Any],
        path: str,
        auth_required: bool,
    ) -> None:
        headers = _auth(buyer["token"]) if auth_required else None
        r = http.get(f"{BASE_URL}{path}", headers=headers)
        assert r.status_code == 200, f"{path} → {r.status_code} {r.text[:300]}"

    def test_seller_analytics_returns_200(
        self, http: requests.Session, seller: Dict[str, Any]
    ) -> None:
        r = http.get(
            f"{BASE_URL}/api/seller/analytics", headers=_auth(seller["token"])
        )
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Currency preferences regression
# ---------------------------------------------------------------------------
class TestCurrencyPreferences:
    def test_buyer_preferred_currency_unchanged(
        self, http: requests.Session, buyer: Dict[str, Any]
    ) -> None:
        u = buyer["user"]
        assert u.get("preferred_currency") in (
            "KES",
            "USD",
            "EUR",
            "GBP",
            "NGN",
            "ZAR",
            "INR",
            "UGX",
            "TZS",
            "RWF",
            "GHS",
            "EGP",
        ), f"Unexpected currency: {u.get('preferred_currency')}"

    def test_set_preferred_currency_kes(
        self, http: requests.Session, buyer: Dict[str, Any]
    ) -> None:
        # NOTE: the review spec said "POST /api/auth/preferences" but the
        # actual implementation only exposes PATCH (routers/auth.py:84).
        # We hit PATCH (the supported verb) and additionally assert that the
        # POST verb is NOT supported, so the spec/code mismatch is documented.
        post_r = http.post(
            f"{BASE_URL}/api/auth/preferences",
            json={"preferred_currency": "KES"},
            headers=_auth(buyer["token"]),
        )
        assert post_r.status_code == 405, (
            f"Expected POST to return 405 (only PATCH supported); got {post_r.status_code}"
        )
        r = http.patch(
            f"{BASE_URL}/api/auth/preferences",
            json={"preferred_currency": "KES"},
            headers=_auth(buyer["token"]),
        )
        assert r.status_code == 200, r.text
        out = r.json()
        # API may return either the user object or a wrapper — check both shapes.
        currency: Optional[str] = None
        if isinstance(out, dict):
            currency = (
                out.get("preferred_currency")
                or (out.get("user") or {}).get("preferred_currency")
            )
        assert currency == "KES", f"Expected KES, got {currency!r}: {out}"

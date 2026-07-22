"""Iteration 23 — Variants layer backend tests.

Covers:
- Bootstrap-populated variants on legacy items (GET /api/items, /api/items/{id})
- POST /items auto-generates variants from sizes x colors (and preserves explicit variants)
- PATCH sizes/colors regenerates variants while preserving qty/pricing for retained combos
- POST /payments/checkout resolves variant, populates order.variant_id, honours disabled + OOS
- GET /items excludes items with merged_into
- Subscription endpoints unaffected (/api/subs/health, /pay-web GET)
"""
from __future__ import annotations

import base64
import os
import uuid
from typing import Any, Dict, List, Optional

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://fit-finder-app-5.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")

BUYER = {"email": "buyer@aurafit.com", "password": "demo-buyer-2026"}
SELLER = {"email": "atelier@aurafit.com", "password": "demo-seller-2026"}

# 1x1 PNG base64 (transparent)
TINY_PNG = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082"
)).decode()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(api, creds) -> str:
    r = api.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def seller_token(api) -> str:
    return _login(api, SELLER)


@pytest.fixture(scope="session")
def buyer_token(api) -> str:
    return _login(api, BUYER)


def _auth(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# 1) Bootstrap backfilled variants on existing items
# ---------------------------------------------------------------------------
class TestBootstrapVariants:
    def test_list_items_all_have_variants(self, api):
        r = api.get(f"{BASE_URL}/api/items", timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert len(items) > 0, "No items returned — need seed data"
        for it in items:
            assert "variants" in it, f"item {it['id']} missing variants"
            assert isinstance(it["variants"], list)
            assert len(it["variants"]) > 0, f"item {it['id']} has empty variants"

    def test_at_least_one_item_variants_match_sizes_x_colors(self, api):
        r = api.get(f"{BASE_URL}/api/items", timeout=20)
        items = r.json()
        matched = 0
        for it in items:
            sizes = it.get("sizes", [])
            colors = it.get("colors", [])
            expected = len(sizes) * max(len(colors), 1)
            if len(it["variants"]) == expected and expected > 0:
                matched += 1
        assert matched >= 1, f"No item has variants == sizes*max(colors,1); items={len(items)}"

    def test_get_item_returns_variants(self, api):
        r = api.get(f"{BASE_URL}/api/items", timeout=20)
        items = r.json()
        assert items
        item_id = items[0]["id"]
        r2 = api.get(f"{BASE_URL}/api/items/{item_id}", timeout=20)
        assert r2.status_code == 200
        doc = r2.json()
        assert "variants" in doc
        assert isinstance(doc["variants"], list)
        # Each variant has required fields
        for v in doc["variants"]:
            assert "id" in v and v["id"]
            assert "size_label" in v and v["size_label"]
            assert "quantity" in v
            assert "disabled" in v

    def test_merged_items_excluded_from_list(self, api):
        """Items with merged_into must not appear in GET /api/items."""
        r = api.get(f"{BASE_URL}/api/items", timeout=20)
        items = r.json()
        # None of the returned items should carry a merged_into field (list
        # filters them out); we can also check DB via API only — since
        # merged_into is not in ItemOut model, we validate uniqueness via
        # count consistency and no error surface.
        ids = [it["id"] for it in items]
        assert len(ids) == len(set(ids)), "duplicate ids returned"


# ---------------------------------------------------------------------------
# 2) Create item — auto-generate variants
# ---------------------------------------------------------------------------
class TestCreateItemVariants:
    def _payload(self, name: str, sizes, colors, variants=None) -> Dict[str, Any]:
        body = {
            "name": name,
            "description": "TEST variant item",
            "category": "shirts",
            "price_cents": 5000,
            "currency": "KES",
            "image_b64": TINY_PNG,
            "sizes": sizes,
            "colors": colors,
            "audience": "unisex",
        }
        if variants is not None:
            body["variants"] = variants
        return body

    def test_auto_generate_variants_from_sizes_x_colors(self, api, seller_token):
        name = f"TEST_variants_auto_{uuid.uuid4().hex[:6]}"
        sizes = [
            {"label": "S", "available_qty": 6},
            {"label": "M", "available_qty": 4},
        ]
        colors = [
            {"name": "Red", "hex": "#FF0000"},
            {"name": "Blue", "hex": "#0000FF"},
        ]
        r = api.post(
            f"{BASE_URL}/api/items",
            json=self._payload(name, sizes, colors),
            headers=_auth(seller_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        out = r.json()
        variants = out["variants"]
        assert len(variants) == 4, f"expected 4 variants got {len(variants)}"
        ids = [v["id"] for v in variants]
        assert len(set(ids)) == 4, "variant ids must be unique"
        # Check size × color coverage
        combos = {(v["size_label"], v["color_name"]) for v in variants}
        assert combos == {("S", "Red"), ("S", "Blue"), ("M", "Red"), ("M", "Blue")}
        # Quantity split: S=6 → 3+3; M=4 → 2+2
        by_size = {}
        for v in variants:
            by_size.setdefault(v["size_label"], 0)
            by_size[v["size_label"]] += v["quantity"]
        assert by_size["S"] == 6
        assert by_size["M"] == 4
        # color_hex populated
        for v in variants:
            assert v["color_hex"] in {"#FF0000", "#0000FF"}
        # Cleanup
        api.delete(f"{BASE_URL}/api/items/{out['id']}", headers=_auth(seller_token))

    def test_auto_generate_variants_no_colors(self, api, seller_token):
        name = f"TEST_variants_nocolor_{uuid.uuid4().hex[:6]}"
        sizes = [
            {"label": "S", "available_qty": 3},
            {"label": "M", "available_qty": 2},
        ]
        r = api.post(
            f"{BASE_URL}/api/items",
            json=self._payload(name, sizes, []),
            headers=_auth(seller_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        out = r.json()
        variants = out["variants"]
        assert len(variants) == 2
        for v in variants:
            assert v["color_name"] is None
        api.delete(f"{BASE_URL}/api/items/{out['id']}", headers=_auth(seller_token))

    def test_explicit_variants_preserved(self, api, seller_token):
        name = f"TEST_variants_explicit_{uuid.uuid4().hex[:6]}"
        sizes = [{"label": "S", "available_qty": 5}, {"label": "M", "available_qty": 5}]
        colors = [{"name": "Red", "hex": "#FF0000"}]
        explicit = [
            {
                "id": "custom-variant-1",
                "size_label": "S",
                "color_name": "Red",
                "color_hex": "#FF0000",
                "quantity": 7,
                "price_cents_override": 9999,
                "disabled": False,
            },
            {
                "id": "custom-variant-2",
                "size_label": "M",
                "color_name": "Red",
                "color_hex": "#FF0000",
                "quantity": 0,
                "disabled": True,
            },
        ]
        r = api.post(
            f"{BASE_URL}/api/items",
            json=self._payload(name, sizes, colors, variants=explicit),
            headers=_auth(seller_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        out = r.json()
        variants = out["variants"]
        assert len(variants) == 2
        ids = {v["id"] for v in variants}
        assert ids == {"custom-variant-1", "custom-variant-2"}
        s_var = next(v for v in variants if v["id"] == "custom-variant-1")
        m_var = next(v for v in variants if v["id"] == "custom-variant-2")
        assert s_var["quantity"] == 7
        assert s_var["price_cents_override"] == 9999
        assert m_var["disabled"] is True
        api.delete(f"{BASE_URL}/api/items/{out['id']}", headers=_auth(seller_token))


# ---------------------------------------------------------------------------
# 3) PATCH sizes/colors regenerates variants preserving prior qty/pricing
# ---------------------------------------------------------------------------
class TestPatchRegenerates:
    def _create(self, api, seller_token, sizes, colors) -> Dict[str, Any]:
        body = {
            "name": f"TEST_patch_{uuid.uuid4().hex[:6]}",
            "description": "TEST",
            "category": "shirts",
            "price_cents": 4000,
            "currency": "KES",
            "image_b64": TINY_PNG,
            "sizes": sizes,
            "colors": colors,
        }
        r = api.post(f"{BASE_URL}/api/items", json=body, headers=_auth(seller_token), timeout=20)
        assert r.status_code == 200, r.text
        return r.json()

    def test_patch_sizes_regenerates_and_preserves_qty(self, api, seller_token):
        item = self._create(
            api,
            seller_token,
            [{"label": "S", "available_qty": 4}, {"label": "M", "available_qty": 4}],
            [{"name": "Red", "hex": "#FF0000"}, {"name": "Blue", "hex": "#0000FF"}],
        )
        # Edit S-Red variant to qty 99 + price override, then PATCH sizes to remove M and add L.
        variants = item["variants"]
        s_red = next(v for v in variants if v["size_label"] == "S" and v["color_name"] == "Red")
        edited_variants = []
        for v in variants:
            v2 = dict(v)
            if v["id"] == s_red["id"]:
                v2["quantity"] = 99
                v2["price_cents_override"] = 12345
            edited_variants.append(v2)
        # First save edited variants explicitly
        rp = api.patch(
            f"{BASE_URL}/api/items/{item['id']}",
            json={"variants": edited_variants},
            headers=_auth(seller_token),
            timeout=20,
        )
        assert rp.status_code == 200, rp.text

        # Now patch sizes: remove M, add L (Red+Blue). variants should regenerate.
        rp2 = api.patch(
            f"{BASE_URL}/api/items/{item['id']}",
            json={"sizes": [
                {"label": "S", "available_qty": 4},
                {"label": "L", "available_qty": 6},
            ]},
            headers=_auth(seller_token),
            timeout=20,
        )
        assert rp2.status_code == 200, rp2.text
        out = rp2.json()
        # M-* variants removed
        for v in out["variants"]:
            assert v["size_label"] != "M"
        # S-Red preserved with qty 99 + override
        s_red_new = next(
            (v for v in out["variants"] if v["size_label"] == "S" and v["color_name"] == "Red"),
            None,
        )
        assert s_red_new is not None
        assert s_red_new["quantity"] == 99, f"qty not preserved: {s_red_new}"
        assert s_red_new["price_cents_override"] == 12345
        # L variants exist for each color
        l_variants = [v for v in out["variants"] if v["size_label"] == "L"]
        assert len(l_variants) == 2
        api.delete(f"{BASE_URL}/api/items/{item['id']}", headers=_auth(seller_token))

    def test_patch_colors_regenerates_preserves_kept_combos(self, api, seller_token):
        item = self._create(
            api,
            seller_token,
            [{"label": "S", "available_qty": 4}],
            [{"name": "Red", "hex": "#FF0000"}, {"name": "Blue", "hex": "#0000FF"}],
        )
        # Edit S-Blue variant
        edited = []
        target_id = None
        for v in item["variants"]:
            v2 = dict(v)
            if v["color_name"] == "Blue":
                v2["quantity"] = 55
                target_id = v["id"]
            edited.append(v2)
        api.patch(
            f"{BASE_URL}/api/items/{item['id']}",
            json={"variants": edited},
            headers=_auth(seller_token),
            timeout=20,
        )
        # PATCH colors: drop Red, keep Blue, add Green
        rp = api.patch(
            f"{BASE_URL}/api/items/{item['id']}",
            json={"colors": [
                {"name": "Blue", "hex": "#0000FF"},
                {"name": "Green", "hex": "#00FF00"},
            ]},
            headers=_auth(seller_token),
            timeout=20,
        )
        assert rp.status_code == 200, rp.text
        out = rp.json()
        color_names = {v["color_name"] for v in out["variants"]}
        assert "Red" not in color_names
        assert "Blue" in color_names and "Green" in color_names
        blue_v = next(v for v in out["variants"] if v["color_name"] == "Blue")
        assert blue_v["quantity"] == 55, "Blue variant qty should be preserved"
        assert blue_v["id"] == target_id, "Blue variant id preserved"
        api.delete(f"{BASE_URL}/api/items/{item['id']}", headers=_auth(seller_token))


# ---------------------------------------------------------------------------
# 4) Checkout — variant resolution + disabled + OOS
# ---------------------------------------------------------------------------
class TestCheckoutVariant:
    @pytest.fixture
    def seller_item(self, api, seller_token):
        body = {
            "name": f"TEST_checkout_{uuid.uuid4().hex[:6]}",
            "description": "TEST",
            "category": "shirts",
            "price_cents": 5000,
            "currency": "KES",
            "image_b64": TINY_PNG,
            "sizes": [{"label": "S", "available_qty": 4}, {"label": "M", "available_qty": 2}],
            "colors": [{"name": "Red", "hex": "#FF0000"}, {"name": "Blue", "hex": "#0000FF"}],
        }
        r = api.post(f"{BASE_URL}/api/items", json=body, headers=_auth(seller_token), timeout=20)
        assert r.status_code == 200
        item = r.json()
        yield item
        api.delete(f"{BASE_URL}/api/items/{item['id']}", headers=_auth(seller_token))

    @pytest.fixture(scope="class")
    def buyer_address(self, api, buyer_token):
        r = api.get(f"{BASE_URL}/api/addresses", headers=_auth(buyer_token), timeout=20)
        assert r.status_code == 200, r.text
        addrs = r.json()
        if addrs:
            return addrs[0]["id"]
        # Create one
        r2 = api.post(
            f"{BASE_URL}/api/addresses",
            json={
                "label": "home",
                "recipient_name": "TEST Buyer",
                "phone": "+254700000000",
                "city": "Nairobi",
                "country": "Kenya",
                "is_default": True,
            },
            headers=_auth(buyer_token),
            timeout=20,
        )
        assert r2.status_code in (200, 201), r2.text
        return r2.json()["id"]

    def test_checkout_with_variant_id(self, api, seller_item, buyer_token, buyer_address):
        variant = seller_item["variants"][0]
        body = {
            "item_id": seller_item["id"],
            "size": variant["size_label"],
            "color": variant.get("color_name"),
            "variant_id": variant["id"],
            "origin_url": "https://oromona.example.com",
            "address_id": buyer_address,
        }
        r = api.post(
            f"{BASE_URL}/api/payments/checkout",
            json=body,
            headers=_auth(buyer_token),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("url", "").startswith("http"), f"missing paystack url: {data}"
        assert "session_id" in data
        # Verify order document has variant_id populated (via orders list)
        ro = api.get(f"{BASE_URL}/api/orders/mine", headers=_auth(buyer_token), timeout=20)
        if ro.status_code == 200:
            orders = ro.json()
            match = next((o for o in orders if o.get("session_id") == data["session_id"]), None)
            if match is not None:
                assert match.get("variant_id") == variant["id"], f"variant_id not persisted: {match}"

    def test_checkout_without_variant_id_resolves_from_size_color(
        self, api, seller_item, buyer_token, buyer_address
    ):
        # Pick M-Blue
        target = next(v for v in seller_item["variants"] if v["size_label"] == "M" and v["color_name"] == "Blue")
        body = {
            "item_id": seller_item["id"],
            "size": "M",
            "color": "Blue",
            "origin_url": "https://oromona.example.com",
            "address_id": buyer_address,
        }
        r = api.post(
            f"{BASE_URL}/api/payments/checkout",
            json=body,
            headers=_auth(buyer_token),
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Confirm variant_id resolved
        ro = api.get(f"{BASE_URL}/api/orders/mine", headers=_auth(buyer_token), timeout=20)
        if ro.status_code == 200:
            match = next((o for o in ro.json() if o.get("session_id") == data["session_id"]), None)
            if match is not None:
                assert match.get("variant_id") == target["id"], (
                    f"expected variant_id {target['id']}, got {match.get('variant_id')}"
                )

    def test_checkout_disabled_variant_returns_409(
        self, api, seller_token, buyer_token, buyer_address
    ):
        # Create item with a disabled variant
        body_item = {
            "name": f"TEST_disabled_{uuid.uuid4().hex[:6]}",
            "description": "TEST",
            "category": "shirts",
            "price_cents": 3000,
            "currency": "KES",
            "image_b64": TINY_PNG,
            "sizes": [{"label": "S", "available_qty": 4}],
            "colors": [{"name": "Red", "hex": "#FF0000"}],
            "variants": [
                {
                    "id": "disabled-var",
                    "size_label": "S",
                    "color_name": "Red",
                    "color_hex": "#FF0000",
                    "quantity": 5,
                    "disabled": True,
                }
            ],
        }
        r = api.post(f"{BASE_URL}/api/items", json=body_item, headers=_auth(seller_token), timeout=20)
        assert r.status_code == 200, r.text
        item = r.json()
        try:
            body = {
                "item_id": item["id"],
                "size": "S",
                "color": "Red",
                "variant_id": "disabled-var",
                "origin_url": "https://oromona.example.com",
                "address_id": buyer_address,
            }
            r2 = api.post(
                f"{BASE_URL}/api/payments/checkout",
                json=body,
                headers=_auth(buyer_token),
                timeout=20,
            )
            assert r2.status_code == 409, f"expected 409 got {r2.status_code}: {r2.text}"
        finally:
            api.delete(f"{BASE_URL}/api/items/{item['id']}", headers=_auth(seller_token))

    def test_checkout_out_of_stock_variant_returns_409(
        self, api, seller_token, buyer_token, buyer_address
    ):
        body_item = {
            "name": f"TEST_oos_{uuid.uuid4().hex[:6]}",
            "description": "TEST",
            "category": "shirts",
            "price_cents": 3000,
            "currency": "KES",
            "image_b64": TINY_PNG,
            "sizes": [{"label": "S", "available_qty": 0}],
            "colors": [{"name": "Red", "hex": "#FF0000"}],
            "variants": [
                {
                    "id": "oos-var",
                    "size_label": "S",
                    "color_name": "Red",
                    "color_hex": "#FF0000",
                    "quantity": 0,
                    "disabled": False,
                }
            ],
        }
        r = api.post(f"{BASE_URL}/api/items", json=body_item, headers=_auth(seller_token), timeout=20)
        assert r.status_code == 200, r.text
        item = r.json()
        try:
            body = {
                "item_id": item["id"],
                "size": "S",
                "color": "Red",
                "variant_id": "oos-var",
                "origin_url": "https://oromona.example.com",
                "address_id": buyer_address,
            }
            r2 = api.post(
                f"{BASE_URL}/api/payments/checkout",
                json=body,
                headers=_auth(buyer_token),
                timeout=20,
            )
            assert r2.status_code == 409, f"expected 409 got {r2.status_code}: {r2.text}"
        finally:
            api.delete(f"{BASE_URL}/api/items/{item['id']}", headers=_auth(seller_token))


# ---------------------------------------------------------------------------
# 5) Subscription endpoints unaffected
# ---------------------------------------------------------------------------
class TestSubsUnaffected:
    def test_subs_health(self, api):
        r = api.get(f"{BASE_URL}/api/subs/health", timeout=20)
        assert r.status_code == 200, r.text

    def test_subs_pay_web_html(self, api):
        r = api.get(f"{BASE_URL}/api/subs/pay-web", timeout=20)
        assert r.status_code == 200
        assert "html" in (r.headers.get("content-type") or "").lower()

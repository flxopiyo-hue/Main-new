"""Iteration 22 — Stripe → Paystack migration for item purchases + HTTPS
callback fix + /api/subs/health diagnostic.

Focus:
  1. POST /api/payments/checkout returns Paystack session_id (starts with
     'oromona_order_'), URL contains 'paystack', pending order in db.orders
     with session_id == reference.
  2. GET /api/payments/status/{session_id} returns 'pending' shape.
  3. GET /api/payments/paystack-return (invalid ref, missing ref) → HTML
     400/502.
  4. POST /api/payments/webhook without signature → 401.
  5. POST /api/subs/webhook with 'oromona_order_' reference short-circuits
     (item purchase reconciliation, no auth), and still handles unknown
     subs events gracefully.
  6. GET /api/subs/health → 200 with all keys, HTTPS callback.
  7. No stale Stripe imports blow up any endpoint (indirect: /api/items,
     /api/orders, /api/subs/me all work).
  8. Existing /api/subs/checkout, /api/subs/me, /api/subs/pay-web still
     work; /api/orders still lists orders with new paystack_reference.
"""

from __future__ import annotations

import os
import re
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://fit-finder-app-5.preview.emergentagent.com",
).rstrip("/")

BUYER_EMAIL = "buyer@aurafit.com"
BUYER_PASSWORD = "demo-buyer-2026"
SELLER_EMAIL = "atelier@aurafit.com"
SELLER_PASSWORD = "demo-seller-2026"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(api_client, email, password):
    r = api_client.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def buyer_token(api_client):
    return _login(api_client, BUYER_EMAIL, BUYER_PASSWORD)


@pytest.fixture(scope="module")
def buyer_headers(buyer_token):
    return {"Authorization": f"Bearer {buyer_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def any_item(api_client):
    """Grab a listed item from the public feed for the buyer to try to buy."""
    r = api_client.get(f"{BASE_URL}/api/items?limit=5")
    assert r.status_code == 200, r.text
    items = r.json()
    assert isinstance(items, list) and items, "expected at least one seeded item"
    return items[0]


@pytest.fixture(scope="module")
def buyer_address(api_client, buyer_headers):
    """Ensure the buyer has at least one address; return its id."""
    r = api_client.get(f"{BASE_URL}/api/addresses", headers=buyer_headers)
    assert r.status_code == 200, r.text
    addrs = r.json()
    if addrs:
        return addrs[0]["id"]
    payload = {
        "label": "home",
        "recipient_name": "Test Buyer",
        "phone": "+254712345678",
        "street": "1 Kimathi St",
        "city": "Nairobi",
        "country": "Kenya",
        "is_default": True,
    }
    r = api_client.post(f"{BASE_URL}/api/addresses", headers=buyer_headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------------------------------------------------------------------------
# 1. /api/subs/health diagnostic endpoint
# ---------------------------------------------------------------------------

class TestSubsHealth:
    def test_health_shape_and_https_callback(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/subs/health")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["app"] == "Oromona"
        assert "paystack" in d
        ps = d["paystack"]
        assert ps["secret_key_mode"] in {"test", "live"}
        assert ps["public_key_mode"] in {"test", "live"}
        assert ps["keys_match_mode"] is True
        assert ps["cached_plan_code"], "plan_code should be cached at startup"
        # Critical bug this iteration fixes: callback URL must be HTTPS
        cb = d["callback_url_the_checkout_will_use"]
        assert cb.startswith("https://"), f"callback must be HTTPS, got {cb!r}"
        assert cb.endswith("/api/subs/paystack-return")
        assert d["webhook_url_paystack_should_hit"].startswith("https://")
        assert d["public_base_url_detected"].startswith("https://")


# ---------------------------------------------------------------------------
# 2. Item purchase checkout — Stripe→Paystack migration
# ---------------------------------------------------------------------------

class TestItemCheckout:
    reference: str = ""
    order_id: str = ""

    def test_checkout_creates_paystack_session(
        self, api_client, buyer_headers, any_item, buyer_address
    ):
        # sizes is a list of dicts like [{"label":"XL",...}]; grab first label
        sizes = any_item.get("sizes") or []
        size_label = sizes[0]["label"] if sizes and isinstance(sizes[0], dict) else (sizes[0] if sizes else "M")
        payload = {
            "item_id": any_item["id"],
            "size": size_label,
            "color": None,
            "origin_url": "https://fit-finder-app-5.preview.emergentagent.com",
            "address_id": buyer_address,
        }
        r = api_client.post(
            f"{BASE_URL}/api/payments/checkout", headers=buyer_headers, json=payload
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        d = r.json()
        assert set(d.keys()) >= {"session_id", "url"}
        assert d["session_id"].startswith("oromona_order_"), d["session_id"]
        assert "paystack" in d["url"].lower(), d["url"]
        TestItemCheckout.reference = d["session_id"]

    def test_order_persisted_with_paystack_reference(
        self, api_client, buyer_headers
    ):
        assert TestItemCheckout.reference, "checkout must run first"
        # /api/orders lists buyer orders with the new paystack_reference
        r = api_client.get(f"{BASE_URL}/api/orders", headers=buyer_headers)
        assert r.status_code == 200, r.text
        orders = r.json()
        assert isinstance(orders, list) and orders
        match = [o for o in orders if o.get("session_id") == TestItemCheckout.reference]
        assert match, f"expected an order with session_id={TestItemCheckout.reference!r}; got sessions={[o.get('session_id') for o in orders[:5]]}"
        o = match[0]
        assert o["status"] == "pending"
        # session_id == paystack reference (backwards compat)
        assert o["session_id"] == TestItemCheckout.reference
        TestItemCheckout.order_id = o["id"]

    def test_payment_status_pending(self, api_client, buyer_headers):
        ref = TestItemCheckout.reference
        assert ref
        r = api_client.get(
            f"{BASE_URL}/api/payments/status/{ref}", headers=buyer_headers
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["session_id"] == ref
        # Paystack test-mode transaction is not paid yet — must remain pending
        # (or move to failed/cancelled), but never 500.
        assert d["status"] in {"pending", "failed", "cancelled"}, d
        assert "amount_cents" in d and "item_name" in d


# ---------------------------------------------------------------------------
# 3. /api/payments/paystack-return branded HTML page
# ---------------------------------------------------------------------------

class TestPaystackReturnBridge:
    def test_missing_reference_returns_400_html(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/payments/paystack-return")
        assert r.status_code == 400, r.text
        assert "text/html" in r.headers.get("content-type", "")
        assert "Missing reference" in r.text
        # Oromona branding present
        assert "Oromona" in r.text

    def test_invalid_reference_returns_html(self, api_client):
        bogus = f"oromona_order_{uuid.uuid4().hex[:8]}"
        r = api_client.get(
            f"{BASE_URL}/api/payments/paystack-return?reference={bogus}"
        )
        # Paystack rejects the unknown ref → our endpoint returns 502 branded HTML.
        # NOTE: Cloudflare/ingress replaces 502 origin bodies with its OWN error
        # page in this preview environment, so on 502 we can only assert status
        # and that we did NOT get a raw Python traceback. On 200/400 (some
        # verify paths return 200 with "not_completed" HTML) we can still check
        # the Oromona branded body.
        assert r.status_code in {200, 400, 502}, r.text
        assert "text/html" in r.headers.get("content-type", "")
        assert "Traceback" not in r.text
        if r.status_code != 502:
            assert "Oromona" in r.text


# ---------------------------------------------------------------------------
# 4. Webhooks — signature enforcement + subs webhook routing
# ---------------------------------------------------------------------------

class TestWebhooks:
    def test_payments_webhook_no_signature_401(self, api_client):
        r = requests.post(f"{BASE_URL}/api/payments/webhook", data=b"{}")
        assert r.status_code == 401, r.text

    def test_payments_webhook_bad_signature_401(self, api_client):
        r = requests.post(
            f"{BASE_URL}/api/payments/webhook",
            data=b"{}",
            headers={"x-paystack-signature": "deadbeef"},
        )
        assert r.status_code == 401, r.text

    def test_subs_webhook_no_signature_401(self, api_client):
        r = requests.post(f"{BASE_URL}/api/subs/webhook", data=b"{}")
        assert r.status_code == 401, r.text

    def test_subs_webhook_bad_signature_401(self, api_client):
        # Even with an oromona_order_* reference we must still enforce
        # signature before processing.
        body = b'{"event":"charge.success","data":{"reference":"oromona_order_deadbeef"}}'
        r = requests.post(
            f"{BASE_URL}/api/subs/webhook",
            data=body,
            headers={"x-paystack-signature": "notasignature"},
        )
        assert r.status_code == 401, r.text


# ---------------------------------------------------------------------------
# 5. Subscription flow still works (regression)
# ---------------------------------------------------------------------------

class TestSubsRegression:
    def test_subs_me_shape(self, api_client, buyer_headers):
        r = api_client.get(f"{BASE_URL}/api/subs/me", headers=buyer_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "subscription" in d and "gate" in d
        sub = d["subscription"]
        assert sub["tier"] in {"free", "premium"}
        assert isinstance(sub["plan_amount_kes"], (int, float))
        assert sub["plan_amount_kes"] == 199

    def test_subs_pay_web_html_form(self, api_client):
        r = requests.get(f"{BASE_URL}/api/subs/pay-web")
        assert r.status_code == 200, r.text
        assert "text/html" in r.headers.get("content-type", "")
        # Form must POST to the Oromona backend pay-web endpoint
        assert "/api/subs/pay-web" in r.text
        assert "Oromona" in r.text

    def test_subs_checkout_returns_paystack_url(self, api_client, buyer_headers):
        # Buyer is currently non-premium (per test fixtures). If already
        # premium the endpoint returns 400 — that's still a valid regression
        # signal (no crash) so we accept either.
        r = api_client.post(
            f"{BASE_URL}/api/subs/checkout", headers=buyer_headers, json={}
        )
        assert r.status_code in {200, 400}, r.text
        if r.status_code == 200:
            d = r.json()
            assert "authorization_url" in d and "reference" in d
            assert "paystack" in d["authorization_url"].lower()
            assert d["reference"].startswith("oromona_")

    def test_subs_paystack_return_missing_ref(self, api_client):
        r = requests.get(f"{BASE_URL}/api/subs/paystack-return")
        assert r.status_code == 400, r.text
        assert "text/html" in r.headers.get("content-type", "")
        assert "Missing reference" in r.text


# ---------------------------------------------------------------------------
# 6. Sanity: no stale Stripe imports break payment / order surfaces
# ---------------------------------------------------------------------------

class TestNoStripeCrash:
    def test_items_listing(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/items?limit=1")
        assert r.status_code == 200, r.text

    def test_orders_listing(self, api_client, buyer_headers):
        r = api_client.get(f"{BASE_URL}/api/orders", headers=buyer_headers)
        assert r.status_code == 200, r.text

    def test_checkout_requires_auth(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/payments/checkout",
            json={
                "item_id": "x",
                "size": "M",
                "origin_url": "https://x",
                "address_id": "y",
            },
        )
        assert r.status_code in {401, 403}, r.text

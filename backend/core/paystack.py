"""Paystack API client for Oromona Premium subscriptions.

Small async wrapper over the Paystack REST API. We deliberately stay
close to the raw REST calls (no SDK) so that we can move to Flutterwave
or Pesapal later without deep refactors — the surface area is <200
lines. Every call funnels through :func:`_request` which centralises:

  * Auth header injection (Bearer <secret>)
  * JSON payload serialisation
  * Uniform error shape (Paystack wraps errors in ``{status, message}``)
  * A short logging trail we can grep in production
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any, Dict, Optional

import httpx

from core.config import PAYSTACK_SECRET_KEY

logger = logging.getLogger("aurafit.paystack")

BASE_URL = "https://api.paystack.co"
DEFAULT_TIMEOUT = 20.0


class PaystackError(RuntimeError):
    """Raised when Paystack returns status=false or a non-2xx HTTP."""


def _headers() -> Dict[str, str]:
    if not PAYSTACK_SECRET_KEY:
        raise PaystackError("PAYSTACK_SECRET_KEY is not configured")
    return {
        "Authorization": f"Bearer {PAYSTACK_SECRET_KEY}",
        "Content-Type": "application/json",
    }


async def _request(method: str, path: str, *, json: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        try:
            res = await client.request(method, f"{BASE_URL}{path}", headers=_headers(), json=json)
        except httpx.HTTPError as e:  # pragma: no cover - network flakes
            logger.warning("paystack transport error %s %s: %s", method, path, e)
            raise PaystackError(f"Paystack network error: {e}") from e
    try:
        data = res.json()
    except ValueError:
        raise PaystackError(f"Paystack returned non-JSON: {res.text[:200]}")
    if res.status_code >= 300 or not data.get("status"):
        msg = data.get("message") or f"HTTP {res.status_code}"
        logger.warning("paystack %s %s failed: %s", method, path, msg)
        raise PaystackError(msg)
    return data


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def list_plans() -> list[Dict[str, Any]]:
    data = await _request("GET", "/plan?perPage=100")
    return data.get("data") or []


async def create_plan(
    *, name: str, amount_kobo: int, interval: str = "monthly", currency: str = "KES", trial_days: int = 0
) -> Dict[str, Any]:
    """Create a Paystack Plan.

    NOTE on trial_days: Paystack rejects ``trial_days`` on the plan
    endpoint ("Unknown/Unexpected parameter") — the docs claim otherwise
    but the test API disagrees. The 7-day trial is implemented instead
    via a ``start_date`` on the manual subscription creation which the
    webhook wires up after the first authorization lands, and by
    persisting ``trial_end`` on our user document so gating unlocks
    immediately without waiting for Paystack's first charge.
    """
    payload = {
        "name": name,
        "amount": amount_kobo,
        "interval": interval,
        "currency": currency,
    }
    data = await _request("POST", "/plan", json=payload)
    return data["data"]


async def initialize_transaction(
    *, email: str, amount_kobo: int, plan_code: str, callback_url: str, reference: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Kicks off the hosted-checkout flow. Returns
    ``{authorization_url, access_code, reference}``.
    """
    payload: Dict[str, Any] = {
        "email": email,
        "amount": amount_kobo,
        "plan": plan_code,
        "callback_url": callback_url,
        "currency": "KES",
    }
    if reference:
        payload["reference"] = reference
    if metadata is not None:
        payload["metadata"] = metadata
    data = await _request("POST", "/transaction/initialize", json=payload)
    return data["data"]


async def verify_transaction(reference: str) -> Dict[str, Any]:
    data = await _request("GET", f"/transaction/verify/{reference}")
    return data["data"]


async def fetch_subscription(code_or_id: str) -> Dict[str, Any]:
    data = await _request("GET", f"/subscription/{code_or_id}")
    return data["data"]


async def disable_subscription(*, code: str, email_token: str) -> Dict[str, Any]:
    payload = {"code": code, "token": email_token}
    data = await _request("POST", "/subscription/disable", json=payload)
    return data


async def enable_subscription(*, code: str, email_token: str) -> Dict[str, Any]:
    """Re-enable a previously-disabled subscription so the buyer can
    resume before the current period ends. Paystack still uses the same
    /disable endpoint pair (enable + disable) so we mirror the shape."""
    payload = {"code": code, "token": email_token}
    data = await _request("POST", "/subscription/enable", json=payload)
    return data


# ---------------------------------------------------------------------------
# Webhook signature verification
# ---------------------------------------------------------------------------


def verify_webhook_signature(raw_body: bytes, signature_header: Optional[str]) -> bool:
    """Constant-time compare the HMAC-SHA512 of the request body against
    the ``x-paystack-signature`` header. Paystack uses the SECRET key
    (not a separate whsec) to sign — we mirror that convention.
    """
    if not signature_header or not PAYSTACK_SECRET_KEY:
        return False
    computed = hmac.new(
        PAYSTACK_SECRET_KEY.encode("utf-8"), raw_body, hashlib.sha512
    ).hexdigest()
    return hmac.compare_digest(computed, signature_header)

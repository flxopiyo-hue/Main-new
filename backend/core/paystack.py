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
from typing import Any, Dict, List, Optional

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
    *, email: str, amount_kobo: int, plan_code: Optional[str] = None, callback_url: str,
    reference: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None,
    channels: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Kicks off the hosted-checkout flow. Returns
    ``{authorization_url, access_code, reference}``.

    ``plan_code`` makes it a subscription transaction (card-only per
    Paystack rules). ``channels`` restricts the payment methods shown
    (e.g. ["mobile_money"] for an M-Pesa-only one-time charge).
    """
    payload: Dict[str, Any] = {
        "email": email,
        "amount": amount_kobo,
        "callback_url": callback_url,
        "currency": "KES",
    }
    if plan_code:
        payload["plan"] = plan_code
    if channels:
        payload["channels"] = channels
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


# ---------------------------------------------------------------------------
# Seller banking — Subaccounts + Transfer Recipients + Transfers
# ---------------------------------------------------------------------------


async def list_banks(country: str = "kenya") -> list[Dict[str, Any]]:
    """Return the list of banks + mobile-money providers Paystack
    supports in the given country. Country param takes English name
    (kenya | ghana | nigeria | south africa | cote d'ivoire).
    """
    # perPage=100 covers all Kenyan institutions (~50) comfortably.
    data = await _request(
        "GET", f"/bank?country={country}&perPage=100"
    )
    return data.get("data") or []


async def resolve_account(*, account_number: str, bank_code: str) -> Dict[str, Any]:
    """Validate an account number against a bank code — returns the
    account holder's name when the pair is valid. Used to pre-verify
    seller bank details before creating the subaccount.
    """
    data = await _request(
        "GET",
        f"/bank/resolve?account_number={account_number}&bank_code={bank_code}",
    )
    return data.get("data") or {}


async def create_subaccount(
    *,
    business_name: str,
    settlement_bank: str,
    account_number: str,
    percentage_charge: float = 0.0,
    primary_contact_email: Optional[str] = None,
    primary_contact_phone: Optional[str] = None,
) -> Dict[str, Any]:
    """Register a seller subaccount on Paystack. Even though we use
    escrow (no split at charge time), we still create a subaccount so
    Paystack has the seller's bank details on file and settlement
    reporting is unified across the platform.

    ``percentage_charge`` is Paystack's per-txn fee they'll auto-deduct
    when Split IS used. We pass 0.0 because we don't split at charge —
    we push manually via Transfer post-delivery.
    """
    payload: Dict[str, Any] = {
        "business_name": business_name,
        "settlement_bank": settlement_bank,
        "account_number": account_number,
        "percentage_charge": percentage_charge,
    }
    if primary_contact_email:
        payload["primary_contact_email"] = primary_contact_email
    if primary_contact_phone:
        payload["primary_contact_phone"] = primary_contact_phone
    data = await _request("POST", "/subaccount", json=payload)
    return data["data"]


async def create_transfer_recipient(
    *,
    type_: str,
    name: str,
    account_number: str,
    bank_code: str,
    currency: str = "KES",
) -> Dict[str, Any]:
    """Register the seller as a Transfer Recipient so we can push funds
    via ``/transfer``. ``type_`` is:
      - ``nuban``  (Nigeria bank)
      - ``ghipss`` (Ghana bank)
      - ``basa``   (SA bank)
      - ``mobile_money`` (M-Pesa, MTN MoMo, etc.)
      - ``authorization`` (recurring card debit — not used here)
      - For Kenya banks use ``basa`` — Paystack maps KE onto the same
        rail as SA for bank transfers.
    """
    payload = {
        "type": type_,
        "name": name,
        "account_number": account_number,
        "bank_code": bank_code,
        "currency": currency,
    }
    data = await _request("POST", "/transferrecipient", json=payload)
    return data["data"]


async def initiate_transfer(
    *,
    amount_kobo: int,
    recipient_code: str,
    reference: str,
    reason: str,
    source: str = "balance",
) -> Dict[str, Any]:
    """Push funds from the platform's Paystack balance to the given
    recipient. Amount is in the currency's minor unit (kobo/pesewas/
    cents). Paystack replies with a ``transfer_code`` we persist for
    later status polling via ``/transfer/verify``.
    """
    payload = {
        "source": source,
        "amount": int(amount_kobo),
        "recipient": recipient_code,
        "reason": reason[:100] if reason else "Oromona seller payout",
        "reference": reference,
    }
    data = await _request("POST", "/transfer", json=payload)
    return data["data"]


async def verify_transfer(reference_or_code: str) -> Dict[str, Any]:
    """Poll the current status of a transfer. Used by the payouts
    dashboard to show ``settled`` after Paystack confirms delivery.
    """
    data = await _request("GET", f"/transfer/verify/{reference_or_code}")
    return data.get("data") or {}


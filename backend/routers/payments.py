"""Item purchase payments via Paystack.

This module handles one-off product purchases (e.g. a buyer buys a
dress) — subscription/Premium payments live in :mod:`routers.subs`.

Both flows use the same Paystack account; the difference is that
subscription checkouts attach a ``plan_code`` (so Paystack manages the
recurring billing) while item purchases are simple one-shot
transactions with a per-item amount.

Historical note: this file used to wrap Stripe Checkout via
``emergentintegrations``. Stripe does not operate in Kenya, so the
whole app has migrated to Paystack. The public API surface below
(``/payments/checkout``, ``/payments/status/{session_id}``,
``/payments/webhook``) is preserved so the mobile client didn't need
to change — ``session_id`` is now simply a Paystack ``reference``.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from core import paystack
from core.config import PLATFORM_FEE_BPS
from core.db import db
from core.security import get_current_user, require_role
from core.seller_verify import maybe_verify_seller
from models import CheckoutIn, CheckoutOut

logger = logging.getLogger("aurafit.payments")
router = APIRouter()


# Paystack supports these currencies. Anything else falls back to KES so
# the buyer still gets a valid checkout — the item's listed currency is
# preserved on the order document for display.
_PAYSTACK_CURRENCIES = {"NGN", "KES", "GHS", "ZAR", "USD"}
# Zero-decimal currencies (already stored in minor units × 100 by the
# startup normalization in server.py). For these, ``price_cents``
# equals the amount in Paystack's minor unit (kobo/pesewas/cents).
_ZERO_DECIMAL = {"KES", "NGN", "UGX", "TZS", "RWF", "INR", "GHS"}


APP_DEEP_LINK_SCHEME = "oromona"


def _public_base_url(request: Request) -> str:
    """Reconstructs the public HTTPS base URL of this backend so we can
    give Paystack a real callback URL. Mirrors the logic in
    :mod:`routers.subs` — kept as a small helper here to avoid a
    circular import.
    """
    env = (os.getenv("PUBLIC_BACKEND_URL") or "").strip()
    if env:
        return env.rstrip("/")
    fwd_host = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
    fwd_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    host = (request.headers.get("host") or "").strip()
    if fwd_host:
        proto = fwd_proto or "https"
        return f"{proto}://{fwd_host}".rstrip("/")
    if host and not host.startswith("localhost") and "cluster" not in host:
        return f"https://{host}".rstrip("/")
    return str(request.base_url).rstrip("/")


def _paystack_return_url(request: Request) -> str:
    base = _public_base_url(request)
    if base.startswith("http://"):
        base = "https://" + base[len("http://"):]
    return f"{base}/api/payments/paystack-return"


def _amount_for_paystack(price_cents: int, currency: str) -> int:
    """Paystack expects the amount in the currency's minor unit
    (kobo/pesewas/cents). Our ``price_cents`` is already stored in
    minor units after the startup normalization in server.py, so we
    just return it verbatim as an int.
    """
    return max(1, int(price_cents))


@router.post("/payments/checkout", response_model=CheckoutOut)
async def create_checkout(
    body: CheckoutIn,
    request: Request,
    user: Dict[str, Any] = Depends(get_current_user),
) -> CheckoutOut:
    """Create a Paystack one-shot checkout for a single item purchase.

    Returns ``session_id`` (Paystack reference) + ``url``
    (authorization_url) — the mobile client opens the URL in a browser,
    Paystack redirects back to :func:`paystack_return` after payment.
    """
    await require_role("buyer", user)
    item = await db.items.find_one({"id": body.item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if not body.address_id:
        raise HTTPException(status_code=400, detail="Delivery address is required")
    addr = await db.addresses.find_one(
        {"id": body.address_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not addr:
        raise HTTPException(status_code=404, detail="Address not found")

    listing_currency = (item.get("currency") or "KES").upper()
    pay_currency = listing_currency if listing_currency in _PAYSTACK_CURRENCIES else "KES"
    amount_minor = _amount_for_paystack(item["price_cents"], pay_currency)

    order_id = str(uuid.uuid4())
    reference = f"oromona_order_{order_id[:8]}_{uuid.uuid4().hex[:8]}"

    metadata = {
        "buyer_id": user["id"],
        "item_id": item["id"],
        "order_id": order_id,
        "size": body.size,
        "color": body.color or "",
        "currency": listing_currency,
        "address_id": body.address_id,
        "purpose": "item_purchase",
    }
    callback_url = _paystack_return_url(request)

    try:
        # Item purchases have no plan_code — this is a one-shot
        # transaction, not a subscription. We call the raw
        # /transaction/initialize endpoint via a small local helper so
        # we don't have to widen the paystack module surface.
        data = await _initialize_oneoff_transaction(
            email=user["email"],
            amount=amount_minor,
            currency=pay_currency,
            reference=reference,
            callback_url=callback_url,
            metadata=metadata,
        )
    except paystack.PaystackError as e:
        logger.exception("paystack checkout error")
        raise HTTPException(status_code=502, detail=f"Paystack error: {e}") from e

    now = datetime.now(timezone.utc)
    platform_fee_cents = (item["price_cents"] * PLATFORM_FEE_BPS) // 10000
    seller_net_cents = item["price_cents"] - platform_fee_cents
    shipping_snapshot = {
        k: addr.get(k)
        for k in (
            "label",
            "custom_label",
            "recipient_name",
            "phone",
            "alt_phone",
            "building_estate",
            "house_number",
            "street",
            "area",
            "city",
            "postal_code",
            "country",
            "delivery_notes",
        )
    }
    await db.orders.insert_one(
        {
            "id": order_id,
            "buyer_id": user["id"],
            "seller_id": item["seller_id"],
            "item_id": item["id"],
            "item_name": item["name"],
            "size": body.size,
            "color": body.color,
            "amount_cents": item["price_cents"],
            "currency": listing_currency,
            "paystack_currency": pay_currency,
            "cents_normalized": True,
            "platform_fee_cents": platform_fee_cents,
            "seller_net_cents": seller_net_cents,
            "status": "pending",
            "session_id": reference,  # kept as ``session_id`` for API-compat
            "paystack_reference": reference,
            "address_id": body.address_id,
            "shipping_address": shipping_snapshot,
            "created_at": now,
        }
    )
    return CheckoutOut(session_id=reference, url=data["authorization_url"])


async def _initialize_oneoff_transaction(
    *,
    email: str,
    amount: int,
    currency: str,
    reference: str,
    callback_url: str,
    metadata: Dict[str, Any],
) -> Dict[str, Any]:
    """Raw ``POST /transaction/initialize`` without a plan_code (that's
    the difference from the subscription flow in :mod:`routers.subs`).
    Kept private to this module.
    """
    # We deliberately reach into paystack._request rather than adding
    # another public helper — this keeps the paystack module's surface
    # tight (subscription-only) and lets item-purchase quirks live here.
    payload: Dict[str, Any] = {
        "email": email,
        "amount": int(amount),
        "reference": reference,
        "callback_url": callback_url,
        "currency": currency,
        "metadata": metadata,
        # Restrict to card + mobile_money so the checkout only shows
        # rails that actually work for Kenyan buyers. Paystack falls
        # back to whatever the account has enabled if this is empty.
        "channels": ["card", "mobile_money", "bank"],
    }
    data = await paystack._request("POST", "/transaction/initialize", json=payload)  # type: ignore[attr-defined]
    return data["data"]


@router.get("/payments/status/{session_id}")
async def payment_status(
    session_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    """Polled by the ``/checkout/result`` screen after the WebBrowser
    session closes. If we still show ``pending`` locally we ask
    Paystack for the authoritative state and update the order.
    """
    order = await db.orders.find_one(
        {"session_id": session_id, "buyer_id": user["id"]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order["status"] == "pending":
        try:
            data = await paystack.verify_transaction(session_id)
            new_status = order["status"]
            pstatus = data.get("status")
            if pstatus == "success":
                new_status = "paid"
            elif pstatus in {"failed", "abandoned", "reversed"}:
                new_status = "cancelled" if pstatus == "abandoned" else "failed"
            if new_status != order["status"]:
                await db.orders.update_one(
                    {"session_id": session_id},
                    {"$set": {"status": new_status, "paystack_status": pstatus}},
                )
                order["status"] = new_status
                if new_status == "paid":
                    await maybe_verify_seller(order["seller_id"])
        except paystack.PaystackError as e:
            logger.warning("Paystack status fetch failed: %s", e)

    return {
        "session_id": session_id,
        "status": order["status"],
        "item_name": order["item_name"],
        "amount_cents": order["amount_cents"],
        "currency": order.get("currency", "KES"),
    }


@router.get("/payments/paystack-return", response_class=HTMLResponse)
async def paystack_return(reference: str = "") -> HTMLResponse:
    """Bridge hit by Paystack after an item-purchase checkout. Verifies
    the transaction, flips the matching order to ``paid`` (or
    ``failed``/``cancelled``), then renders a branded HTML page that
    deep-links back into the Oromona mobile app via
    ``oromona://checkout/result?session_id=…``.
    """
    if not reference:
        return HTMLResponse(_status_html(ok=False, headline="Missing reference", body="No payment reference was provided in the redirect. If money was deducted, please contact support.", ref="—", session_id=""), status_code=400)

    try:
        data = await paystack.verify_transaction(reference)
    except paystack.PaystackError as e:
        logger.warning("payments/paystack-return verify failed for %s: %s", reference, e)
        return HTMLResponse(_status_html(ok=False, headline="Verification failed", body="We couldn't confirm your payment with Paystack right now. If money was deducted, our team will reconcile it.", ref=reference, session_id=reference), status_code=502)

    pstatus = data.get("status")
    ok = pstatus == "success"
    order_status = "paid" if ok else ("cancelled" if pstatus == "abandoned" else "failed")

    order = await db.orders.find_one({"session_id": reference}, {"_id": 0})
    if order:
        await db.orders.update_one(
            {"id": order["id"]},
            {"$set": {"status": order_status, "paystack_status": pstatus}},
        )
        if ok and order.get("seller_id"):
            await maybe_verify_seller(order["seller_id"])

    if ok:
        body_txt = "Your order is confirmed. Returning you to the Oromona app…"
        headline = "Payment successful"
    elif pstatus == "abandoned":
        body_txt = "You cancelled the payment. No charge was made."
        headline = "Payment cancelled"
    else:
        body_txt = f"Paystack reports the transaction as '{pstatus or 'unknown'}'. No charge was captured."
        headline = "Payment failed"

    return HTMLResponse(_status_html(ok=ok, headline=headline, body=body_txt, ref=reference, session_id=reference))


@router.post("/payments/webhook")
async def payments_webhook(request: Request) -> Dict[str, Any]:
    """Dedicated webhook for item-purchase events. Paystack lets you
    configure ONE webhook URL globally — we route both subscription
    and item events through :mod:`routers.subs.webhook`, but this
    endpoint stays available for tests / manual retries and simply
    verifies + processes item-purchase events (charge.success).
    """
    raw = await request.body()
    sig = request.headers.get("x-paystack-signature")
    if not paystack.verify_webhook_signature(raw, sig):
        raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    event = payload.get("event") or ""
    data = payload.get("data") or {}
    reference = data.get("reference")
    if not reference:
        return {"received": True, "skipped": "no reference"}

    if event == "charge.success":
        order = await db.orders.find_one({"session_id": reference}, {"_id": 0})
        if order and order.get("status") != "paid":
            await db.orders.update_one(
                {"id": order["id"]}, {"$set": {"status": "paid", "paystack_status": "success"}}
            )
            if order.get("seller_id"):
                await maybe_verify_seller(order["seller_id"])
    elif event in {"charge.failed"}:
        await db.orders.update_one(
            {"session_id": reference}, {"$set": {"status": "failed", "paystack_status": event}}
        )

    return {"received": True}


# ---------------------------------------------------------------------------
# Small HTML renderer for the redirect bridge — mirrors the styling in
# subs.paystack_return so both flows feel like the same product.
# ---------------------------------------------------------------------------


def _status_html(*, ok: bool, headline: str, body: str, ref: str, session_id: str) -> str:
    deep = f"{APP_DEEP_LINK_SCHEME}://checkout/result?session_id={session_id}" if session_id else f"{APP_DEEP_LINK_SCHEME}://checkout/result"
    color = "#111827" if ok else "#B91C1C"
    accent = "#7C3AED" if ok else "#B91C1C"
    icon = "✓" if ok else "✕"
    return f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />
  <title>Oromona — {headline}</title>
  <style>
    :root {{ color-scheme: light; }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; min-height: 100vh;
      background: linear-gradient(180deg, #FAF7F2 0%, #F1EBE1 100%);
      color: {color};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      display: flex; align-items: center; justify-content: center; padding: 24px;
    }}
    .card {{
      max-width: 460px; width: 100%;
      background: #fff; border-radius: 24px;
      box-shadow: 0 12px 40px rgba(17, 24, 39, 0.08);
      padding: 40px 28px 28px; text-align: center;
    }}
    .badge {{
      width: 72px; height: 72px; border-radius: 36px;
      background: {accent}; color: #fff; margin: 0 auto 20px;
      display: flex; align-items: center; justify-content: center;
      font-size: 36px; font-weight: 700;
    }}
    h1 {{ margin: 0 0 12px; font-size: 22px; font-weight: 700; }}
    p {{ margin: 0 0 20px; color: #4B5563; font-size: 15px; line-height: 1.5; }}
    .ref {{ font-family: 'SF Mono', Menlo, monospace; font-size: 12px; color: #9CA3AF; word-break: break-all; }}
    .btn {{
      display: inline-block; margin-top: 20px; padding: 14px 24px;
      background: {accent}; color: #fff; text-decoration: none;
      border-radius: 14px; font-weight: 600; font-size: 15px;
    }}
    .foot {{ margin-top: 24px; font-size: 12px; color: #9CA3AF; }}
  </style>
  <script>
    (function() {{
      try {{ window.location.replace({deep!r}); }} catch (e) {{ /* no-op */ }}
    }})();
  </script>
</head>
<body>
  <div class=\"card\">
    <div class=\"badge\">{icon}</div>
    <h1>{headline}</h1>
    <p>{body}</p>
    <p class=\"ref\">Reference: {ref}</p>
    <a class=\"btn\" href=\"{deep}\">Open Oromona app</a>
    <div class=\"foot\">You can safely close this window.</div>
  </div>
</body>
</html>"""

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
from models import CheckoutIn, CheckoutOut, LookCheckoutIn

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


def _shipping_snapshot(addr: Dict[str, Any]) -> Dict[str, Any]:
    return {
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

    # Resolve the (size, color) → variant so we can honour any per-
    # variant price override and store variant_id on the order for
    # accurate stock-decrementing later.
    from core.variants import find_variant_by_size_color, variant_lookup

    variant: Optional[Dict[str, Any]] = None
    if body.variant_id:
        variant = variant_lookup(item, body.variant_id)
    if not variant:
        variant = find_variant_by_size_color(item, body.size, body.color)
    if variant and variant.get("disabled"):
        raise HTTPException(status_code=409, detail="This variant is unavailable")
    if variant and int(variant.get("quantity") or 0) <= 0:
        raise HTTPException(status_code=409, detail="Out of stock")

    # Price precedence: variant override → item price.
    charged_price_cents = int(
        (variant or {}).get("price_cents_override") or item["price_cents"]
    )

    # ------------------------------------------------------------------
    # Courier fee — zone-based from Nairobi CBD. Door delivery is the
    # only option (no in-store/CBD pickup). Only applies to KES charges
    # (cross-currency fee conversion isn't supported). Fee is waived
    # above the free-delivery threshold (platform absorbs the rider's
    # cut in that case).
    from core import delivery as dlv

    delivery_option = "door"
    delivery_fee_cents = 0
    delivery_zone_key: Optional[str] = None
    delivery_zone_label: Optional[str] = None
    if pay_currency == "KES":
        q = await dlv.quote_for_address(addr, charged_price_cents)
        delivery_fee_cents = int(q["fee_due_cents"])
        delivery_zone_key = q["zone_key"]
        delivery_zone_label = q["zone_label"]

    amount_minor = _amount_for_paystack(
        charged_price_cents + delivery_fee_cents, pay_currency
    )

    order_id = str(uuid.uuid4())
    reference = f"oromona_order_{order_id[:8]}_{uuid.uuid4().hex[:8]}"

    metadata = {
        "buyer_id": user["id"],
        "item_id": item["id"],
        "order_id": order_id,
        "size": body.size,
        "color": body.color or "",
        "variant_id": (variant or {}).get("id") or "",
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
    platform_fee_cents = (charged_price_cents * PLATFORM_FEE_BPS) // 10000
    seller_net_cents = charged_price_cents - platform_fee_cents
    shipping_snapshot = _shipping_snapshot(addr)
    await db.orders.insert_one(
        {
            "id": order_id,
            "buyer_id": user["id"],
            "seller_id": item["seller_id"],
            "item_id": item["id"],
            "item_name": item["name"],
            "size": body.size,
            "color": body.color,
            "variant_id": (variant or {}).get("id"),
            "amount_cents": charged_price_cents,
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
            # Courier delivery (Phase 1) — fee the buyer paid on top of
            # the item price. amount_cents stays item-only so platform
            # fee / seller net semantics are unchanged.
            "delivery_option": delivery_option,
            "delivery_fee_cents": delivery_fee_cents,
            "delivery_zone_key": delivery_zone_key,
            "delivery_zone_label": delivery_zone_label,
            "total_charged_cents": charged_price_cents + delivery_fee_cents,
            "created_at": now,
        }
    )
    return CheckoutOut(session_id=reference, url=data["authorization_url"])


@router.post("/payments/checkout-look")
async def create_look_checkout(
    body: LookCheckoutIn,
    request: Request,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """AI-Stylist "Shop the look" — ONE Paystack charge for a whole outfit.

    Creates one pending order per piece, all sharing the same Paystack
    ``reference`` (session_id). Reconciliation (status poll / return
    bridge / webhook) flips every order together; from then on each order
    flows through the normal seller → rider → escrow lifecycle.

    Delivery: one parcel per seller. Each parcel's zone fee is computed
    from the buyer's address (waived per parcel above the free-delivery
    threshold) and the buyer is shown ONE summed delivery amount.
    """
    await require_role("buyer", user)
    if not body.address_id:
        raise HTTPException(status_code=400, detail="Delivery address is required")
    addr = await db.addresses.find_one(
        {"id": body.address_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not addr:
        raise HTTPException(status_code=404, detail="Address not found")

    from core import delivery as dlv
    from core.variants import find_variant_by_size_color

    lines: list[Dict[str, Any]] = []
    pay_currency: Optional[str] = None
    for ln in body.lines:
        item = await db.items.find_one({"id": ln.item_id}, {"_id": 0})
        if not item:
            raise HTTPException(status_code=404, detail=f"Item not found: {ln.item_id}")
        listing_currency = (item.get("currency") or "KES").upper()
        pcur = listing_currency if listing_currency in _PAYSTACK_CURRENCIES else "KES"
        if pay_currency is None:
            pay_currency = pcur
        elif pay_currency != pcur:
            raise HTTPException(
                status_code=400,
                detail="All pieces in a look must be priced in the same currency",
            )
        variant = find_variant_by_size_color(item, ln.size, ln.color)
        if variant and variant.get("disabled"):
            raise HTTPException(
                status_code=409, detail=f"'{item['name']}' is unavailable in size {ln.size}"
            )
        if variant and int(variant.get("quantity") or 0) <= 0:
            raise HTTPException(
                status_code=409, detail=f"'{item['name']}' is out of stock in size {ln.size}"
            )
        lines.append(
            {
                "item": item,
                "size": ln.size,
                "color": ln.color,
                "variant": variant,
                "listing_currency": listing_currency,
                "price": int((variant or {}).get("price_cents_override") or item["price_cents"]),
            }
        )

    # One parcel per seller → per-parcel zone fee, shown to the buyer as
    # a single summed delivery line.
    groups: Dict[str, list] = {}
    for l in lines:
        groups.setdefault(l["item"]["seller_id"], []).append(l)
    group_fee: Dict[str, int] = {}
    delivery_fee_total = 0
    zone_key: Optional[str] = None
    zone_label: Optional[str] = None
    if pay_currency == "KES":
        for sid, gls in groups.items():
            q = await dlv.quote_for_address(addr, sum(g["price"] for g in gls))
            group_fee[sid] = int(q["fee_due_cents"])
            delivery_fee_total += group_fee[sid]
            zone_key, zone_label = q["zone_key"], q["zone_label"]

    items_total = sum(l["price"] for l in lines)
    amount_minor = _amount_for_paystack(items_total + delivery_fee_total, pay_currency)

    look_id = str(uuid.uuid4())
    # Prefix keeps the "oromona_order_" convention so every existing
    # reconciliation path (return bridge, webhooks, status poll) fires.
    reference = f"oromona_order_look_{look_id[:8]}_{uuid.uuid4().hex[:8]}"
    metadata = {
        "buyer_id": user["id"],
        "purpose": "look_purchase",
        "look_id": look_id,
        "item_ids": [l["item"]["id"] for l in lines],
        "address_id": body.address_id,
    }
    try:
        data = await _initialize_oneoff_transaction(
            email=user["email"],
            amount=amount_minor,
            currency=pay_currency,
            reference=reference,
            callback_url=_paystack_return_url(request),
            metadata=metadata,
        )
    except paystack.PaystackError as e:
        logger.exception("paystack look checkout error")
        raise HTTPException(status_code=502, detail=f"Paystack error: {e}") from e

    now = datetime.now(timezone.utc)
    shipping_snapshot = _shipping_snapshot(addr)
    fee_assigned: set = set()
    docs = []
    for l in lines:
        item = l["item"]
        sid = item["seller_id"]
        fee = 0
        if sid not in fee_assigned:
            fee = group_fee.get(sid, 0)
            fee_assigned.add(sid)
        platform_fee_cents = (l["price"] * PLATFORM_FEE_BPS) // 10000
        docs.append(
            {
                "id": str(uuid.uuid4()),
                "look_id": look_id,
                "buyer_id": user["id"],
                "seller_id": sid,
                "item_id": item["id"],
                "item_name": item["name"],
                "size": l["size"],
                "color": l["color"],
                "variant_id": (l["variant"] or {}).get("id"),
                "amount_cents": l["price"],
                "currency": l["listing_currency"],
                "paystack_currency": pay_currency,
                "cents_normalized": True,
                "platform_fee_cents": platform_fee_cents,
                "seller_net_cents": l["price"] - platform_fee_cents,
                "status": "pending",
                "session_id": reference,
                "paystack_reference": reference,
                "address_id": body.address_id,
                "shipping_address": shipping_snapshot,
                "delivery_option": "door",
                "delivery_fee_cents": fee,
                "delivery_zone_key": zone_key,
                "delivery_zone_label": zone_label,
                "total_charged_cents": l["price"] + fee,
                "created_at": now,
            }
        )
    await db.orders.insert_many(docs)
    return {
        "session_id": reference,
        "url": data["authorization_url"],
        "look_id": look_id,
        "items_total_cents": items_total,
        "delivery_fee_cents": delivery_fee_total,
        "total_cents": items_total + delivery_fee_total,
        "currency": pay_currency,
        "parcel_count": len(groups),
    }


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

    Look purchases share one reference across several orders — the poll
    flips ALL of them together and reports combined totals.
    """
    orders = await db.orders.find(
        {"session_id": session_id, "buyer_id": user["id"]}, {"_id": 0}
    ).to_list(20)
    if not orders:
        raise HTTPException(status_code=404, detail="Order not found")

    if any(o["status"] == "pending" for o in orders):
        try:
            data = await paystack.verify_transaction(session_id)
            pstatus = data.get("status")
            new_status: Optional[str] = None
            if pstatus == "success":
                new_status = "paid"
            elif pstatus in {"failed", "abandoned", "reversed"}:
                new_status = "cancelled" if pstatus == "abandoned" else "failed"
            if new_status:
                for o in orders:
                    if o["status"] != new_status:
                        await db.orders.update_one(
                            {"id": o["id"]},
                            {"$set": {"status": new_status, "paystack_status": pstatus}},
                        )
                        o["status"] = new_status
                        if new_status == "paid":
                            await maybe_verify_seller(o["seller_id"])
        except paystack.PaystackError as e:
            logger.warning("Paystack status fetch failed: %s", e)

    first = orders[0]
    name = first["item_name"]
    if len(orders) > 1:
        name = f"{name} + {len(orders) - 1} more"
    return {
        "session_id": session_id,
        "status": first["status"],
        "item_name": name,
        "amount_cents": sum(
            int(o.get("total_charged_cents") or o["amount_cents"]) for o in orders
        ),
        "currency": first.get("currency", "KES"),
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

    # A look purchase shares one reference across several orders — flip
    # them all together.
    orders = await db.orders.find({"session_id": reference}, {"_id": 0}).to_list(20)
    for order in orders:
        was_paid_already = order.get("status") == "paid"
        await db.orders.update_one(
            {"id": order["id"]},
            {"$set": {"status": order_status, "paystack_status": pstatus}},
        )
        if ok and not was_paid_already:
            order["status"] = "paid"
            await _on_order_paid(order)

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
        orders = await db.orders.find({"session_id": reference}, {"_id": 0}).to_list(20)
        for order in orders:
            if order.get("status") != "paid":
                await db.orders.update_one(
                    {"id": order["id"]}, {"$set": {"status": "paid", "paystack_status": "success"}}
                )
                order["status"] = "paid"
                await _on_order_paid(order)
    elif event in {"charge.failed"}:
        await db.orders.update_many(
            {"session_id": reference}, {"$set": {"status": "failed", "paystack_status": event}}
        )

    return {"received": True}


async def _decrement_variant_stock(order: Dict[str, Any]) -> None:
    """Reduce the purchased variant's ``quantity`` by 1.

    Silent-fails when the variant can't be resolved (older orders may
    not carry variant_id) — Paystack has already been paid, so we don't
    want to explode; the seller can reconcile from the analytics
    dashboard if inventory looks off.
    """
    variant_id = order.get("variant_id")
    item_id = order.get("item_id")
    if not item_id:
        return
    try:
        if variant_id:
            # Positional array update decrement.
            await db.items.update_one(
                {"id": item_id, "variants.id": variant_id, "variants.quantity": {"$gt": 0}},
                {"$inc": {"variants.$.quantity": -1}},
            )
        else:
            # Legacy fallback — decrement the sizes row for the size label.
            size_label = order.get("size")
            if size_label:
                await db.items.update_one(
                    {"id": item_id, "sizes.label": size_label, "sizes.available_qty": {"$gt": 0}},
                    {"$inc": {"sizes.$.available_qty": -1}},
                )
    except Exception as e:  # pragma: no cover
        logger.warning("stock decrement skipped for order %s: %s", order.get("id"), e)


async def _on_order_paid(order: Dict[str, Any]) -> None:
    """Side effects when an order first flips to ``paid``:
      * decrement the purchased variant's stock
      * create the escrow payout record (status=held) so seller
        payouts are tracked from the moment money lands
      * seller auto-verify (5+ paid orders → verified badge)
    """
    await _decrement_variant_stock(order)
    try:
        from core import escrow as escrow_mod
        await escrow_mod.create_payout_record(order)
    except Exception as e:  # pragma: no cover
        logger.warning("payout create skipped for order %s: %s", order.get("id"), e)
    if order.get("seller_id"):
        try:
            await maybe_verify_seller(order["seller_id"])
        except Exception as e:  # pragma: no cover
            logger.warning("seller verify skipped for %s: %s", order["seller_id"], e)


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

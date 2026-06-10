"""Stripe Checkout integration + webhook + payment status polling."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from emergentintegrations.payments.stripe.checkout import (
    CheckoutSessionRequest,
    StripeCheckout,
)
from fastapi import APIRouter, Depends, HTTPException, Request

from core.config import PLATFORM_FEE_BPS, STRIPE_API_KEY
from core.db import db
from core.security import get_current_user, require_role
from models import CheckoutIn, CheckoutOut

logger = logging.getLogger("aurafit.payments")
router = APIRouter()


def _stripe_client(webhook_url: Optional[str] = None) -> StripeCheckout:
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    return StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)


@router.post("/payments/checkout", response_model=CheckoutOut)
async def create_checkout(
    body: CheckoutIn, user: Dict[str, Any] = Depends(get_current_user)
) -> CheckoutOut:
    await require_role("buyer", user)
    item = await db.items.find_one({"id": body.item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Resolve delivery address — must belong to the buyer.
    if not body.address_id:
        raise HTTPException(
            status_code=400, detail="Delivery address is required"
        )
    addr = await db.addresses.find_one(
        {"id": body.address_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not addr:
        raise HTTPException(status_code=404, detail="Address not found")

    amount_dollars = item["price_cents"] / 100.0
    # Use the item's listing currency for Stripe (defaults to USD for legacy items).
    listing_currency = (item.get("currency") or "USD").lower()
    origin = body.origin_url.rstrip("/")
    success_url = f"{origin}/checkout/result?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/checkout/result?session_id={{CHECKOUT_SESSION_ID}}&cancelled=1"

    stripe = _stripe_client()
    req = CheckoutSessionRequest(
        amount=amount_dollars,
        currency=listing_currency,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "buyer_id": user["id"],
            "item_id": item["id"],
            "size": body.size,
            "color": body.color or "",
            "currency": listing_currency,
            "address_id": body.address_id,
        },
    )
    try:
        session = await stripe.create_checkout_session(req)
    except Exception as e:
        logger.exception("Stripe checkout error")
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")

    order_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    platform_fee_cents = (item["price_cents"] * PLATFORM_FEE_BPS) // 10000
    seller_net_cents = item["price_cents"] - platform_fee_cents
    # Snapshot the address onto the order so future address edits/deletes don't
    # break shipping history.
    shipping_snapshot = {k: addr.get(k) for k in (
        "label", "custom_label", "recipient_name", "phone", "alt_phone",
        "building_estate", "house_number", "street", "area", "city",
        "postal_code", "country", "delivery_notes",
    )}
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
            "currency": item.get("currency", "USD"),
            "platform_fee_cents": platform_fee_cents,
            "seller_net_cents": seller_net_cents,
            "status": "pending",
            "session_id": session.session_id,
            "address_id": body.address_id,
            "shipping_address": shipping_snapshot,
            "created_at": now,
        }
    )
    return CheckoutOut(session_id=session.session_id, url=session.url)


@router.get("/payments/status/{session_id}")
async def payment_status(
    session_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    order = await db.orders.find_one(
        {"session_id": session_id, "buyer_id": user["id"]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Refresh from Stripe if still pending
    if order["status"] == "pending":
        try:
            stripe = _stripe_client()
            s = await stripe.get_checkout_status(session_id)
            new_status = order["status"]
            if s.payment_status == "paid":
                new_status = "paid"
            elif s.status == "expired":
                new_status = "cancelled"
            if new_status != order["status"]:
                await db.orders.update_one(
                    {"session_id": session_id},
                    {"$set": {"status": new_status}},
                )
                order["status"] = new_status
        except Exception as e:
            logger.warning("Stripe status fetch failed: %s", e)

    return {
        "session_id": session_id,
        "status": order["status"],
        "item_name": order["item_name"],
        "amount_cents": order["amount_cents"],
        "currency": order.get("currency", "USD"),
    }


@router.post("/payments/webhook")
async def stripe_webhook(request: Request) -> Dict[str, Any]:
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    try:
        stripe = _stripe_client(webhook_url=str(request.url))
        event = await stripe.handle_webhook(payload, sig)
    except Exception as e:
        logger.warning("Webhook error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))

    # Best-effort update
    try:
        event_dict = event.model_dump() if hasattr(event, "model_dump") else dict(event)
        session_id = (
            event_dict.get("session_id")
            or event_dict.get("data", {}).get("object", {}).get("id")
        )
        payment_status_val = event_dict.get("payment_status") or "paid"
        if session_id and payment_status_val == "paid":
            await db.orders.update_one(
                {"session_id": session_id}, {"$set": {"status": "paid"}}
            )
    except Exception as e:
        logger.warning("Webhook handling failed: %s", e)

    return {"received": True}

"""Escrow / payout engine.

Design (matches the buyer-confirmed hybrid model chosen for Oromona):

  order.paid       → payout.status = held
  order.shipped    → payout.status = held (unchanged)
  order.delivered  → payout.status = held, escrow_release_at = now + 48h
  order.confirmed  → payout.status = released → transfer initiated
  timer_reached    → payout.status = released → transfer initiated
  dispute raised   → payout.status = disputed (frozen; admin only can resolve)
  refund           → payout.status = cancelled (money already refunded to buyer)

Once ``released``, we call Paystack Transfer API to move funds from
the platform balance to the seller's registered Transfer Recipient.
The webhook (or a periodic poll) later flips the payout to ``settled``.

Everything here is idempotent — calling ``release_payout(order_id)``
twice is a no-op if the payout is already released/settled.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from core import paystack
from core.config import PLATFORM_FEE_BPS
from core.db import db

logger = logging.getLogger("aurafit.escrow")

ESCROW_HOLD_HOURS = 48  # buyer confirmation window after delivery


async def create_payout_record(order: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Create the escrow payout row when an order is first marked paid.
    Idempotent — a duplicate call finds the existing row and returns it.
    """
    existing = await db.payouts.find_one({"order_id": order["id"]}, {"_id": 0})
    if existing:
        return existing
    price = int(order.get("amount_cents") or 0)
    fee = (price * PLATFORM_FEE_BPS) // 10000
    seller_net = price - fee
    doc = {
        "id": str(uuid.uuid4()),
        "order_id": order["id"],
        "seller_id": order.get("seller_id"),
        "buyer_id": order.get("buyer_id"),
        "gross_cents": price,
        "platform_fee_cents": fee,
        "amount_cents": seller_net,
        "currency": order.get("currency", "KES"),
        "paystack_currency": order.get("paystack_currency", "KES"),
        "status": "held",
        "created_at": datetime.now(timezone.utc),
        "released_at": None,
        "settled_at": None,
        "paystack_transfer_code": None,
        "failure_reason": None,
    }
    await db.payouts.insert_one(doc)
    await db.orders.update_one(
        {"id": order["id"]},
        {"$set": {"payout_id": doc["id"], "escrow_status": "held"}},
    )
    return doc


async def start_delivery_window(order_id: str) -> Dict[str, Any]:
    """Called when an order is marked ``delivered`` — stamps the 48h
    buyer-confirmation deadline on the order. Buyers can confirm or
    dispute before the timer fires; if they do neither, the periodic
    ``release_due_payouts`` sweep fires the transfer.
    """
    now = datetime.now(timezone.utc)
    release_at = now + timedelta(hours=ESCROW_HOLD_HOURS)
    await db.orders.update_one(
        {"id": order_id},
        {
            "$set": {
                "delivered_at": now,
                "escrow_release_at": release_at,
                "status": "delivered",
                # ``escrow_status`` stays "held" — the transfer only
                # fires when the buyer confirms OR the timer sweeps.
            }
        },
    )
    return {"delivered_at": now, "escrow_release_at": release_at}


async def confirm_delivery_by_buyer(order_id: str, buyer_id: str) -> Dict[str, Any]:
    """Buyer explicitly confirmed receipt — release immediately."""
    order = await db.orders.find_one({"id": order_id, "buyer_id": buyer_id}, {"_id": 0})
    if not order:
        return {"ok": False, "reason": "not_found"}
    if order.get("dispute_raised_at"):
        return {"ok": False, "reason": "disputed"}
    if order.get("buyer_confirmed_at"):
        return {"ok": True, "already": True}
    now = datetime.now(timezone.utc)
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"buyer_confirmed_at": now, "escrow_release_at": now}},
    )
    result = await release_payout(order_id)
    return {"ok": True, "release": result}


async def raise_dispute(order_id: str, buyer_id: str, reason: str) -> Dict[str, Any]:
    """Buyer reports a problem within the 48h window. Freezes the
    payout in ``disputed`` state — admin resolution unfreezes.
    """
    order = await db.orders.find_one({"id": order_id, "buyer_id": buyer_id}, {"_id": 0})
    if not order:
        return {"ok": False, "reason": "not_found"}
    if order.get("buyer_confirmed_at"):
        return {"ok": False, "reason": "already_confirmed"}
    now = datetime.now(timezone.utc)
    await db.orders.update_one(
        {"id": order_id},
        {
            "$set": {
                "dispute_raised_at": now,
                "dispute_reason": reason.strip(),
                "escrow_status": "disputed",
            }
        },
    )
    if order.get("payout_id"):
        await db.payouts.update_one(
            {"id": order["payout_id"]},
            {"$set": {"status": "disputed", "failure_reason": None}},
        )
    return {"ok": True}


async def release_payout(order_id: str) -> Dict[str, Any]:
    """Move a held payout to released + initiate Paystack Transfer.
    Idempotent — safe to call multiple times.
    """
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return {"ok": False, "reason": "order_not_found"}
    payout_id = order.get("payout_id")
    if not payout_id:
        # Legacy order without a payout row — synthesise one so the
        # release path is uniform.
        p = await create_payout_record(order)
        payout_id = p["id"] if p else None
    if not payout_id:
        return {"ok": False, "reason": "no_payout"}
    payout = await db.payouts.find_one({"id": payout_id}, {"_id": 0})
    if not payout:
        return {"ok": False, "reason": "payout_missing"}
    if payout["status"] in {"released", "settled"}:
        return {"ok": True, "already": True}
    if payout["status"] == "disputed":
        return {"ok": False, "reason": "disputed"}
    if payout["status"] == "cancelled":
        return {"ok": False, "reason": "cancelled"}

    seller = await db.users.find_one({"id": payout["seller_id"]}, {"_id": 0})
    recipient = (seller or {}).get("paystack_recipient_code")
    now = datetime.now(timezone.utc)

    # Mark released immediately so a subsequent call is a no-op even if
    # the transfer API fails mid-flight (idempotency).
    await db.payouts.update_one(
        {"id": payout_id},
        {"$set": {"status": "released", "released_at": now}},
    )
    await db.orders.update_one(
        {"id": order_id}, {"$set": {"escrow_status": "released"}}
    )

    if not recipient:
        # Seller hasn't set up their payout account yet — log the shortfall
        # so admin can nudge/settle manually. Not a hard error to the buyer.
        await db.payouts.update_one(
            {"id": payout_id},
            {"$set": {"failure_reason": "seller_no_recipient"}},
        )
        return {"ok": True, "transfer": None, "reason": "seller_no_recipient"}

    # Fire the Paystack Transfer.
    try:
        transfer = await paystack.initiate_transfer(
            amount_kobo=int(payout["amount_cents"]),
            recipient_code=recipient,
            reference=f"payout_{payout_id[:8]}_{uuid.uuid4().hex[:8]}",
            reason=f"Oromona order {order_id[:8]}",
        )
        await db.payouts.update_one(
            {"id": payout_id},
            {
                "$set": {
                    "paystack_transfer_code": transfer.get("transfer_code")
                    or transfer.get("reference"),
                    "failure_reason": None,
                }
            },
        )
        return {"ok": True, "transfer": transfer}
    except paystack.PaystackError as e:
        # Persistent failure — leave in released state so a manual retry
        # picks it up. Admin dashboard shows the failure_reason.
        await db.payouts.update_one(
            {"id": payout_id},
            {"$set": {"failure_reason": str(e)}},
        )
        logger.warning("payout transfer failed for order %s: %s", order_id, e)
        return {"ok": False, "reason": "transfer_failed", "error": str(e)}


async def cancel_payout(order_id: str, reason: str) -> None:
    """Move a payout to ``cancelled`` (used on refund path)."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order or not order.get("payout_id"):
        return
    await db.payouts.update_one(
        {"id": order["payout_id"]},
        {"$set": {"status": "cancelled", "failure_reason": reason}},
    )
    await db.orders.update_one(
        {"id": order_id}, {"$set": {"escrow_status": "cancelled"}}
    )


async def release_due_payouts() -> int:
    """Periodic sweep — release any payouts whose 48h buyer-confirmation
    window has elapsed without a dispute or confirmation. Called by the
    background scheduler in ``server.py``.
    """
    now = datetime.now(timezone.utc)
    cursor = db.orders.find(
        {
            "status": "delivered",
            "escrow_release_at": {"$lte": now},
            "escrow_status": "held",
            "dispute_raised_at": {"$exists": False},
            "buyer_confirmed_at": {"$exists": False},
        },
        {"_id": 0, "id": 1},
    )
    count = 0
    async for o in cursor:
        try:
            r = await release_payout(o["id"])
            if r.get("ok"):
                count += 1
        except Exception as e:  # pragma: no cover
            logger.warning("release_due_payouts skipped %s: %s", o["id"], e)
    if count:
        logger.info("release_due_payouts released %d payouts", count)
    return count

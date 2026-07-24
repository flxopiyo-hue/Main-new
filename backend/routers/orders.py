"""Buyer order history + order detail + fit feedback submission +
tracking flow (nudge seller, confirm delivery, report a problem)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from core import escrow as escrow_mod
from core.carriers import enrich_order_with_carrier
from core.config import PLATFORM_FEE_BPS
from core.db import db
from core.security import get_current_user
from models import (
    FitFeedbackIn,
    OrderDetailOut,
    OrderOut,
    OrderSellerOut,
    ReportProblemIn,
)

router = APIRouter()

# How often a buyer can nudge the seller from the order detail screen.
NUDGE_COOLDOWN_HOURS = 24


def _order_doc_to_out(d: Dict[str, Any]) -> OrderOut:
    d = enrich_order_with_carrier(d)  # auto-detect carrier if missing
    return OrderOut(
        id=d["id"],
        buyer_id=d["buyer_id"],
        item_id=d["item_id"],
        item_name=d["item_name"],
        size=d["size"],
        color=d.get("color"),
        amount_cents=d["amount_cents"],
        currency=d.get("currency", "USD"),
        status=d["status"],
        fit_feedback=d.get("fit_feedback"),
        session_id=d["session_id"],
        created_at=d["created_at"],
        tracking_number=d.get("tracking_number"),
        tracking_url=d.get("tracking_url"),
        carrier=d.get("carrier"),
        shipped_at=d.get("shipped_at"),
        estimated_delivery_days=d.get("estimated_delivery_days"),
        estimated_delivery_at=d.get("estimated_delivery_at"),
        delivered_at=d.get("delivered_at"),
        fulfillment_note=d.get("fulfillment_note"),
        buyer_confirmed_at=d.get("buyer_confirmed_at"),
        dispute_raised_at=d.get("dispute_raised_at"),
        dispute_reason=d.get("dispute_reason"),
        escrow_release_at=d.get("escrow_release_at"),
        escrow_status=d.get("escrow_status"),
        payout_id=d.get("payout_id"),
        notified_seller_at=d.get("notified_seller_at"),
    )


def _payout_summary(bank: Optional[Dict[str, Any]]) -> Optional[str]:
    if not bank:
        return None
    parts = []
    if bank.get("bank_name"):
        bn = bank["bank_name"]
        an = bank.get("account_number") or ""
        if an:
            parts.append(f"{bn} ••• {str(an)[-4:]}")
        else:
            parts.append(bn)
    if bank.get("mpesa_paybill"):
        parts.append(f"M-Pesa Paybill {bank['mpesa_paybill']}")
    if bank.get("mpesa_till"):
        parts.append(f"M-Pesa Till {bank['mpesa_till']}")
    return " · ".join(parts) if parts else None


async def _order_doc_to_detail(d: Dict[str, Any]) -> OrderDetailOut:
    item = await db.items.find_one(
        {"id": d["item_id"]},
        {"_id": 0, "image_b64": 1, "garment_type": 1},
    )
    seller_id = d.get("seller_id")
    seller_card: Optional[OrderSellerOut] = None
    if not seller_id and item:
        # Backfill seller_id from item if older orders are missing it.
        item_full = await db.items.find_one({"id": d["item_id"]}, {"_id": 0, "seller_id": 1})
        seller_id = (item_full or {}).get("seller_id")
    if seller_id:
        seller = await db.users.find_one(
            {"id": seller_id},
            {
                "_id": 0,
                "id": 1,
                "full_name": 1,
                "company_name": 1,
                "location": 1,
                "bank_details": 1,
            },
        )
        if seller:
            seller_card = OrderSellerOut(
                id=seller["id"],
                full_name=seller.get("full_name", ""),
                company_name=seller.get("company_name"),
                location=seller.get("location"),
                payout_summary=_payout_summary(seller.get("bank_details")),
            )
    amount = int(d.get("amount_cents", 0))
    fee = int(d.get("platform_fee_cents") or (amount * PLATFORM_FEE_BPS) // 10000)
    net = int(d.get("seller_net_cents") or max(amount - fee, 0))
    # Enrich the doc with the auto-detected carrier so buyers get a
    # friendly carrier label the moment tracking is added.
    d = enrich_order_with_carrier(d)
    return OrderDetailOut(
        id=d["id"],
        buyer_id=d["buyer_id"],
        seller_id=seller_id or "",
        item_id=d["item_id"],
        item_name=d["item_name"],
        size=d["size"],
        color=d.get("color"),
        amount_cents=amount,
        currency=d.get("currency", "USD"),
        status=d["status"],
        fit_feedback=d.get("fit_feedback"),
        session_id=d["session_id"],
        created_at=d["created_at"],
        platform_fee_cents=fee,
        seller_net_cents=net,
        item_image_b64=(item or {}).get("image_b64") if item else None,
        item_garment_type=(item or {}).get("garment_type") if item else None,
        fit_feedback_comment=d.get("fit_feedback_comment"),
        seller=seller_card,
        shipping_address=d.get("shipping_address"),
        tracking_number=d.get("tracking_number"),
        tracking_url=d.get("tracking_url"),
        carrier=d.get("carrier"),
        shipped_at=d.get("shipped_at"),
        estimated_delivery_days=d.get("estimated_delivery_days"),
        estimated_delivery_at=d.get("estimated_delivery_at"),
        delivered_at=d.get("delivered_at"),
        fulfillment_note=d.get("fulfillment_note"),
        buyer_confirmed_at=d.get("buyer_confirmed_at"),
        dispute_raised_at=d.get("dispute_raised_at"),
        dispute_reason=d.get("dispute_reason"),
        escrow_release_at=d.get("escrow_release_at"),
        escrow_status=d.get("escrow_status"),
        payout_id=d.get("payout_id"),
        notified_seller_at=d.get("notified_seller_at"),
    )


@router.get("/orders", response_model=List[OrderOut])
async def my_orders(user: Dict[str, Any] = Depends(get_current_user)) -> List[OrderOut]:
    docs = (
        await db.orders.find({"buyer_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(100)
    )
    return [_order_doc_to_out(d) for d in docs]


@router.get("/orders/{order_id}", response_model=OrderDetailOut)
async def order_detail(
    order_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> OrderDetailOut:
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    # Authorise: buyer of the order, seller of the item, or admin.
    role = user.get("role")
    is_buyer = order["buyer_id"] == user["id"]
    is_seller = order.get("seller_id") == user["id"]
    is_admin = role == "admin"
    if not (is_buyer or is_seller or is_admin):
        raise HTTPException(status_code=403, detail="Not your order")
    return await _order_doc_to_detail(order)


@router.post("/orders/{order_id}/feedback", response_model=OrderDetailOut)
async def submit_fit_feedback(
    order_id: str,
    body: FitFeedbackIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> OrderDetailOut:
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["buyer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your order")
    if order["status"] != "paid":
        raise HTTPException(
            status_code=400, detail="Only paid orders can receive fit feedback"
        )
    set_doc: Dict[str, Any] = {"fit_feedback": body.fit}
    if body.comment is not None:
        set_doc["fit_feedback_comment"] = body.comment.strip()
    await db.orders.update_one({"id": order_id}, {"$set": set_doc})
    fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return await _order_doc_to_detail(fresh)



# ---------------------------------------------------------------------------
# Tracking flow — buyer nudges seller, confirms delivery, reports a problem
# ---------------------------------------------------------------------------


@router.post("/orders/{order_id}/notify-seller")
async def notify_seller(
    order_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    """Buyer nudges the seller from the order detail screen ("Where's
    my package?"). Rate-limited to once per :data:`NUDGE_COOLDOWN_HOURS`
    so sellers aren't spammed. Actual delivery to the seller happens via
    the in-app inbox (future: also push notification).
    """
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["buyer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your order")
    if order["status"] not in {"paid", "in_fulfillment", "shipped"}:
        raise HTTPException(
            status_code=400,
            detail="Seller can only be nudged on paid / packing / shipped orders",
        )
    now = datetime.now(timezone.utc)
    last = order.get("notified_seller_at")
    if last:
        # ``last`` may be tz-naive after Mongo round-trip; normalise.
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        elapsed = (now - last).total_seconds() / 3600
        if elapsed < NUDGE_COOLDOWN_HOURS:
            wait_hours = int(NUDGE_COOLDOWN_HOURS - elapsed) or 1
            raise HTTPException(
                status_code=429,
                detail=f"You already nudged the seller — please wait ~{wait_hours}h before nudging again.",
            )
    await db.orders.update_one(
        {"id": order_id}, {"$set": {"notified_seller_at": now}}
    )
    return {"ok": True, "notified_at": now.isoformat()}


@router.post("/orders/{order_id}/confirm-delivery", response_model=OrderDetailOut)
async def confirm_delivery(
    order_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> OrderDetailOut:
    """Buyer confirms they received the item — releases escrow to the
    seller immediately (no need to wait out the 48h auto-release timer).
    Valid once the order is ``shipped`` or ``delivered`` — the buyer holding
    the parcel IS the proof of delivery, so we don't force them to wait for
    the seller/courier to flip the status first.
    """
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["buyer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your order")
    if order.get("status") not in ("shipped", "delivered"):
        raise HTTPException(
            status_code=400,
            detail="Confirm receipt becomes available once the seller marks the order shipped",
        )
    if order.get("dispute_raised_at"):
        raise HTTPException(status_code=409, detail="Order has an open dispute")
    result = await escrow_mod.confirm_delivery_by_buyer(order_id, user["id"])
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("reason", "Failed"))
    fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return await _order_doc_to_detail(fresh)


@router.post("/orders/{order_id}/report-problem", response_model=OrderDetailOut)
async def report_problem(
    order_id: str,
    body: ReportProblemIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> OrderDetailOut:
    """Buyer flags an issue during the escrow window. Freezes the payout
    in ``disputed`` state until an admin resolves it. Only allowed once
    the order is at least ``shipped`` and not yet ``buyer_confirmed``.
    """
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["buyer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your order")
    if order.get("status") not in {"shipped", "delivered"}:
        raise HTTPException(
            status_code=400,
            detail="Problems can only be reported after the order is shipped",
        )
    if order.get("buyer_confirmed_at"):
        raise HTTPException(status_code=409, detail="You've already confirmed this order")
    result = await escrow_mod.raise_dispute(order_id, user["id"], body.reason)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("reason", "Failed"))
    fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return await _order_doc_to_detail(fresh)

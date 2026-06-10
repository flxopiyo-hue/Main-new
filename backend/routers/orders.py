"""Buyer order history + order detail + fit feedback submission."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from core.config import PLATFORM_FEE_BPS
from core.db import db
from core.security import get_current_user
from models import (
    FitFeedbackIn,
    OrderDetailOut,
    OrderOut,
    OrderSellerOut,
)

router = APIRouter()


def _order_doc_to_out(d: Dict[str, Any]) -> OrderOut:
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
        seller=seller_card,
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

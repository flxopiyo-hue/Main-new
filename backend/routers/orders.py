"""Buyer order history + fit feedback submission."""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.security import get_current_user
from models import FitFeedbackIn, OrderOut

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


@router.get("/orders", response_model=List[OrderOut])
async def my_orders(user: Dict[str, Any] = Depends(get_current_user)) -> List[OrderOut]:
    docs = (
        await db.orders.find({"buyer_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(100)
    )
    return [_order_doc_to_out(d) for d in docs]


@router.post("/orders/{order_id}/feedback", response_model=OrderOut)
async def submit_fit_feedback(
    order_id: str,
    body: FitFeedbackIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> OrderOut:
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["buyer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your order")
    if order["status"] != "paid":
        raise HTTPException(
            status_code=400, detail="Only paid orders can receive fit feedback"
        )
    await db.orders.update_one(
        {"id": order_id}, {"$set": {"fit_feedback": body.fit}}
    )
    fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return _order_doc_to_out(fresh)

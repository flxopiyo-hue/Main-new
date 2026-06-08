"""Wishlist routes including restock detection."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.security import get_current_user
from models import WishlistOut, item_to_out, total_qty

router = APIRouter()


@router.post("/wishlist/{item_id}")
async def add_wishlist(
    item_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, bool]:
    item = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    now = datetime.now(timezone.utc)
    await db.wishlists.update_one(
        {"user_id": user["id"], "item_id": item_id},
        {
            "$setOnInsert": {
                "user_id": user["id"],
                "item_id": item_id,
                "qty_at_add": total_qty(item),
                "added_at": now,
            }
        },
        upsert=True,
    )
    return {"ok": True}


@router.delete("/wishlist/{item_id}")
async def remove_wishlist(
    item_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, bool]:
    await db.wishlists.delete_one({"user_id": user["id"], "item_id": item_id})
    return {"ok": True}


@router.get("/wishlist", response_model=List[WishlistOut])
async def list_wishlist(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[WishlistOut]:
    wishes = (
        await db.wishlists.find({"user_id": user["id"]}, {"_id": 0})
        .sort("added_at", -1)
        .to_list(200)
    )
    item_ids = [w["item_id"] for w in wishes]
    items_cursor = db.items.find({"id": {"$in": item_ids}}, {"_id": 0})
    items_by_id: Dict[str, Dict[str, Any]] = {}
    async for it in items_cursor:
        items_by_id[it["id"]] = it
    out: List[WishlistOut] = []
    for w in wishes:
        it = items_by_id.get(w["item_id"])
        if not it:
            continue
        current_qty = total_qty(it)
        restocked = (w.get("qty_at_add", 0) == 0) and current_qty > 0
        out.append(
            WishlistOut(
                item=item_to_out(it),
                added_at=w["added_at"],
                restocked=restocked,
            )
        )
    return out


@router.get("/wishlist/ids")
async def list_wishlist_ids(
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, List[str]]:
    docs = (
        await db.wishlists.find(
            {"user_id": user["id"]}, {"_id": 0, "item_id": 1}
        ).to_list(500)
    )
    return {"item_ids": [d["item_id"] for d in docs]}

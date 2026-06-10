"""Items CRUD + personalised /feed.

IMPORTANT route-ordering note: /items/mine and /items/feed must be declared
BEFORE /items/{item_id} so the dynamic segment doesn't swallow them.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from core.config import DEFAULT_CURRENCY
from core.db import db
from core.images import strip_data_prefix
from core.security import (
    auth_scheme,
    get_current_user,
    require_role,
    try_get_user_from_creds,
)
from models import ItemIn, ItemOut, ItemPatchIn, infer_garment_type, item_to_out

router = APIRouter()


@router.post("/items", response_model=ItemOut)
async def create_item(
    body: ItemIn, user: Dict[str, Any] = Depends(get_current_user)
) -> ItemOut:
    await require_role("seller", user)
    item_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    # If seller didn't pass an explicit currency, fall back to their preferred currency.
    listing_currency = (
        body.currency or user.get("preferred_currency") or DEFAULT_CURRENCY
    )
    garment_type = body.garment_type or infer_garment_type(
        {"name": body.name, "category": body.category}
    )
    doc = {
        "id": item_id,
        "seller_id": user["id"],
        "seller_name": user["full_name"],
        "name": body.name,
        "description": body.description,
        "category": body.category,
        "price_cents": body.price_cents,
        "currency": listing_currency,
        "garment_type": garment_type,
        "image_b64": strip_data_prefix(body.image_b64),
        "sizes": [s.model_dump() for s in body.sizes],
        "colors": [c.model_dump() for c in body.colors],
        "audience": body.audience,
        "created_at": now,
    }
    await db.items.insert_one(doc)
    return item_to_out(doc)


@router.get("/items", response_model=List[ItemOut])
async def list_items(
    category: Optional[str] = None,
    size: Optional[str] = None,
    color: Optional[str] = None,
    seller_id: Optional[str] = None,
    audience: Optional[str] = None,
    kid_age_group: Optional[str] = None,
    q: Optional[str] = None,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
) -> List[ItemOut]:
    query: Dict[str, Any] = {}
    if category:
        query["category"] = category
    if size:
        query["sizes.label"] = size
    if color:
        query["colors.name"] = color
    if seller_id:
        query["seller_id"] = seller_id
    if q:
        query["name"] = {"$regex": q, "$options": "i"}

    # Audience filtering — explicit param wins, otherwise infer from buyer gender.
    if audience and audience != "all":
        query["audience"] = audience
    elif not audience:
        u = await try_get_user_from_creds(creds)
        if u and u.get("role") == "buyer":
            g = u.get("gender")
            if g == "male":
                query["audience"] = {"$in": ["men", "unisex"]}
            elif g == "female":
                query["audience"] = {"$in": ["women", "unisex"]}
            # other / prefer_not_to_say → show everything (no filter)

    # Kid age-group filter: maps an age-band to the kid US-size set so the
    # buyer sees items with matching size labels.
    if kid_age_group:
        from models import KID_SIZE_SETS_BY_AGE_GROUP

        size_set = KID_SIZE_SETS_BY_AGE_GROUP.get(kid_age_group)
        if size_set:
            query["sizes.label"] = {"$in": size_set}

    docs = await db.items.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [item_to_out(d) for d in docs]


# IMPORTANT: /items/mine must come BEFORE /items/{item_id}.
@router.get("/items/mine", response_model=List[ItemOut])
async def my_items(user: Dict[str, Any] = Depends(get_current_user)) -> List[ItemOut]:
    docs = (
        await db.items.find({"seller_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(200)
    )
    return [item_to_out(d) for d in docs]


@router.get("/items/{item_id}", response_model=ItemOut)
async def get_item(
    item_id: str,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
) -> ItemOut:
    doc = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    # Increment view counter, but never count the seller's own visit.
    u = await try_get_user_from_creds(creds)
    skip_count = bool(u and u.get("id") == doc["seller_id"])
    if not skip_count:
        await db.items.update_one({"id": item_id}, {"$inc": {"views": 1}})
    return item_to_out(doc)


@router.delete("/items/{item_id}")
async def delete_item(
    item_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, bool]:
    doc = await db.items.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    if doc["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your item")
    await db.items.delete_one({"id": item_id})
    return {"ok": True}


@router.patch("/items/{item_id}", response_model=ItemOut)
async def patch_item(
    item_id: str,
    body: ItemPatchIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> ItemOut:
    doc = await db.items.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    if doc["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your item")
    if body.sizes is not None:
        await db.items.update_one(
            {"id": item_id},
            {"$set": {"sizes": [s.model_dump() for s in body.sizes]}},
        )
    fresh = await db.items.find_one({"id": item_id}, {"_id": 0})
    return item_to_out(fresh)


@router.get("/feed", response_model=List[ItemOut])
async def items_feed(
    user: Dict[str, Any] = Depends(get_current_user),
    limit: int = 60,
) -> List[ItemOut]:
    """Personalized re-ranking of items for the current buyer.

    Score = audience_match + seller_affinity + category_affinity + freshness.
    """
    seller_affinity: Dict[str, float] = {}
    category_affinity: Dict[str, float] = {}

    async def bump(seller_id: str, category: str, weight: float) -> None:
        if seller_id:
            seller_affinity[seller_id] = seller_affinity.get(seller_id, 0.0) + weight
        if category:
            category_affinity[category] = category_affinity.get(category, 0.0) + weight

    # Wishlists (+2), try-ons (+1.5), paid orders (+3), perfect-fit orders (+4).
    wishes = db.wishlists.find({"user_id": user["id"]}, {"_id": 0, "item_id": 1})
    wish_ids: List[str] = []
    async for w in wishes:
        wish_ids.append(w["item_id"])
    if wish_ids:
        async for it in db.items.find(
            {"id": {"$in": wish_ids}}, {"_id": 0, "seller_id": 1, "category": 1}
        ):
            await bump(it.get("seller_id", ""), it.get("category", ""), 2.0)

    tryons = db.tryons.find(
        {"user_id": user["id"]}, {"_id": 0, "item_id": 1}
    ).sort("created_at", -1)
    to_ids: List[str] = []
    async for t in tryons:
        to_ids.append(t["item_id"])
    if to_ids:
        async for it in db.items.find(
            {"id": {"$in": to_ids[:30]}}, {"_id": 0, "seller_id": 1, "category": 1}
        ):
            await bump(it.get("seller_id", ""), it.get("category", ""), 1.5)

    async for o in db.orders.find(
        {"buyer_id": user["id"], "status": "paid"},
        {"_id": 0, "seller_id": 1, "item_id": 1, "fit_feedback": 1},
    ):
        seller_id = o.get("seller_id")
        item_doc = await db.items.find_one(
            {"id": o["item_id"]}, {"_id": 0, "category": 1}
        )
        category = item_doc.get("category") if item_doc else ""
        weight = 4.0 if o.get("fit_feedback") == "perfect" else 3.0
        await bump(seller_id, category, weight)

    # Build the candidate query — same audience filter logic as list_items.
    query: Dict[str, Any] = {}
    g = user.get("gender")
    if user.get("role") == "buyer":
        if g == "male":
            query["audience"] = {"$in": ["men", "unisex"]}
        elif g == "female":
            query["audience"] = {"$in": ["women", "unisex"]}

    docs = await db.items.find(query, {"_id": 0}).sort("created_at", -1).to_list(300)

    now = datetime.now(timezone.utc)

    def score(d: Dict[str, Any]) -> float:
        s = 0.0
        s += seller_affinity.get(d.get("seller_id", ""), 0.0)
        s += category_affinity.get(d.get("category", ""), 0.0)
        # Freshness: items in the last 7 days get a small boost.
        try:
            age_days = (now - d["created_at"]).total_seconds() / 86400.0
            s += max(0.0, 1.0 - age_days / 7.0) * 0.5
        except Exception:
            pass
        return s

    ranked = sorted(docs, key=lambda d: (-score(d), -d["created_at"].timestamp()))
    return [item_to_out(d) for d in ranked[:limit]]

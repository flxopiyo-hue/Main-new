"""Designer collections (drops). /collections/mine MUST come before /{collection_id}."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.security import get_current_user, require_role
from models import CollectionIn, CollectionOut, collection_to_out, item_to_out

router = APIRouter()


@router.post("/collections", response_model=CollectionOut)
async def create_collection(
    body: CollectionIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> CollectionOut:
    await require_role("seller", user)
    # Use first owned item as a cover if available.
    cover: Optional[str] = None
    if body.item_ids:
        first = await db.items.find_one(
            {"id": {"$in": body.item_ids}, "seller_id": user["id"]},
            {"_id": 0, "image_b64": 1},
        )
        if first:
            cover = first.get("image_b64")
    coll_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc = {
        "id": coll_id,
        "seller_id": user["id"],
        "seller_name": user["full_name"],
        "name": body.name.strip(),
        "description": body.description.strip(),
        "item_ids": [iid for iid in body.item_ids if iid],
        "cover_image_b64": cover,
        "created_at": now,
    }
    await db.collections.insert_one(doc)
    return collection_to_out(doc)


@router.get("/collections", response_model=List[CollectionOut])
async def list_collections() -> List[CollectionOut]:
    """Public list of all collections (newest first)."""
    docs = (
        await db.collections.find({}, {"_id": 0}).sort("created_at", -1).to_list(80)
    )
    return [collection_to_out(d) for d in docs]


# IMPORTANT: /collections/mine must come BEFORE /collections/{collection_id}.
@router.get("/collections/mine", response_model=List[CollectionOut])
async def my_collections(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[CollectionOut]:
    docs = (
        await db.collections.find({"seller_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(100)
    )
    return [collection_to_out(d) for d in docs]


@router.get("/collections/{collection_id}")
async def get_collection(collection_id: str) -> Dict[str, Any]:
    doc = await db.collections.find_one({"id": collection_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Collection not found")
    items: List[Dict[str, Any]] = []
    if doc.get("item_ids"):
        async for it in db.items.find(
            {"id": {"$in": doc["item_ids"]}}, {"_id": 0}
        ):
            items.append(it)
    return {
        "collection": collection_to_out(doc).model_dump(),
        "items": [item_to_out(it).model_dump() for it in items],
    }


@router.delete("/collections/{collection_id}")
async def delete_collection(
    collection_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, bool]:
    doc = await db.collections.find_one({"id": collection_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Collection not found")
    if doc["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your collection")
    await db.collections.delete_one({"id": collection_id})
    return {"ok": True}

"""Loved-ones (alternate body profiles) + active profile switcher.

A buyer can shop for multiple people from one account: themselves, their child,
a partner, a friend. Each "loved one" has their own name, audience (adult/kid),
gender, age, dimensions, and front/side photos.

The user's own body profile is exposed via `/api/profile` (see profile.py) and
is represented in this router as id="self" inside the unified profile list.

Active profile state is stored on the user document as `active_profile_id`
(either "self" or a LovedOne uuid). The Discover + Try-On screens read this
to drive (a) audience filtering and (b) which photos the AI uses.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.images import strip_data_prefix
from core.security import get_current_user
from models import (
    ActiveProfileIn,
    ActiveProfileOut,
    LovedOneDetail,
    LovedOneIn,
    LovedOneOut,
    LovedOnePatch,
    Measurements,
    ProfileSummary,
)

router = APIRouter()


def _lo_doc_to_out(doc: Dict[str, Any]) -> LovedOneOut:
    return LovedOneOut(
        id=doc["id"],
        user_id=doc["user_id"],
        name=doc["name"],
        audience=doc["audience"],
        gender=doc.get("gender"),
        age=doc.get("age"),
        relation=doc.get("relation"),
        measurements=Measurements(**(doc.get("measurements") or {})),
        preferred_size=doc.get("preferred_size"),
        preferred_shoe_size=doc.get("preferred_shoe_size"),
        has_front_photo=bool(doc.get("front_photo_b64")),
        has_side_photo=bool(doc.get("side_photo_b64")),
        has_three_quarter_photo=bool(doc.get("three_quarter_photo_b64")),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


def _lo_doc_to_detail(doc: Dict[str, Any]) -> LovedOneDetail:
    """Same as _lo_doc_to_out but also returns the raw photo base64
    strings. Only used by the single-loved-one GET endpoint that powers
    the edit screen."""
    return LovedOneDetail(
        id=doc["id"],
        user_id=doc["user_id"],
        name=doc["name"],
        audience=doc["audience"],
        gender=doc.get("gender"),
        age=doc.get("age"),
        relation=doc.get("relation"),
        measurements=Measurements(**(doc.get("measurements") or {})),
        preferred_size=doc.get("preferred_size"),
        preferred_shoe_size=doc.get("preferred_shoe_size"),
        has_front_photo=bool(doc.get("front_photo_b64")),
        has_side_photo=bool(doc.get("side_photo_b64")),
        has_three_quarter_photo=bool(doc.get("three_quarter_photo_b64")),
        front_photo_b64=doc.get("front_photo_b64"),
        side_photo_b64=doc.get("side_photo_b64"),
        three_quarter_photo_b64=doc.get("three_quarter_photo_b64"),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


def _lo_doc_to_summary(doc: Dict[str, Any]) -> ProfileSummary:
    return ProfileSummary(
        id=doc["id"],
        is_self=False,
        name=doc["name"],
        audience=doc["audience"],
        gender=doc.get("gender"),
        age=doc.get("age"),
        has_front_photo=bool(doc.get("front_photo_b64")),
        has_side_photo=bool(doc.get("side_photo_b64")),
        preferred_size=doc.get("preferred_size"),
    )


async def _self_summary(user: Dict[str, Any]) -> ProfileSummary:
    """Build the "Me" entry from the user + their /api/profile doc."""
    p = await db.profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    return ProfileSummary(
        id="self",
        is_self=True,
        name="Me",
        # The user's own audience is always adult (we don't currently let users
        # self-mark as a child via signup).
        audience="adult",
        gender=user.get("gender"),
        age=user.get("age"),
        has_front_photo=bool((p or {}).get("front_photo_b64")),
        has_side_photo=bool((p or {}).get("side_photo_b64")),
        preferred_size=(p or {}).get("preferred_size"),
    )


async def _resolve_profile_owner(
    profile_id: str, user: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """Return the loved-one doc owned by `user` matching `profile_id`, or None
    if profile_id == "self"."""
    if profile_id == "self":
        return None
    doc = await db.body_profiles.find_one({"id": profile_id, "user_id": user["id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Profile not found")
    return doc


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
@router.get("/loved-ones", response_model=List[LovedOneOut])
async def list_loved_ones(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[LovedOneOut]:
    cursor = db.body_profiles.find({"user_id": user["id"]}, {"_id": 0}).sort(
        "created_at", 1
    )
    return [_lo_doc_to_out(d) for d in await cursor.to_list(50)]


@router.get("/loved-ones/{profile_id}", response_model=LovedOneDetail)
async def get_loved_one(
    profile_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> LovedOneDetail:
    """Full loved-one document (photos included as base64) — powers the
    edit screen so it can prefill the three-angle photo picker plus every
    measurement/identity field. Access is scoped to the owning user."""
    doc = await db.body_profiles.find_one(
        {"id": profile_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _lo_doc_to_detail(doc)


@router.post("/loved-ones", response_model=LovedOneOut)
async def create_loved_one(
    body: LovedOneIn, user: Dict[str, Any] = Depends(get_current_user)
) -> LovedOneOut:
    if user.get("role") != "buyer":
        raise HTTPException(status_code=403, detail="Only buyers can add loved ones")
    # Enforce per-tier profile cap (Free = 2 / Premium = 10). Raises 402
    # with paywall metadata when the buyer hits the wall.
    from core.gating import assert_can_add_profile
    await assert_can_add_profile(user)
    if body.audience == "kid" and body.age is None:
        raise HTTPException(status_code=400, detail="Age is required for kid profiles")
    doc_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc: Dict[str, Any] = {
        "id": doc_id,
        "user_id": user["id"],
        "name": body.name.strip(),
        "audience": body.audience,
        "gender": body.gender,
        "age": body.age,
        "relation": (body.relation or "").strip() or None,
        "measurements": (body.measurements.model_dump() if body.measurements else {}),
        "preferred_size": body.preferred_size,
        "preferred_shoe_size": body.preferred_shoe_size,
        "created_at": now,
        "updated_at": now,
    }
    if body.front_photo_b64:
        doc["front_photo_b64"] = strip_data_prefix(body.front_photo_b64)
    if body.side_photo_b64:
        doc["side_photo_b64"] = strip_data_prefix(body.side_photo_b64)
    if body.three_quarter_photo_b64:
        doc["three_quarter_photo_b64"] = strip_data_prefix(body.three_quarter_photo_b64)
    await db.body_profiles.insert_one(doc)
    fresh = await db.body_profiles.find_one({"id": doc_id}, {"_id": 0})
    return _lo_doc_to_out(fresh)


@router.patch("/loved-ones/{profile_id}", response_model=LovedOneOut)
async def update_loved_one(
    profile_id: str,
    body: LovedOnePatch,
    user: Dict[str, Any] = Depends(get_current_user),
) -> LovedOneOut:
    existing = await db.body_profiles.find_one(
        {"id": profile_id, "user_id": user["id"]}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Profile not found")
    update: Dict[str, Any] = {}
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        update["name"] = (data["name"] or "").strip() or existing["name"]
    if "audience" in data and data["audience"] is not None:
        update["audience"] = data["audience"]
    if "gender" in data:
        update["gender"] = data["gender"]
    if "age" in data:
        update["age"] = data["age"]
    if "relation" in data:
        update["relation"] = (data["relation"] or "").strip() or None
    if "measurements" in data and data["measurements"] is not None:
        # Merge incoming measurements with stored ones.
        merged = {**(existing.get("measurements") or {})}
        for k, v in data["measurements"].items():
            if v is not None:
                merged[k] = v
        update["measurements"] = merged
    if "preferred_size" in data:
        update["preferred_size"] = data["preferred_size"]
    if "preferred_shoe_size" in data:
        update["preferred_shoe_size"] = data["preferred_shoe_size"]
    if "front_photo_b64" in data and data["front_photo_b64"]:
        update["front_photo_b64"] = strip_data_prefix(data["front_photo_b64"])
    if "side_photo_b64" in data and data["side_photo_b64"]:
        update["side_photo_b64"] = strip_data_prefix(data["side_photo_b64"])
    if "three_quarter_photo_b64" in data and data["three_quarter_photo_b64"]:
        update["three_quarter_photo_b64"] = strip_data_prefix(data["three_quarter_photo_b64"])
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    update["updated_at"] = datetime.now(timezone.utc)
    await db.body_profiles.update_one(
        {"id": profile_id, "user_id": user["id"]}, {"$set": update}
    )
    fresh = await db.body_profiles.find_one(
        {"id": profile_id, "user_id": user["id"]}, {"_id": 0}
    )
    return _lo_doc_to_out(fresh)


@router.delete("/loved-ones/{profile_id}")
async def delete_loved_one(
    profile_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, bool]:
    res = await db.body_profiles.delete_one(
        {"id": profile_id, "user_id": user["id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Profile not found")
    # If the deleted profile was active, reset to "self".
    if user.get("active_profile_id") == profile_id:
        await db.users.update_one(
            {"id": user["id"]}, {"$set": {"active_profile_id": "self"}}
        )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Unified profile switcher
# ---------------------------------------------------------------------------
@router.get("/profiles/all", response_model=List[ProfileSummary])
async def list_all_profiles(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[ProfileSummary]:
    out: List[ProfileSummary] = [await _self_summary(user)]
    docs = (
        await db.body_profiles.find({"user_id": user["id"]}, {"_id": 0})
        .sort("created_at", 1)
        .to_list(50)
    )
    out.extend(_lo_doc_to_summary(d) for d in docs)
    return out


@router.get("/profiles/active", response_model=ActiveProfileOut)
async def get_active_profile(
    user: Dict[str, Any] = Depends(get_current_user),
) -> ActiveProfileOut:
    active_id = user.get("active_profile_id") or "self"
    if active_id == "self":
        return ActiveProfileOut(profile_id="self", profile=await _self_summary(user))
    doc = await db.body_profiles.find_one(
        {"id": active_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not doc:
        # Stale active id — reset to self.
        await db.users.update_one(
            {"id": user["id"]}, {"$set": {"active_profile_id": "self"}}
        )
        return ActiveProfileOut(profile_id="self", profile=await _self_summary(user))
    return ActiveProfileOut(profile_id=active_id, profile=_lo_doc_to_summary(doc))


@router.post("/profiles/active", response_model=ActiveProfileOut)
async def set_active_profile(
    body: ActiveProfileIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> ActiveProfileOut:
    if body.profile_id == "self":
        await db.users.update_one(
            {"id": user["id"]}, {"$set": {"active_profile_id": "self"}}
        )
        return ActiveProfileOut(profile_id="self", profile=await _self_summary(user))
    doc = await db.body_profiles.find_one(
        {"id": body.profile_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Profile not found")
    await db.users.update_one(
        {"id": user["id"]}, {"$set": {"active_profile_id": body.profile_id}}
    )
    return ActiveProfileOut(profile_id=body.profile_id, profile=_lo_doc_to_summary(doc))

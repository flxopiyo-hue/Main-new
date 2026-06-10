"""Delivery address book (multi-address per buyer)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.security import get_current_user
from models import (
    AddressIn,
    AddressOut,
    AddressPatch,
)

router = APIRouter()


def _addr_doc_to_out(doc: Dict[str, Any]) -> AddressOut:
    return AddressOut(
        id=doc["id"],
        user_id=doc["user_id"],
        label=doc.get("label", "home"),
        custom_label=doc.get("custom_label"),
        recipient_name=doc["recipient_name"],
        phone=doc["phone"],
        alt_phone=doc.get("alt_phone"),
        building_estate=doc.get("building_estate"),
        house_number=doc.get("house_number"),
        street=doc.get("street"),
        area=doc.get("area"),
        city=doc["city"],
        postal_code=doc.get("postal_code"),
        country=doc["country"],
        delivery_notes=doc.get("delivery_notes"),
        is_default=bool(doc.get("is_default", False)),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


async def _unset_other_defaults(user_id: str, except_id: str | None = None) -> None:
    query: Dict[str, Any] = {"user_id": user_id, "is_default": True}
    if except_id is not None:
        query["id"] = {"$ne": except_id}
    await db.addresses.update_many(query, {"$set": {"is_default": False}})


@router.get("/addresses", response_model=List[AddressOut])
async def list_addresses(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[AddressOut]:
    docs = (
        await db.addresses.find({"user_id": user["id"]}, {"_id": 0})
        .sort([("is_default", -1), ("created_at", -1)])
        .to_list(40)
    )
    return [_addr_doc_to_out(d) for d in docs]


@router.post("/addresses", response_model=AddressOut)
async def create_address(
    body: AddressIn, user: Dict[str, Any] = Depends(get_current_user)
) -> AddressOut:
    if user.get("role") != "buyer":
        raise HTTPException(status_code=403, detail="Only buyers can save addresses")
    aid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    # If this is the user's first address OR they explicitly asked for default,
    # set it as default.
    has_any = (
        await db.addresses.count_documents({"user_id": user["id"]}, limit=1) > 0
    )
    is_default = body.is_default or not has_any
    if is_default:
        await _unset_other_defaults(user["id"])
    doc: Dict[str, Any] = {
        "id": aid,
        "user_id": user["id"],
        "label": body.label,
        "custom_label": (body.custom_label or "").strip() or None,
        "recipient_name": body.recipient_name.strip(),
        "phone": body.phone.strip(),
        "alt_phone": (body.alt_phone or "").strip() or None,
        "building_estate": (body.building_estate or "").strip() or None,
        "house_number": (body.house_number or "").strip() or None,
        "street": (body.street or "").strip() or None,
        "area": (body.area or "").strip() or None,
        "city": body.city.strip(),
        "postal_code": (body.postal_code or "").strip() or None,
        "country": body.country.strip(),
        "delivery_notes": (body.delivery_notes or "").strip() or None,
        "is_default": is_default,
        "created_at": now,
        "updated_at": now,
    }
    await db.addresses.insert_one(doc)
    fresh = await db.addresses.find_one({"id": aid}, {"_id": 0})
    return _addr_doc_to_out(fresh)


@router.get("/addresses/{address_id}", response_model=AddressOut)
async def get_address(
    address_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> AddressOut:
    doc = await db.addresses.find_one(
        {"id": address_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Address not found")
    return _addr_doc_to_out(doc)


@router.patch("/addresses/{address_id}", response_model=AddressOut)
async def update_address(
    address_id: str,
    body: AddressPatch,
    user: Dict[str, Any] = Depends(get_current_user),
) -> AddressOut:
    existing = await db.addresses.find_one(
        {"id": address_id, "user_id": user["id"]}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Address not found")
    data = body.model_dump(exclude_unset=True)
    update: Dict[str, Any] = {}
    for k, v in data.items():
        if k == "is_default":
            update["is_default"] = bool(v)
        elif isinstance(v, str):
            stripped = v.strip()
            update[k] = stripped or None if k != "recipient_name" and k != "city" and k != "country" and k != "phone" and k != "label" else stripped
        else:
            update[k] = v
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    update["updated_at"] = datetime.now(timezone.utc)
    if update.get("is_default") is True:
        await _unset_other_defaults(user["id"], except_id=address_id)
    await db.addresses.update_one(
        {"id": address_id, "user_id": user["id"]}, {"$set": update}
    )
    fresh = await db.addresses.find_one(
        {"id": address_id, "user_id": user["id"]}, {"_id": 0}
    )
    return _addr_doc_to_out(fresh)


@router.post("/addresses/{address_id}/default", response_model=AddressOut)
async def set_default_address(
    address_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> AddressOut:
    existing = await db.addresses.find_one(
        {"id": address_id, "user_id": user["id"]}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Address not found")
    await _unset_other_defaults(user["id"], except_id=address_id)
    await db.addresses.update_one(
        {"id": address_id, "user_id": user["id"]},
        {"$set": {"is_default": True, "updated_at": datetime.now(timezone.utc)}},
    )
    fresh = await db.addresses.find_one(
        {"id": address_id, "user_id": user["id"]}, {"_id": 0}
    )
    return _addr_doc_to_out(fresh)


@router.delete("/addresses/{address_id}")
async def delete_address(
    address_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, bool]:
    existing = await db.addresses.find_one(
        {"id": address_id, "user_id": user["id"]}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Address not found")
    was_default = bool(existing.get("is_default"))
    await db.addresses.delete_one({"id": address_id, "user_id": user["id"]})
    # Promote the most recently created remaining address to default.
    if was_default:
        next_doc = await db.addresses.find_one(
            {"user_id": user["id"]}, {"_id": 0, "id": 1}, sort=[("created_at", -1)]
        )
        if next_doc:
            await db.addresses.update_one(
                {"id": next_doc["id"]}, {"$set": {"is_default": True}}
            )
    return {"ok": True}

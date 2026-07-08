"""Restock notifications.

Buyers tap "Notify me" on a sold-out size and we track the request in
the ``stock_notifications`` collection. When the seller subsequently
patches the same size's ``available_qty`` above zero, the matching rows
get marked as ``notified_at=now`` and start showing up in the buyer's
in-app notification dot.

There's no email/SMS side-channel in this iteration — the UX is a red
dot on the Atelier tab plus a small badge on the wishlist row. Users
opt out by tapping the same button again (idempotent toggle).

Endpoints (all under ``/api``):

    POST   /items/{item_id}/notify?size=M          subscribe
    DELETE /items/{item_id}/notify?size=M          unsubscribe
    GET    /items/{item_id}/notify                 status for current user
    GET    /notifications/restock                  list this buyer's active + notified
    POST   /notifications/{id}/dismiss             mark viewed → hides badge

The helper :func:`fanout_restock_for_item` is called from the item
write endpoints (create/patch/duplicate) whenever a size's qty could
have flipped from 0 → positive.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core.db import db
from core.security import get_current_user

router = APIRouter(prefix="/api", tags=["restock"])
logger = logging.getLogger("aurafit.restock")


class NotifyStatus(BaseModel):
    subscribed: bool
    size: str


class RestockNotification(BaseModel):
    id: str
    item_id: str
    item_name: str
    size: str
    subscribed_at: datetime
    notified_at: Optional[datetime] = None
    viewed_at: Optional[datetime] = None


@router.post("/items/{item_id}/notify", response_model=NotifyStatus)
async def subscribe_to_restock(
    item_id: str,
    size: str = Query(..., min_length=1, max_length=10),
    user: Dict[str, Any] = Depends(get_current_user),
) -> NotifyStatus:
    """Idempotent: repeated calls for the same (user, item, size) just
    freshen the ``subscribed_at`` timestamp so ordering by "recently
    interested" stays stable.
    """
    if user.get("role") != "buyer":
        raise HTTPException(status_code=403, detail="Only buyers can subscribe")
    item = await db.items.find_one({"id": item_id}, {"_id": 0, "id": 1, "sizes": 1})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if not any(s.get("label") == size for s in item.get("sizes") or []):
        raise HTTPException(status_code=400, detail="Size not offered on this item")

    now = datetime.now(timezone.utc)
    await db.stock_notifications.update_one(
        {"user_id": user["id"], "item_id": item_id, "size": size},
        {
            "$set": {"subscribed_at": now, "notified_at": None, "viewed_at": None},
            "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now},
        },
        upsert=True,
    )
    return NotifyStatus(subscribed=True, size=size)


@router.delete("/items/{item_id}/notify", response_model=NotifyStatus)
async def unsubscribe_from_restock(
    item_id: str,
    size: str = Query(..., min_length=1, max_length=10),
    user: Dict[str, Any] = Depends(get_current_user),
) -> NotifyStatus:
    await db.stock_notifications.delete_one(
        {"user_id": user["id"], "item_id": item_id, "size": size}
    )
    return NotifyStatus(subscribed=False, size=size)


@router.get("/items/{item_id}/notify", response_model=NotifyStatus)
async def restock_status(
    item_id: str,
    size: str = Query(..., min_length=1, max_length=10),
    user: Dict[str, Any] = Depends(get_current_user),
) -> NotifyStatus:
    doc = await db.stock_notifications.find_one(
        {"user_id": user["id"], "item_id": item_id, "size": size}
    )
    return NotifyStatus(subscribed=bool(doc), size=size)


@router.get("/notifications/restock", response_model=List[RestockNotification])
async def my_restock_notifications(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[RestockNotification]:
    """Return every restock subscription the buyer still cares about
    (pending or freshly-notified-but-not-yet-viewed), joined against
    the current item metadata so the UI can render names + thumbnails.
    """
    docs = (
        await db.stock_notifications.find({"user_id": user["id"], "viewed_at": None})
        .sort("subscribed_at", -1)
        .to_list(200)
    )
    if not docs:
        return []
    item_ids = {d["item_id"] for d in docs}
    items = {
        i["id"]: i
        async for i in db.items.find(
            {"id": {"$in": list(item_ids)}}, {"_id": 0, "id": 1, "name": 1}
        )
    }
    out: List[RestockNotification] = []
    for d in docs:
        item = items.get(d["item_id"])
        if not item:
            continue  # Item was deleted — silently skip.
        out.append(
            RestockNotification(
                id=d["id"],
                item_id=d["item_id"],
                item_name=item["name"],
                size=d["size"],
                subscribed_at=d["subscribed_at"],
                notified_at=d.get("notified_at"),
                viewed_at=d.get("viewed_at"),
            )
        )
    return out


@router.post("/notifications/{notif_id}/dismiss", response_model=NotifyStatus)
async def dismiss_notification(
    notif_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> NotifyStatus:
    now = datetime.now(timezone.utc)
    result = await db.stock_notifications.update_one(
        {"id": notif_id, "user_id": user["id"]}, {"$set": {"viewed_at": now}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return NotifyStatus(subscribed=False, size="")


# ---------------------------------------------------------------------------
# Fan-out
# ---------------------------------------------------------------------------


async def fanout_restock_for_item(
    item_id: str, current_sizes: List[Dict[str, Any]]
) -> int:
    """Mark any pending stock_notifications for sizes that are now
    back-in-stock (available_qty > 0) as notified. Called from the item
    write endpoints. Returns the number of buyers notified.

    The dispatch is intentionally passive — we don't send email/SMS.
    Buyers see a small red dot on their Atelier tab next time they
    open the app.
    """
    now = datetime.now(timezone.utc)
    fanned = 0
    for size_row in current_sizes:
        qty = int(size_row.get("available_qty") or 0)
        if qty <= 0:
            continue
        result = await db.stock_notifications.update_many(
            {
                "item_id": item_id,
                "size": size_row.get("label"),
                "notified_at": None,
                "viewed_at": None,
            },
            {"$set": {"notified_at": now}},
        )
        fanned += result.modified_count
    if fanned:
        logger.info("restock fanout: notified %d buyer(s) for item %s", fanned, item_id)
    return fanned

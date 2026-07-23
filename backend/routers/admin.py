"""Admin-only endpoints: platform analytics + user/order/item moderation.

Every route here is guarded by `require_admin()` which raises 403 for any
non-admin caller. The first admin account is seeded by `/app/backend/seed.py`.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import PLATFORM_FEE_BPS
from core.db import db
from core.security import require_admin
from models import (
    BankDetails,
    ItemOut,
    Location,
    OrderOut,
    UserOut,
    item_to_out,
    user_to_out,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class AdminUserPatch(BaseModel):
    suspended: Optional[bool] = None
    bank_details: Optional[BankDetails] = None
    location: Optional[Location] = None
    company_name: Optional[str] = None


class AdminAnalyticsOut(BaseModel):
    total_users: int
    buyers: int
    sellers: int
    admins: int
    suspended: int
    total_items: int
    total_orders: int
    total_paid_orders: int
    total_revenue_cents: int
    total_platform_fee_cents: int
    total_net_to_sellers_cents: int
    pending_connect_sellers: int
    top_sellers: List[Dict[str, Any]]  # [{seller_id, name, revenue_cents, orders}]


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
@router.get("/admin/users", response_model=List[UserOut])
async def admin_list_users(
    role: Optional[str] = None,
    suspended: Optional[bool] = None,
    q: Optional[str] = None,
    limit: int = 200,
    _admin: Dict[str, Any] = Depends(require_admin),
) -> List[UserOut]:
    query: Dict[str, Any] = {}
    if role:
        query["role"] = role
    if suspended is not None:
        # mongo may have docs without the suspended flag — treat absent as False.
        if suspended:
            query["suspended"] = True
        else:
            query["$or"] = [
                {"suspended": {"$exists": False}},
                {"suspended": False},
            ]
    if q:
        query["$or"] = [
            {"email": {"$regex": q, "$options": "i"}},
            {"full_name": {"$regex": q, "$options": "i"}},
            {"company_name": {"$regex": q, "$options": "i"}},
        ]
    docs = (
        await db.users.find(query, {"_id": 0, "hashed_password": 0})
        .sort("created_at", -1)
        .to_list(max(1, min(limit, 500)))
    )
    return [user_to_out(d) for d in docs]


@router.get("/admin/users/{user_id}", response_model=UserOut)
async def admin_get_user(
    user_id: str, _admin: Dict[str, Any] = Depends(require_admin)
) -> UserOut:
    doc = await db.users.find_one(
        {"id": user_id}, {"_id": 0, "hashed_password": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    return user_to_out(doc)


@router.patch("/admin/users/{user_id}", response_model=UserOut)
async def admin_update_user(
    user_id: str,
    body: AdminUserPatch,
    _admin: Dict[str, Any] = Depends(require_admin),
) -> UserOut:
    update: Dict[str, Any] = {}
    if body.suspended is not None:
        update["suspended"] = body.suspended
    if body.bank_details is not None:
        update["bank_details"] = body.bank_details.model_dump(exclude_none=True)
    if body.location is not None:
        update["location"] = body.location.model_dump()
    if body.company_name is not None:
        update["company_name"] = body.company_name.strip() or None
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.users.update_one({"id": user_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    fresh = await db.users.find_one(
        {"id": user_id}, {"_id": 0, "hashed_password": 0}
    )
    return user_to_out(fresh)


# ---------------------------------------------------------------------------
# Orders / items
# ---------------------------------------------------------------------------
@router.get("/admin/orders", response_model=List[OrderOut])
async def admin_list_orders(
    status: Optional[str] = None,
    limit: int = 200,
    _admin: Dict[str, Any] = Depends(require_admin),
) -> List[OrderOut]:
    query: Dict[str, Any] = {}
    if status:
        query["status"] = status
    docs = (
        await db.orders.find(query, {"_id": 0})
        .sort("created_at", -1)
        .to_list(max(1, min(limit, 500)))
    )
    return [
        OrderOut(
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
        for d in docs
    ]


# ---------------------------------------------------------------------------
# Items moderation
# ---------------------------------------------------------------------------
@router.get("/admin/items", response_model=List[ItemOut])
async def admin_list_items(
    limit: int = 300,
    _admin: Dict[str, Any] = Depends(require_admin),
) -> List[ItemOut]:
    docs = (
        await db.items.find({}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(max(1, min(limit, 1000)))
    )
    return [item_to_out(d) for d in docs]


@router.delete("/admin/items/{item_id}")
async def admin_delete_item(
    item_id: str, _admin: Dict[str, Any] = Depends(require_admin)
) -> Dict[str, bool]:
    doc = await db.items.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.items.delete_one({"id": item_id})
    # Also clean up any wishlist entries pointing at the deleted item.
    await db.wishlists.delete_many({"item_id": item_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Platform analytics
# ---------------------------------------------------------------------------
@router.get("/admin/analytics", response_model=AdminAnalyticsOut)
async def admin_analytics(
    _admin: Dict[str, Any] = Depends(require_admin),
) -> AdminAnalyticsOut:
    # Users by role.
    total_users = await db.users.count_documents({})
    buyers = await db.users.count_documents({"role": "buyer"})
    sellers = await db.users.count_documents({"role": "seller"})
    admins = await db.users.count_documents({"role": "admin"})
    suspended = await db.users.count_documents({"suspended": True})
    pending_connect = await db.users.count_documents(
        {
            "role": "seller",
            "$or": [
                {"paystack_recipient_code": {"$in": [None, ""]}},
                {"paystack_recipient_code": {"$exists": False}},
            ],
        }
    )

    total_items = await db.items.count_documents({})
    total_orders = await db.orders.count_documents({})

    # Order aggregates (paid orders only).
    paid_pipeline = [
        {"$match": {"status": "paid"}},
        {
            "$group": {
                "_id": None,
                "count": {"$sum": 1},
                "revenue": {"$sum": "$amount_cents"},
                "fee": {"$sum": "$platform_fee_cents"},
                "net": {"$sum": "$seller_net_cents"},
            }
        },
    ]
    paid_agg = await db.orders.aggregate(paid_pipeline).to_list(1)
    if paid_agg:
        paid = paid_agg[0]
        paid_count = int(paid.get("count", 0))
        revenue = int(paid.get("revenue", 0))
        # `$sum` always populates the key (with 0) for legacy paid orders
        # that pre-date the platform-fee field — so a literal 0 is treated as
        # "missing" and we fall back to the configured BPS rate.
        fee_raw = int(paid.get("fee", 0))
        fee = fee_raw if fee_raw > 0 else (revenue * PLATFORM_FEE_BPS) // 10000
        net_raw = int(paid.get("net", 0))
        net = net_raw if net_raw > 0 else max(revenue - fee, 0)
    else:
        paid_count = revenue = fee = net = 0

    # Top sellers by paid revenue.
    top_pipeline = [
        {"$match": {"status": "paid"}},
        {
            "$group": {
                "_id": "$seller_id",
                "revenue_cents": {"$sum": "$amount_cents"},
                "orders": {"$sum": 1},
            }
        },
        {"$sort": {"revenue_cents": -1}},
        {"$limit": 5},
    ]
    top_sellers: List[Dict[str, Any]] = []
    async for row in db.orders.aggregate(top_pipeline):
        seller_id = row["_id"]
        if not seller_id:
            continue
        seller = await db.users.find_one(
            {"id": seller_id}, {"_id": 0, "company_name": 1, "full_name": 1}
        )
        name = (
            (seller.get("company_name") if seller else None)
            or (seller.get("full_name") if seller else None)
            or "Unknown seller"
        )
        top_sellers.append(
            {
                "seller_id": seller_id,
                "name": name,
                "revenue_cents": int(row.get("revenue_cents", 0)),
                "orders": int(row.get("orders", 0)),
            }
        )

    return AdminAnalyticsOut(
        total_users=total_users,
        buyers=buyers,
        sellers=sellers,
        admins=admins,
        suspended=suspended,
        total_items=total_items,
        total_orders=total_orders,
        total_paid_orders=paid_count,
        total_revenue_cents=revenue,
        total_platform_fee_cents=fee,
        total_net_to_sellers_cents=net,
        pending_connect_sellers=pending_connect,
        top_sellers=top_sellers,
    )

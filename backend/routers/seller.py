"""Seller analytics + mocked Stripe Connect onboarding.

STRIPE CONNECT IS MOCKED: sk_test_emergent is a proxy that cannot exercise the
real Stripe Connect Express onboarding API, so we synthesise an account id and
mark connect_status="active" in MongoDB. Swap _stripe_client into this file and
replace `connect_setup` to wire up real Connect once a platform Stripe key is
provisioned.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from core.config import CONNECT_MOCKED_NOTE, PLATFORM_FEE_BPS
from core.db import db
from core.security import get_current_user, require_role
from models import ConnectStatusOut, ItemAnalytics, SellerAnalyticsOut

router = APIRouter()


@router.get("/seller/analytics", response_model=SellerAnalyticsOut)
async def seller_analytics(
    user: Dict[str, Any] = Depends(get_current_user),
) -> SellerAnalyticsOut:
    await require_role("seller", user)
    items = (
        await db.items.find({"seller_id": user["id"]}, {"_id": 0}).to_list(500)
    )
    out_items: List[ItemAnalytics] = []
    total_views = total_try_ons = total_wishlists = total_orders_paid = 0
    total_revenue = total_fee = total_net = 0
    for it in items:
        views = int(it.get("views", 0))
        tos = int(it.get("try_ons", 0))
        wishes = await db.wishlists.count_documents({"item_id": it["id"]})
        paid = 0
        revenue = fee = net = 0
        async for o in db.orders.find(
            {"item_id": it["id"], "status": "paid"},
            {"_id": 0, "amount_cents": 1, "platform_fee_cents": 1, "seller_net_cents": 1},
        ):
            paid += 1
            amt = int(o.get("amount_cents", 0))
            f = int(o.get("platform_fee_cents", (amt * PLATFORM_FEE_BPS) // 10000))
            n = int(o.get("seller_net_cents", amt - f))
            revenue += amt
            fee += f
            net += n
        conversion = (paid / views) if views > 0 else 0.0
        out_items.append(
            ItemAnalytics(
                item_id=it["id"],
                name=it["name"],
                views=views,
                try_ons=tos,
                wishlists=wishes,
                orders_paid=paid,
                revenue_cents=revenue,
                platform_fee_cents=fee,
                net_cents=net,
                conversion=round(conversion, 4),
            )
        )
        total_views += views
        total_try_ons += tos
        total_wishlists += wishes
        total_orders_paid += paid
        total_revenue += revenue
        total_fee += fee
        total_net += net
    out_items.sort(key=lambda x: (-x.revenue_cents, -x.views))
    return SellerAnalyticsOut(
        total_views=total_views,
        total_try_ons=total_try_ons,
        total_wishlists=total_wishlists,
        total_orders_paid=total_orders_paid,
        total_revenue_cents=total_revenue,
        total_platform_fee_cents=total_fee,
        total_net_cents=total_net,
        connect_status=user.get("connect_status", "unstarted"),
        platform_fee_bps=PLATFORM_FEE_BPS,
        items=out_items,
    )


@router.post("/seller/connect/setup", response_model=ConnectStatusOut)
async def connect_setup(
    user: Dict[str, Any] = Depends(get_current_user),
) -> ConnectStatusOut:
    await require_role("seller", user)
    existing = user.get("stripe_account_id")
    if existing and user.get("connect_status") == "active":
        return ConnectStatusOut(
            stripe_account_id=existing,
            connect_status="active",
            note=CONNECT_MOCKED_NOTE,
        )
    # Mocked onboarding: synthesise an Express-account-style id and mark active.
    acct_id = f"acct_demo_{uuid.uuid4().hex[:14]}"
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"stripe_account_id": acct_id, "connect_status": "active"}},
    )
    return ConnectStatusOut(
        stripe_account_id=acct_id,
        connect_status="active",
        onboarding_url=None,
        note=CONNECT_MOCKED_NOTE,
    )


@router.get("/seller/connect/status", response_model=ConnectStatusOut)
async def connect_status(
    user: Dict[str, Any] = Depends(get_current_user),
) -> ConnectStatusOut:
    await require_role("seller", user)
    return ConnectStatusOut(
        stripe_account_id=user.get("stripe_account_id"),
        connect_status=user.get("connect_status", "unstarted"),
        onboarding_url=None,
        note=CONNECT_MOCKED_NOTE if user.get("connect_status") != "active" else None,
    )

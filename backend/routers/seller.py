"""Seller analytics + payout management + Stripe Connect onboarding.

STRIPE CONNECT: The `STRIPE_API_KEY` in the pod is `sk_test_emergent` — an
Emergent proxy key that cannot create real Stripe Connect Express accounts.
This file degrades gracefully:

- If `STRIPE_API_KEY` looks like a real Stripe secret key (starts with
  `sk_test_` and is longer than the proxy sentinel) AND the official `stripe`
  Python SDK is importable, we run real `Account.create` + `AccountLink.create`
  using Stripe's API.
- Otherwise we keep the demo onboarding flow (synthetic `acct_demo_…`
  account ids + immediate `connect_status=active`) so the rest of the app
  (analytics, payouts UI, dashboard) keeps working end-to-end.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import (
    CONNECT_MOCKED_NOTE,
    PLATFORM_FEE_BPS,
    STRIPE_API_KEY,
)
from core.db import db
from core.security import get_current_user, require_role
from models import (
    ConnectStatusOut,
    ItemAnalytics,
    OrderOut,
    PayoutDetailsIn,
    SellerAnalyticsOut,
    SellerCompanyIn,
    UserOut,
    user_to_out,
)

logger = logging.getLogger("drape.seller")
router = APIRouter()


# ---------------------------------------------------------------------------
# Stripe Connect helpers
# ---------------------------------------------------------------------------
def _is_real_stripe_key(key: str) -> bool:
    """Heuristically decide whether `key` is a real Stripe secret key.

    The Emergent proxy uses `sk_test_emergent` (15 chars). Real Stripe test
    secret keys look like `sk_test_51N...` and are typically 80+ chars long.
    """
    return bool(
        key
        and key.startswith(("sk_test_", "sk_live_"))
        and key != "sk_test_emergent"
        and len(key) > 30
    )


def _try_import_stripe():
    """Lazy import so the module is optional."""
    try:
        import stripe  # type: ignore

        stripe.api_key = STRIPE_API_KEY
        return stripe
    except ImportError:
        return None


class _OnboardLinkIn(BaseModel):
    return_url: Optional[str] = None  # where Stripe sends the seller after KYC


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------
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
            f = int(o.get("platform_fee_cents") or (amt * PLATFORM_FEE_BPS) // 10000)
            n = int(o.get("seller_net_cents") or max(amt - f, 0))
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


# ---------------------------------------------------------------------------
# Seller orders (full history including pending) — for the seller dashboard
# ---------------------------------------------------------------------------
@router.get("/seller/orders", response_model=List[OrderOut])
async def seller_orders(
    status: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[OrderOut]:
    await require_role("seller", user)
    query: Dict[str, Any] = {"seller_id": user["id"]}
    if status:
        query["status"] = status
    docs = (
        await db.orders.find(query, {"_id": 0})
        .sort("created_at", -1)
        .to_list(200)
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
# Payout details (bank + M-Pesa)
# ---------------------------------------------------------------------------
@router.patch("/seller/payout-details", response_model=UserOut)
async def update_payout_details(
    body: PayoutDetailsIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> UserOut:
    await require_role("seller", user)
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No payout fields supplied")
    # Persist the merged structure rather than overwriting unset keys.
    existing = (user.get("bank_details") or {}).copy()
    for k, v in payload.items():
        if v is None or (isinstance(v, str) and not v.strip()):
            existing.pop(k, None)
        else:
            existing[k] = v.strip() if isinstance(v, str) else v
    await db.users.update_one(
        {"id": user["id"]}, {"$set": {"bank_details": existing}}
    )
    fresh = await db.users.find_one(
        {"id": user["id"]}, {"_id": 0, "hashed_password": 0}
    )
    return user_to_out(fresh)


@router.patch("/seller/profile", response_model=UserOut)
async def update_seller_profile(
    body: SellerCompanyIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> UserOut:
    """Update brand/atelier metadata (company name + location)."""
    await require_role("seller", user)
    payload = body.model_dump(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fields supplied")
    set_doc: Dict[str, Any] = {}
    if "company_name" in payload and payload["company_name"] is not None:
        set_doc["company_name"] = payload["company_name"].strip()
    if "location" in payload and payload["location"] is not None:
        set_doc["location"] = payload["location"]
    if not set_doc:
        raise HTTPException(status_code=400, detail="No fields supplied")
    await db.users.update_one({"id": user["id"]}, {"$set": set_doc})
    fresh = await db.users.find_one(
        {"id": user["id"]}, {"_id": 0, "hashed_password": 0}
    )
    return user_to_out(fresh)


# ---------------------------------------------------------------------------
# Stripe Connect (real if a real platform key is present, mocked otherwise)
# ---------------------------------------------------------------------------
@router.post("/seller/connect/setup", response_model=ConnectStatusOut)
async def connect_setup(
    body: Optional[_OnboardLinkIn] = None,
    user: Dict[str, Any] = Depends(get_current_user),
) -> ConnectStatusOut:
    await require_role("seller", user)
    existing_acct = user.get("stripe_account_id")
    if existing_acct and user.get("connect_status") == "active":
        return ConnectStatusOut(
            stripe_account_id=existing_acct,
            connect_status="active",
            note=None,
        )

    # ----- Real Stripe path -----
    if _is_real_stripe_key(STRIPE_API_KEY):
        stripe = _try_import_stripe()
        if stripe is None:
            raise HTTPException(
                status_code=500,
                detail=(
                    "Stripe Python SDK not installed. Run `pip install \"stripe>=10\"` "
                    "in the backend container."
                ),
            )
        try:
            if not existing_acct:
                country = "KE"
                if user.get("location"):
                    # Best-effort: ISO-3166 alpha-2 for Kenya, fallback "US".
                    country_name = (user["location"].get("country") or "").lower()
                    country = "KE" if "kenya" in country_name else "US"
                acct = stripe.Account.create(
                    type="express",
                    country=country,
                    email=user["email"],
                    capabilities={
                        "card_payments": {"requested": True},
                        "transfers": {"requested": True},
                    },
                    business_profile={
                        "name": user.get("company_name") or user.get("full_name"),
                        "product_description": "Apparel atelier on Drape",
                    },
                )
                existing_acct = acct.id
                await db.users.update_one(
                    {"id": user["id"]},
                    {
                        "$set": {
                            "stripe_account_id": acct.id,
                            "connect_status": "pending",
                        }
                    },
                )
            return_url = (body.return_url if body else None) or "https://example.com/connect/return"
            link = stripe.AccountLink.create(
                account=existing_acct,
                refresh_url=return_url,
                return_url=return_url,
                type="account_onboarding",
            )
            return ConnectStatusOut(
                stripe_account_id=existing_acct,
                connect_status="pending",
                onboarding_url=link.url,
                note="Live Stripe Connect onboarding — finish KYC to enable payouts.",
            )
        except Exception as exc:  # pragma: no cover — network errors etc.
            logger.exception("Stripe Connect setup failed")
            raise HTTPException(status_code=502, detail=f"Stripe error: {exc}")

    # ----- Demo / proxy fallback -----
    acct_id = existing_acct or f"acct_demo_{uuid.uuid4().hex[:14]}"
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
    acct_id = user.get("stripe_account_id")
    status_ = user.get("connect_status", "unstarted")

    # If a real Stripe key is present and we have an account id, refresh
    # status from Stripe so the UI reflects KYC completion.
    if _is_real_stripe_key(STRIPE_API_KEY) and acct_id and status_ != "active":
        stripe = _try_import_stripe()
        if stripe is not None:
            try:
                acct = stripe.Account.retrieve(acct_id)
                if acct.charges_enabled and acct.payouts_enabled:
                    status_ = "active"
                elif (acct.requirements or {}).get("currently_due"):
                    status_ = "pending"
                await db.users.update_one(
                    {"id": user["id"]}, {"$set": {"connect_status": status_}}
                )
            except Exception:  # pragma: no cover
                logger.exception("Stripe Account.retrieve failed")

    note: Optional[str] = None
    if not _is_real_stripe_key(STRIPE_API_KEY) and status_ != "active":
        note = CONNECT_MOCKED_NOTE
    elif _is_real_stripe_key(STRIPE_API_KEY) and status_ != "active":
        note = "Finish Stripe Connect onboarding to enable payouts."
    return ConnectStatusOut(
        stripe_account_id=acct_id,
        connect_status=status_,
        onboarding_url=None,
        note=note,
    )

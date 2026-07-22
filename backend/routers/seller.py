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
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
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
    FulfillmentIn,
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
# Payout transaction history — one row per paid order, per the buyer's request
# for "most accurate" granularity (no weekly aggregation).
# ---------------------------------------------------------------------------
@router.get("/seller/banks")
async def seller_banks(
    country: str = "kenya",
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return the list of banks + mobile-money providers Paystack
    supports in the given country, so the seller's Payout Account
    screen can render a searchable dropdown. Cached in the client for
    a short window — Paystack updates the list rarely.
    """
    from core import paystack

    await require_role("seller", user)
    country = country.strip().lower() or "kenya"
    try:
        banks = await paystack.list_banks(country)
    except paystack.PaystackError as e:
        raise HTTPException(status_code=502, detail=f"Paystack error: {e}") from e
    # Only expose the fields the client actually needs.
    slim = [
        {
            "code": b.get("code"),
            "name": b.get("name"),
            "slug": b.get("slug"),
            "type": b.get("type"),  # "nuban" | "mobile_money" | "basa" | ...
            "currency": b.get("currency"),
        }
        for b in banks
        if b.get("code") and b.get("name")
    ]
    return {"country": country, "banks": slim}


@router.post("/seller/payout-account")
async def seller_set_payout_account(
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Create / update the seller's Paystack Subaccount + Transfer
    Recipient. Body:
      { bank_code, bank_name, account_number, account_type?,
        country? = 'kenya' }
    """
    from core import paystack

    await require_role("seller", user)
    bank_code = str(body.get("bank_code") or "").strip()
    bank_name = str(body.get("bank_name") or "").strip()
    account_number = str(body.get("account_number") or "").strip()
    account_type = str(body.get("account_type") or "basa").strip().lower()
    country = str(body.get("country") or "kenya").strip().lower()
    if not bank_code or not account_number:
        raise HTTPException(status_code=400, detail="bank_code and account_number are required")

    # Verify the account belongs to a real name — Paystack rejects
    # invalid pairs so the seller can't accidentally set someone
    # else's account. Mobile money numbers skip resolve on Paystack.
    resolved_name: Optional[str] = None
    if account_type not in {"mobile_money"}:
        try:
            resolved = await paystack.resolve_account(
                account_number=account_number, bank_code=bank_code
            )
            resolved_name = resolved.get("account_name")
        except paystack.PaystackError as e:
            raise HTTPException(status_code=400, detail=f"Bank verification failed: {e}") from e

    display_name = resolved_name or user.get("full_name") or user.get("email") or "Oromona seller"

    subaccount: Dict[str, Any] = {}
    recipient: Dict[str, Any] = {}
    subaccount_error: Optional[str] = None
    recipient_error: Optional[str] = None

    # Create Subaccount (stores bank details on Paystack for the
    # seller's business identity — useful for reporting even though
    # we don't split at charge time).
    try:
        subaccount = await paystack.create_subaccount(
            business_name=user.get("company_name") or display_name,
            settlement_bank=bank_code,
            account_number=account_number,
            primary_contact_email=user.get("email"),
        )
    except paystack.PaystackError as e:
        subaccount_error = str(e)

    # Create Transfer Recipient (the actual push target for payouts).
    try:
        recipient_type = account_type if account_type in {"mobile_money", "nuban", "ghipss", "basa"} else "basa"
        recipient = await paystack.create_transfer_recipient(
            type_=recipient_type,
            name=display_name,
            account_number=account_number,
            bank_code=bank_code,
            currency="KES" if country == "kenya" else "NGN",
        )
    except paystack.PaystackError as e:
        recipient_error = str(e)

    update: Dict[str, Any] = {
        "payout_account": {
            "country": country,
            "bank_code": bank_code,
            "bank_name": bank_name,
            "account_number_last4": account_number[-4:],
            "account_holder": display_name,
            "account_type": account_type,
            "updated_at": datetime.now(timezone.utc),
        }
    }
    if subaccount.get("subaccount_code"):
        update["paystack_subaccount_code"] = subaccount["subaccount_code"]
    if recipient.get("recipient_code"):
        update["paystack_recipient_code"] = recipient["recipient_code"]

    await db.users.update_one({"id": user["id"]}, {"$set": update})

    ok = bool(recipient.get("recipient_code"))
    return {
        "ok": ok,
        "subaccount_code": subaccount.get("subaccount_code"),
        "recipient_code": recipient.get("recipient_code"),
        "account_holder": display_name,
        "subaccount_error": subaccount_error,
        "recipient_error": recipient_error,
    }


@router.get("/seller/payout-account")
async def seller_get_payout_account(
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    await require_role("seller", user)
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or {}
    return {
        "payout_account": fresh.get("payout_account"),
        "recipient_code": fresh.get("paystack_recipient_code"),
        "subaccount_code": fresh.get("paystack_subaccount_code"),
        "has_recipient": bool(fresh.get("paystack_recipient_code")),
    }


@router.get("/seller/payouts")
async def seller_payouts(
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return every paid order for this seller as a payout transaction row.

    Each row carries gross / platform_fee / net (using stored fields where
    available so historical fee changes don't retroactively rewrite numbers).
    Summary totals at the top mirror what the seller would actually see paid
    out, in their listing currency.
    """
    await require_role("seller", user)
    docs = (
        await db.orders.find(
            {"seller_id": user["id"], "status": "paid"}, {"_id": 0}
        )
        .sort("created_at", -1)
        .to_list(500)
    )
    rows: List[Dict[str, Any]] = []
    gross_total = 0
    fee_total = 0
    net_total = 0
    for d in docs:
        amount = int(d.get("amount_cents", 0))
        fee = int(d.get("platform_fee_cents") or (amount * PLATFORM_FEE_BPS) // 10000)
        net = int(d.get("seller_net_cents") or max(amount - fee, 0))
        gross_total += amount
        fee_total += fee
        net_total += net
        rows.append(
            {
                "id": d["id"],
                "item_id": d.get("item_id"),
                "item_name": d.get("item_name", ""),
                "size": d.get("size", ""),
                "color": d.get("color"),
                "currency": d.get("currency", "USD"),
                "amount_cents": amount,
                "platform_fee_cents": fee,
                "seller_net_cents": net,
                "status": d.get("status", "paid"),
                # Mirror the order created_at so the UI can render an ISO date.
                "created_at": d["created_at"],
            }
        )
    return {
        "platform_fee_bps": PLATFORM_FEE_BPS,
        "connect_status": user.get("connect_status", "unstarted"),
        "payouts": rows,
        "totals": {
            "count": len(rows),
            "gross_cents": gross_total,
            "platform_fee_cents": fee_total,
            "net_cents": net_total,
        },
    }



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
                        "product_description": "Apparel atelier on Oromona",
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


# ---------------------------------------------------------------------------
# Fulfillment workflow
# ---------------------------------------------------------------------------
# State machine (any allowed transition; we never auto-revert):
#   paid               → in_fulfillment (action="acknowledge")
#   paid|in_fulfillment → shipped       (action="ship",      requires tracking_number)
#   shipped            → delivered      (action="deliver")
# ---------------------------------------------------------------------------
@router.post("/seller/orders/{order_id}/fulfillment")
async def update_fulfillment(
    order_id: str,
    body: FulfillmentIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    from datetime import datetime as _dt, timedelta, timezone as _tz

    from core import escrow as escrow_mod

    await require_role("seller", user)
    order = await db.orders.find_one({"id": order_id, "seller_id": user["id"]})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    current = order.get("status") or "pending"
    update: Dict[str, Any] = {}
    now = _dt.now(_tz.utc)

    if body.action == "acknowledge":
        if current != "paid":
            raise HTTPException(
                status_code=400,
                detail=f"Cannot acknowledge from status '{current}'",
            )
        update["status"] = "in_fulfillment"
        update["acknowledged_at"] = now
    elif body.action == "ship":
        if current not in ("paid", "in_fulfillment"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot ship from status '{current}'",
            )
        if not body.tracking_number or not body.tracking_number.strip():
            raise HTTPException(
                status_code=400,
                detail="A tracking number is required to mark an order as shipped",
            )
        update["status"] = "shipped"
        update["tracking_number"] = body.tracking_number.strip()
        if body.tracking_url:
            url = body.tracking_url.strip()
            update["tracking_url"] = url
            # Precompute carrier so buyers see it immediately even
            # before the enrich helper runs.
            from core.carriers import detect_carrier
            c = detect_carrier(url)
            if c:
                update["carrier"] = c
        update["shipped_at"] = now
        # Seller-picked ETA (1-5 business days). We compute a concrete
        # ISO timestamp (skipping weekends approximately) so the buyer
        # sees a "should arrive by <date>" line.
        if body.estimated_delivery_days:
            days = max(1, min(5, int(body.estimated_delivery_days)))
            update["estimated_delivery_days"] = days
            # Naive calendar-days ETA — refined "business days only"
            # can be added if buyers ask, but for KE couriers ±1d
            # accuracy is fine.
            update["estimated_delivery_at"] = now + timedelta(days=days)
    elif body.action == "deliver":
        if current not in ("shipped", "in_fulfillment"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot mark delivered from status '{current}'",
            )
        # Escrow release timer starts here — buyer has 48h to confirm
        # or dispute before funds auto-release to the seller.
        result = await escrow_mod.start_delivery_window(order_id)
        update["status"] = "delivered"
        update["delivered_at"] = result["delivered_at"]
        update["escrow_release_at"] = result["escrow_release_at"]

    if body.note:
        update["fulfillment_note"] = body.note.strip()

    await db.orders.update_one({"id": order_id}, {"$set": update})
    fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return {"status": "ok", "order": fresh}


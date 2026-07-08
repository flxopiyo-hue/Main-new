"""Drape Premium subscription endpoints (Paystack-backed).

Endpoints exposed under ``/api/subs/*``:

    POST /subs/checkout       — start Paystack hosted flow, returns URL
    GET  /subs/verify         — client polls after redirect back
    POST /subs/cancel         — set cancel_at_period_end=true
    POST /subs/resume         — undo a pending cancellation
    GET  /subs/me             — full subscription + gating snapshot
    POST /subs/webhook        — Paystack event ingestion (no auth)

Gating (7 try-ons / week + 2 profiles for Free; unlimited + 10 profiles
for Premium) is enforced elsewhere (try-on router + profiles router)
via the helpers in :mod:`core.gating` — this file just owns Paystack
plumbing.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from core import paystack
from core.config import (
    FRONTEND_PUBLIC_URL,
    PAYSTACK_SECRET_KEY,
    PREMIUM_PLAN_AMOUNT_KOBO,
    PREMIUM_PLAN_NAME,
    PREMIUM_PLAN_TRIAL_DAYS,
)
from core.db import db
from core.gating import gate_snapshot
from core.security import get_current_user

router = APIRouter(prefix="/api/subs", tags=["subscriptions"])
logger = logging.getLogger("aurafit.subs")


# ---------------------------------------------------------------------------
# Startup plan bootstrap — called from server.py once
# ---------------------------------------------------------------------------


async def ensure_premium_plan() -> Optional[str]:
    """Idempotent: creates the Drape Premium plan on Paystack if it
    doesn't exist yet. Returns the plan_code that other endpoints can
    quote. Safe to call on every boot.

    We match by exact ``name`` since Paystack plans don't have a
    natural business key. Existing plans that mismatch price/trial are
    NOT rewritten — Paystack disallows in-place edits on billed plans.
    """
    if not PAYSTACK_SECRET_KEY:
        logger.warning("PAYSTACK_SECRET_KEY unset — Premium checkout disabled")
        return None
    try:
        existing = await paystack.list_plans()
        for p in existing:
            if p.get("name") == PREMIUM_PLAN_NAME:
                logger.info("paystack: reusing plan %s", p.get("plan_code"))
                return p["plan_code"]
        created = await paystack.create_plan(
            name=PREMIUM_PLAN_NAME,
            amount_kobo=PREMIUM_PLAN_AMOUNT_KOBO,
            interval="monthly",
            currency="KES",
            trial_days=PREMIUM_PLAN_TRIAL_DAYS,
        )
        logger.info("paystack: created plan %s", created.get("plan_code"))
        return created["plan_code"]
    except paystack.PaystackError as e:
        logger.warning("paystack ensure_premium_plan failed: %s", e)
        return None


# Cached plan_code so we don't hit Paystack on every /checkout call. Set
# from server.py on startup.
_PLAN_CODE: Optional[str] = None


def set_plan_code(code: Optional[str]) -> None:
    global _PLAN_CODE
    _PLAN_CODE = code


def get_plan_code() -> Optional[str]:
    return _PLAN_CODE


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class CheckoutOut(BaseModel):
    authorization_url: str
    reference: str


class SubscriptionState(BaseModel):
    tier: str
    status: Optional[str] = None
    current_period_end: Optional[datetime] = None
    trial_end: Optional[datetime] = None
    cancel_at_period_end: bool = False
    plan_amount_kes: float = 199.0
    trial_days: int = PREMIUM_PLAN_TRIAL_DAYS


class MeOut(BaseModel):
    subscription: SubscriptionState
    gate: Dict[str, Any]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/checkout", response_model=CheckoutOut)
async def checkout(user: Dict[str, Any] = Depends(get_current_user)) -> CheckoutOut:
    """Start a Paystack hosted checkout session. Client redirects to
    ``authorization_url`` and Paystack redirects back to
    ``FRONTEND_PUBLIC_URL/subscription/success?reference=...`` after
    the buyer pays (or cancels). The ``/verify`` endpoint completes the
    flow and flips the user to premium.
    """
    if user.get("subscription_tier") == "premium" and user.get("subscription_status") in {
        "active",
        "trialing",
    }:
        raise HTTPException(status_code=400, detail="Already subscribed")
    plan_code = get_plan_code()
    if not plan_code:
        # Try one more time in case the boot task raced — this keeps the
        # error message actionable rather than a generic 500.
        plan_code = await ensure_premium_plan()
        set_plan_code(plan_code)
    if not plan_code:
        raise HTTPException(
            status_code=503,
            detail="Payments temporarily unavailable — please retry in a moment",
        )
    reference = f"drape_{user['id'][:8]}_{uuid.uuid4().hex[:12]}"
    callback_url = f"{FRONTEND_PUBLIC_URL.rstrip('/')}/subscription/success"
    try:
        data = await paystack.initialize_transaction(
            email=user["email"],
            amount_kobo=PREMIUM_PLAN_AMOUNT_KOBO,
            plan_code=plan_code,
            callback_url=callback_url,
            reference=reference,
            metadata={"user_id": user["id"], "purpose": "premium_subscription"},
        )
    except paystack.PaystackError as e:
        raise HTTPException(status_code=502, detail=f"Paystack error: {e}") from e

    # Persist the reference so /verify can double-check the user owns
    # this transaction (defence-in-depth against replayed reference ids).
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {
                "pending_paystack_reference": data["reference"],
                "pending_paystack_reference_at": datetime.now(timezone.utc),
            }
        },
    )
    return CheckoutOut(authorization_url=data["authorization_url"], reference=data["reference"])


@router.get("/verify")
async def verify(
    reference: str,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Called by the /subscription/success screen after Paystack
    redirects the user back. Optimistically upgrades tier=premium so
    the UI unlocks immediately — the webhook then fills in the
    subscription_code + next_payment_date for the full picture.
    """
    if user.get("pending_paystack_reference") not in (None, reference):
        # Reference mismatch — either someone else's payment or a
        # replay. Refuse to touch the user's subscription.
        raise HTTPException(status_code=400, detail="Reference does not match")
    try:
        data = await paystack.verify_transaction(reference)
    except paystack.PaystackError as e:
        raise HTTPException(status_code=502, detail=f"Paystack error: {e}") from e

    status_ = data.get("status")
    if status_ != "success":
        raise HTTPException(
            status_code=400, detail=f"Payment {status_ or 'unknown'} — not upgrading"
        )

    customer_code = (data.get("customer") or {}).get("customer_code")
    update: Dict[str, Any] = {
        "subscription_tier": "premium",
        "subscription_status": "trialing",
        "cancel_at_period_end": False,
        "pending_paystack_reference": None,
        "pending_paystack_reference_at": None,
    }
    if customer_code:
        update["paystack_customer_code"] = customer_code
    # Compute a rough trial_end / current_period_end so the UI has
    # something to show before the webhook lands.
    now = datetime.now(timezone.utc)
    trial_end = now + timedelta(days=PREMIUM_PLAN_TRIAL_DAYS)
    update["trial_end"] = trial_end
    update["current_period_end"] = trial_end
    await db.users.update_one({"id": user["id"]}, {"$set": update})

    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return {
        "tier": "premium",
        "status": "trialing",
        "trial_end": trial_end.isoformat(),
        "user": {
            "id": fresh["id"],
            "subscription_tier": fresh.get("subscription_tier"),
            "subscription_status": fresh.get("subscription_status"),
        },
    }


@router.post("/cancel")
async def cancel(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Cancel-at-period-end. The buyer keeps Premium features until
    ``current_period_end`` and then rolls off to Free automatically
    (when the webhook fires ``subscription.not_renew`` / no charge).
    """
    if user.get("subscription_tier") != "premium":
        raise HTTPException(status_code=400, detail="No active premium subscription")
    sub_code = user.get("paystack_subscription_code")
    if sub_code:
        # Paystack's disable endpoint needs both the code and a
        # per-subscription email_token — fetch it fresh in case the
        # cached copy expired.
        try:
            sub = await paystack.fetch_subscription(sub_code)
            token = sub.get("email_token")
            if token:
                await paystack.disable_subscription(code=sub_code, email_token=token)
        except paystack.PaystackError as e:
            # Log but don't fail — the client-side flag flip below
            # still gives the buyer the "cancels at period end" UX.
            logger.warning("paystack disable failed for %s: %s", sub_code, e)
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"cancel_at_period_end": True}},
    )
    return {"cancel_at_period_end": True}


@router.post("/resume")
async def resume(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Un-cancel: buyer changed their mind before the period ended."""
    if not user.get("cancel_at_period_end"):
        raise HTTPException(status_code=400, detail="No pending cancellation")
    sub_code = user.get("paystack_subscription_code")
    if sub_code:
        try:
            sub = await paystack.fetch_subscription(sub_code)
            token = sub.get("email_token")
            if token:
                await paystack.enable_subscription(code=sub_code, email_token=token)
        except paystack.PaystackError as e:
            logger.warning("paystack enable failed for %s: %s", sub_code, e)
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"cancel_at_period_end": False}},
    )
    return {"cancel_at_period_end": False}


@router.get("/me", response_model=MeOut)
async def me(user: Dict[str, Any] = Depends(get_current_user)) -> MeOut:
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or user
    tier = fresh.get("subscription_tier") or "free"
    state = SubscriptionState(
        tier=tier,
        status=fresh.get("subscription_status"),
        current_period_end=fresh.get("current_period_end"),
        trial_end=fresh.get("trial_end"),
        cancel_at_period_end=bool(fresh.get("cancel_at_period_end", False)),
    )
    gate = await gate_snapshot(fresh)
    return MeOut(subscription=state, gate=gate)


# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------


@router.post("/webhook")
async def webhook(
    request: Request,
    x_paystack_signature: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    """Receives every Paystack event. We handle:

        subscription.create      → attach code + go trialing
        subscription.disable     → user opted out on Paystack UI
        subscription.not_renew   → cancel_at_period_end
        charge.success           → renew: bump current_period_end
        invoice.payment_failed   → past_due → downgrade to free
        subscription.expiring_cards / etc → ignored

    Signature verification uses the same SECRET key (Paystack quirk).
    """
    raw = await request.body()
    if not paystack.verify_webhook_signature(raw, x_paystack_signature):
        raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    event = payload.get("event") or ""
    data = payload.get("data") or {}
    customer = data.get("customer") or {}
    customer_code = customer.get("customer_code")
    email = customer.get("email")

    # Match either by stored paystack_customer_code (most reliable) or by
    # email (first-charge, before customer_code lands).
    query: Dict[str, Any] = {}
    if customer_code:
        query["paystack_customer_code"] = customer_code
    user_doc = await db.users.find_one(query) if query else None
    if user_doc is None and email:
        user_doc = await db.users.find_one({"email": email})
    if user_doc is None:
        logger.info("paystack webhook %s: no matching user (%s)", event, email)
        return {"status": "ignored"}

    update: Dict[str, Any] = {}
    if event == "subscription.create":
        update = {
            "paystack_subscription_code": data.get("subscription_code"),
            "subscription_status": data.get("status") or "active",
            "subscription_tier": "premium",
            "cancel_at_period_end": False,
        }
        if data.get("next_payment_date"):
            update["current_period_end"] = _to_dt(data["next_payment_date"])
    elif event == "subscription.not_renew":
        # Buyer disabled auto-renew from Paystack's UI — keep tier=premium
        # until the current period ends, then flip via subscription.disable.
        update = {"cancel_at_period_end": True}
    elif event == "subscription.disable":
        # Period ended (or admin-forced disable): downgrade to Free.
        # ``data.status`` is "complete" (natural expiry) or "cancelled".
        update = {
            "subscription_tier": "free",
            "subscription_status": "canceled",
            "cancel_at_period_end": False,
        }
    elif event == "charge.success":
        # A renewal — extend the period.
        if data.get("plan"):
            update["subscription_status"] = "active"
            if data.get("next_payment_date"):
                update["current_period_end"] = _to_dt(data["next_payment_date"])
    elif event == "invoice.payment_failed":
        update = {
            "subscription_status": "past_due",
            # Don't downgrade yet — Paystack gives a grace window.
        }

    if update:
        await db.users.update_one({"id": user_doc["id"]}, {"$set": update})
    return {"status": "ok"}


def _to_dt(v: Any) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v
    if isinstance(v, str):
        try:
            # Paystack returns ISO 8601 with Z suffix
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None

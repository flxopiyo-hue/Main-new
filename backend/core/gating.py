"""Free vs Premium feature-gating helpers.

Free tier:
  • 7 try-ons per rolling 7-day window
  • Up to 2 body profiles
  • Multi-angle try-ons ARE available (only the weekly cap gates them)

Premium tier:
  • Unlimited try-ons
  • Up to 10 body profiles
  • Priority support + early-access to new features

Callers use :func:`assert_can_tryon` and :func:`assert_can_add_profile`
before mutating state. Both raise :class:`fastapi.HTTPException(402)`
with a JSON body the client uses to render the paywall.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from fastapi import HTTPException

from core.config import (
    FREE_MAX_PROFILES,
    FREE_STYLIST_SESSIONS_PER_WEEK,
    FREE_TRYONS_PER_WEEK,
    PREMIUM_MAX_PROFILES,
)
from core.db import db


def is_premium(user_doc: Dict[str, Any]) -> bool:
    """A user is Premium iff their tier is premium AND status is active
    OR trialing. Past-due / canceled users fall back to Free even before
    the webhook flips the tier — this keeps the paywall consistent with
    the buyer's real access.

    One-time (M-Pesa) premium passes have no auto-renewal — they lapse
    the moment ``current_period_end`` is in the past.
    """
    if user_doc.get("subscription_tier") != "premium":
        return False
    status = user_doc.get("subscription_status")
    if status not in {"active", "trialing", None}:  # None handled optimistically post-verify
        return False
    if user_doc.get("premium_one_time"):
        end = user_doc.get("current_period_end")
        if isinstance(end, str):
            try:
                end = datetime.fromisoformat(end.replace("Z", "+00:00"))
            except ValueError:
                end = None
        if isinstance(end, datetime):
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
            return end > datetime.now(timezone.utc)
        return False
    return True


async def _tryons_this_week(user_id: str) -> int:
    since = datetime.now(timezone.utc) - timedelta(days=7)
    return await db.tryons.count_documents(
        {"user_id": user_id, "created_at": {"$gte": since}}
    )


async def _profiles_count(user_id: str) -> int:
    """Count body profiles owned by this buyer (`self` doesn't count —
    every buyer has an implicit self profile).
    """
    return await db.body_profiles.count_documents({"user_id": user_id})


async def gate_snapshot(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    """Return the shape the client uses to render the paywall + gauges."""
    premium = is_premium(user_doc)
    tryons = await _tryons_this_week(user_doc["id"])
    profiles = await _profiles_count(user_doc["id"])
    return {
        "premium": premium,
        "tryons_used_this_week": tryons,
        "tryons_limit": -1 if premium else FREE_TRYONS_PER_WEEK,
        "tryons_remaining": -1 if premium else max(0, FREE_TRYONS_PER_WEEK - tryons),
        "profiles_count": profiles,
        "profiles_limit": PREMIUM_MAX_PROFILES if premium else FREE_MAX_PROFILES,
        # Multi-angle try-ons are available on every tier — the only
        # per-tier gate is the weekly cap and the profile cap.
        "multi_angle_allowed": True,
    }


class PaywallError(HTTPException):
    """Custom exception the FE detects via `.status_code == 402` to
    surface the paywall modal instead of a generic error toast."""

    def __init__(self, feature: str, message: str) -> None:
        super().__init__(
            status_code=402,
            detail={
                "code": "paywall",
                "feature": feature,
                "message": message,
                "upgrade_url": "/subscription",
            },
        )


async def assert_can_tryon(user_doc: Dict[str, Any]) -> None:
    if is_premium(user_doc):
        return
    used = await _tryons_this_week(user_doc["id"])
    if used >= FREE_TRYONS_PER_WEEK:
        raise PaywallError(
            feature="tryon_weekly_limit",
            message=f"You've used all {FREE_TRYONS_PER_WEEK} try-ons this week. Upgrade to Premium for unlimited.",
        )


async def assert_can_add_profile(user_doc: Dict[str, Any]) -> None:
    premium = is_premium(user_doc)
    limit = PREMIUM_MAX_PROFILES if premium else FREE_MAX_PROFILES
    count = await _profiles_count(user_doc["id"])
    if count >= limit:
        raise PaywallError(
            feature="profile_limit",
            message=(
                f"Premium supports up to {PREMIUM_MAX_PROFILES} profiles."
                if premium
                else f"Free supports {FREE_MAX_PROFILES} profiles. Upgrade to Premium for {PREMIUM_MAX_PROFILES}."
            ),
        )


async def _stylist_sessions_this_week(user_id: str) -> int:
    since = datetime.now(timezone.utc) - timedelta(days=7)
    return await db.stylist_sessions.count_documents(
        {"user_id": user_id, "created_at": {"$gte": since}}
    )


async def stylist_sessions_remaining(user_id: str) -> int:
    used = await _stylist_sessions_this_week(user_id)
    return max(0, FREE_STYLIST_SESSIONS_PER_WEEK - used)


async def assert_can_start_stylist_session(user_doc: Dict[str, Any]) -> None:
    """Gate NEW AI-Stylist chat sessions (2/week Free, unlimited Premium)."""
    if is_premium(user_doc):
        return
    used = await _stylist_sessions_this_week(user_doc["id"])
    if used >= FREE_STYLIST_SESSIONS_PER_WEEK:
        raise PaywallError(
            feature="stylist_weekly_limit",
            message=(
                f"You've used your {FREE_STYLIST_SESSIONS_PER_WEEK} free stylist "
                "sessions this week. Upgrade to Premium for unlimited styling."
            ),
        )

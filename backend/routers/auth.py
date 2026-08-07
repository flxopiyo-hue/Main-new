"""Auth routes: register, login, /auth/me, preferences, password reset."""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException

from core.config import DEFAULT_CURRENCY, JWT_ALGORITHM, JWT_SECRET
from core.db import db
from core.security import (
    get_current_user,
    hash_password,
    make_jwt,
    verify_password,
)
from models import (
    AuthOut,
    ForgotPasswordIn,
    LoginIn,
    PreferencesIn,
    RegisterIn,
    ResetPasswordIn,
    UserOut,
    user_to_out,
)

logger = logging.getLogger("oromona.auth")
router = APIRouter()

# ---------------------------------------------------------------------------
# Password reset — Resend transactional email
# ---------------------------------------------------------------------------
_RESET_TOKEN_TTL_MIN = 30  # 30 minutes; tokens self-invalidate via `exp`.
_RESET_TOKEN_AUD = "oromona.password-reset"

# Public web URL for reset links — env-only (backend/.env, rewritten at
# deploy time); no source fallback so deploy config stays authoritative.
_APP_WEB_URL = os.environ.get("APP_WEB_URL", "").rstrip("/")
_APP_DEEPLINK_SCHEME = os.environ.get("APP_DEEPLINK_SCHEME", "oromona").strip() or "oromona"


def _mint_reset_token(user_id: str) -> str:
    """Signed short-lived JWT bound to a specific user and audience."""
    payload = {
        "sub": user_id,
        "aud": _RESET_TOKEN_AUD,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=_RESET_TOKEN_TTL_MIN),
        "iat": datetime.now(timezone.utc),
        "typ": "pwd-reset",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _verify_reset_token(token: str) -> str:
    """Return the user_id embedded in a reset token, or raise HTTPException."""
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            audience=_RESET_TOKEN_AUD,
        )
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(
            status_code=400,
            detail="This reset link has expired. Please request a new one.",
        ) from e
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=400, detail="Invalid reset link.") from e
    if payload.get("typ") != "pwd-reset":
        raise HTTPException(status_code=400, detail="Invalid reset link.")
    uid = payload.get("sub")
    if not uid:
        raise HTTPException(status_code=400, detail="Invalid reset link.")
    return uid


def _is_seller_complete(doc: Dict[str, Any]) -> bool:
    """A seller account can enter the seller portal only when it carries the
    minimum data we require to fulfill orders: a company name + a city/
    country location. Bank/M-Pesa details are encouraged but optional (the
    UI nudges them through Settings)."""
    if not (doc.get("company_name") or "").strip():
        return False
    loc = doc.get("location") or {}
    return bool((loc.get("city") or "").strip() and (loc.get("country") or "").strip())


@router.post("/auth/register", response_model=AuthOut)
async def register(body: RegisterIn) -> AuthOut:
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Role-specific validation.
    resolved_age: Optional[int] = body.age
    dob_iso: Optional[str] = None
    gender = body.gender
    if body.role == "buyer":
        # Buyers must supply a gender + either an age or DOB.
        if not gender:
            raise HTTPException(status_code=400, detail="Gender is required for buyers")
        if body.dob:
            try:
                dob_date = datetime.strptime(body.dob, "%Y-%m-%d").date()
            except ValueError:
                raise HTTPException(status_code=400, detail="dob must be YYYY-MM-DD")
            today = datetime.now(timezone.utc).date()
            years = today.year - dob_date.year - (
                (today.month, today.day) < (dob_date.month, dob_date.day)
            )
            if years < 13:
                raise HTTPException(
                    status_code=400, detail="You must be at least 13 years old"
                )
            if years > 120:
                raise HTTPException(
                    status_code=400, detail="Please enter a valid date of birth"
                )
            resolved_age = years
            dob_iso = body.dob
        if resolved_age is None:
            raise HTTPException(status_code=400, detail="age or dob is required")
    elif body.role == "seller":
        # Sellers don't need demographics. Company name is required; bank or
        # M-Pesa details are recommended but optional at signup (admin can chase
        # them up later via /api/admin/users/{id} or Connect onboarding).
        if not body.company_name or not body.company_name.strip():
            raise HTTPException(
                status_code=400, detail="Company name is required for sellers"
            )
        if not body.location:
            raise HTTPException(
                status_code=400, detail="Location (city, country) is required for sellers"
            )
        # Sellers leave demographic fields blank.
        resolved_age = None
        dob_iso = None
        gender = None
    elif body.role == "courier":
        # Boda riders — phone is mandatory (buyers call them during
        # delivery); M-Pesa number funds end-of-day payouts. Accounts
        # start PENDING and must be approved by admin before jobs show.
        if not body.phone or not body.phone.strip():
            raise HTTPException(status_code=400, detail="Phone number is required for couriers")
        resolved_age = None
        dob_iso = None
        gender = None
    elif body.role == "admin":
        # Admin accounts can only be created via seed.py or another admin.
        raise HTTPException(
            status_code=403, detail="Admin accounts cannot be self-registered"
        )

    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc: Dict[str, Any] = {
        "id": user_id,
        "email": body.email.lower(),
        "full_name": body.full_name.strip(),
        "role": body.role,
        "gender": gender,
        "age": resolved_age,
        "dob": dob_iso,
        "preferred_currency": body.preferred_currency or DEFAULT_CURRENCY,
        "hashed_password": hash_password(body.password),
        "suspended": False,
        "created_at": now,
    }
    if body.role == "seller":
        doc["company_name"] = body.company_name.strip() if body.company_name else None
        doc["location"] = body.location.model_dump() if body.location else None
        doc["bank_details"] = (
            body.bank_details.model_dump(exclude_none=True) if body.bank_details else None
        )
    if body.role == "courier":
        doc["phone"] = body.phone.strip() if body.phone else None
        doc["mpesa_number"] = body.mpesa_number.strip() if body.mpesa_number else None
        doc["courier_status"] = "pending"
    await db.users.insert_one(doc)
    token = make_jwt(user_id, body.role, 0)
    return AuthOut(token=token, user=user_to_out(doc), needs_seller_onboarding=False)


@router.post("/auth/login", response_model=AuthOut)
async def login(body: LoginIn) -> AuthOut:
    doc = await db.users.find_one({"email": body.email.lower()})
    if not doc or not verify_password(body.password, doc["hashed_password"]):
        raise HTTPException(status_code=400, detail="Invalid email or password")

    # Optional buyer↔seller flip at the login moment. Admins and couriers
    # are immune — those roles are fixed (courier approval state would be
    # lost if the account flipped to buyer via a stray `as_role`).
    needs_onboarding = False
    if body.as_role and doc["role"] not in ("admin", "courier") and body.as_role != doc["role"]:
        if body.as_role == "seller" and not _is_seller_complete(doc):
            # The user wants to log in as a seller but their account is
            # incomplete. We DO NOT flip the role yet — we keep them as a
            # buyer (or whatever they were) and signal the client to route
            # to the onboarding form. After onboarding succeeds the client
            # calls POST /user/toggle-role which performs the actual flip.
            needs_onboarding = True
        else:
            await db.users.update_one(
                {"id": doc["id"]},
                {
                    "$set": {"role": body.as_role},
                    "$inc": {"token_version": 1},
                },
            )
            doc = await db.users.find_one(
                {"id": doc["id"]}, {"_id": 0, "hashed_password": 0}
            )
            assert doc is not None

    token = make_jwt(doc["id"], doc["role"], int(doc.get("token_version") or 0))
    return AuthOut(
        token=token,
        user=user_to_out(doc),
        needs_seller_onboarding=needs_onboarding,
    )


@router.get("/auth/me", response_model=UserOut)
async def me(user: Dict[str, Any] = Depends(get_current_user)) -> UserOut:
    return user_to_out(user)


@router.patch("/auth/preferences", response_model=UserOut)
async def update_preferences(
    body: PreferencesIn, user: Dict[str, Any] = Depends(get_current_user)
) -> UserOut:
    """Update user-level preferences (currency, etc.). Currently only currency."""
    update: Dict[str, Any] = {}
    if body.preferred_currency:
        update["preferred_currency"] = body.preferred_currency
    if not update:
        raise HTTPException(status_code=400, detail="No preferences provided")
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    fresh = await db.users.find_one(
        {"id": user["id"]}, {"_id": 0, "hashed_password": 0}
    )
    return user_to_out(fresh)



# ---------------------------------------------------------------------------
# Public: Paystack banks for the signup form's bank picker.
# Same shape as `/api/seller/banks` but does NOT require an auth token so
# the register screen can populate the dropdown before the seller account
# exists. Paystack returns only public metadata (name/code/type), never any
# seller-specific data.
# ---------------------------------------------------------------------------
@router.get("/auth/banks")
async def public_banks(country: str = "kenya") -> Dict[str, Any]:
    from core import paystack

    country = (country or "kenya").strip().lower()
    try:
        banks = await paystack.list_banks(country)
    except paystack.PaystackError as e:
        raise HTTPException(status_code=502, detail=f"Paystack error: {e}") from e
    slim = [
        {
            "code": b.get("code"),
            "name": b.get("name"),
            "slug": b.get("slug"),
            "type": b.get("type"),
            "currency": b.get("currency"),
        }
        for b in banks
        if b.get("code") and b.get("name")
    ]
    return {"country": country, "banks": slim}


# ---------------------------------------------------------------------------
# POST /auth/forgot-password — request a reset link
# ---------------------------------------------------------------------------
@router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordIn) -> Dict[str, Any]:
    """Send a password-reset email if the account exists.

    Deliberately returns the same success shape regardless of whether the
    email is known — prevents account-enumeration attacks. When Resend
    isn't configured (dev/preview), we log the reset link so testers can
    still complete the flow.
    """
    email_norm = body.email.strip().lower()
    user = await db.users.find_one({"email": email_norm}, {"_id": 0})

    generic_ok = {
        "ok": True,
        "message": "If that email is registered, a reset link has been sent.",
    }

    if not user:
        # Small delay would help against timing attacks but is overkill for
        # the current threat model. The response body is already opaque.
        logger.info("forgot-password: unknown email %s", email_norm)
        return generic_ok

    token = _mint_reset_token(user["id"])
    web_link = f"{_APP_WEB_URL}/reset-password?token={token}"
    deep_link = f"{_APP_DEEPLINK_SCHEME}://reset-password?token={token}"

    # Import lazily so a missing `resend` dependency doesn't break the app
    # boot when the feature is disabled.
    from core import mailer

    try:
        html, text = mailer.password_reset_template(
            name=user.get("full_name") or user.get("email") or "",
            web_link=web_link,
            deep_link=deep_link,
        )
        message_id = mailer.send_email(
            to=user["email"],
            subject="Reset your Oromona password",
            html=html,
            text=text,
        )
        logger.info("forgot-password: sent to %s (msg=%s)", email_norm, message_id)
    except mailer.ResendConfigError:
        # Preview environments without a Resend key — log the link so
        # testers can complete the flow via the URL.
        logger.warning(
            "forgot-password: RESEND not configured — reset link: %s", web_link
        )
        return {**generic_ok, "debug_reset_link": web_link}
    except mailer.ResendSendError as e:
        logger.error("forgot-password: send failed for %s: %s", email_norm, e)
        # Still return generic OK to avoid leaking existence, but log for us.

    return generic_ok


# ---------------------------------------------------------------------------
# POST /auth/reset-password — consume the token and set a new password
# ---------------------------------------------------------------------------
@router.post("/auth/reset-password", response_model=AuthOut)
async def reset_password(body: ResetPasswordIn) -> AuthOut:
    """Verify the reset token, update the password, and return a fresh
    login JWT so the client can immediately sign the user in."""
    uid = _verify_reset_token(body.token)
    user = await db.users.find_one({"id": uid}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=400, detail="Account not found.")

    new_hash = hash_password(body.new_password)

    # Bump token_version to invalidate any existing session tokens issued
    # before the password change. Force sign-in with the new password.
    new_tv = int(user.get("token_version", 0)) + 1
    await db.users.update_one(
        {"id": uid},
        {
            "$set": {
                "hashed_password": new_hash,
                "token_version": new_tv,
                "password_updated_at": datetime.now(timezone.utc),
            }
        },
    )
    fresh = await db.users.find_one({"id": uid}, {"_id": 0, "hashed_password": 0})
    if not fresh:
        raise HTTPException(status_code=500, detail="User lookup failed after reset.")

    jwt_token = make_jwt(
        fresh["id"], fresh.get("role", "buyer"), token_version=new_tv
    )
    return AuthOut(
        token=jwt_token,
        user=user_to_out(fresh),
    )


@router.delete("/auth/me")
async def delete_account(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Self-service account deletion (App Store / Play review requirement).

    Permanently removes the account and all personal data (profile photos,
    measurements, addresses, try-ons, stylist chats, wishlists). Order and
    payout records are retained for bookkeeping/legal reasons but the login
    is destroyed and can never be reused. A seller's listings come off the
    marketplace immediately.
    """
    uid = user["id"]
    if user.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Admin accounts cannot self-delete")
    for coll, field in (
        ("profiles", "user_id"),
        ("body_profiles", "user_id"),
        ("addresses", "user_id"),
        ("tryons", "user_id"),
        ("stylist_sessions", "user_id"),
        ("wishlists", "user_id"),
        ("collections", "user_id"),
        ("stock_notifications", "user_id"),
    ):
        await db[coll].delete_many({field: uid})
    await db.items.delete_many({"seller_id": uid})
    await db.users.delete_one({"id": uid})
    logger.info("account self-deleted: %s", uid)
    return {"status": "deleted"}


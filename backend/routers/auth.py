"""Auth routes: register, login, /auth/me, preferences."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException

from core.config import DEFAULT_CURRENCY
from core.db import db
from core.security import (
    get_current_user,
    hash_password,
    make_jwt,
    verify_password,
)
from models import AuthOut, LoginIn, PreferencesIn, RegisterIn, UserOut, user_to_out

router = APIRouter()


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
    await db.users.insert_one(doc)
    token = make_jwt(user_id, body.role, 0)
    return AuthOut(token=token, user=user_to_out(doc), needs_seller_onboarding=False)


@router.post("/auth/login", response_model=AuthOut)
async def login(body: LoginIn) -> AuthOut:
    doc = await db.users.find_one({"email": body.email.lower()})
    if not doc or not verify_password(body.password, doc["hashed_password"]):
        raise HTTPException(status_code=400, detail="Invalid email or password")

    # Optional buyer↔seller flip at the login moment. Admins are immune —
    # the admin flag is set out-of-band via seed.py and cannot be downgraded
    # by hitting this endpoint with a custom `as_role`.
    needs_onboarding = False
    if body.as_role and doc["role"] != "admin" and body.as_role != doc["role"]:
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

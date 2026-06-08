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


@router.post("/auth/register", response_model=AuthOut)
async def register(body: RegisterIn) -> AuthOut:
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Resolve age: prefer DOB if provided, otherwise use submitted age.
    resolved_age: Optional[int] = body.age
    dob_iso: Optional[str] = None
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
            raise HTTPException(status_code=400, detail="You must be at least 13 years old")
        if years > 120:
            raise HTTPException(status_code=400, detail="Please enter a valid date of birth")
        resolved_age = years
        dob_iso = body.dob
    if resolved_age is None:
        raise HTTPException(status_code=400, detail="age or dob is required")

    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc = {
        "id": user_id,
        "email": body.email.lower(),
        "full_name": body.full_name.strip(),
        "role": body.role,
        "gender": body.gender,
        "age": resolved_age,
        "dob": dob_iso,
        "preferred_currency": body.preferred_currency or DEFAULT_CURRENCY,
        "hashed_password": hash_password(body.password),
        "created_at": now,
    }
    await db.users.insert_one(doc)
    token = make_jwt(user_id, body.role)
    return AuthOut(token=token, user=user_to_out(doc))


@router.post("/auth/login", response_model=AuthOut)
async def login(body: LoginIn) -> AuthOut:
    doc = await db.users.find_one({"email": body.email.lower()})
    if not doc or not verify_password(body.password, doc["hashed_password"]):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    token = make_jwt(doc["id"], doc["role"])
    return AuthOut(token=token, user=user_to_out(doc))


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

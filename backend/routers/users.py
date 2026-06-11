"""User self-service endpoints: role toggle, etc.

The toggle-role endpoint is the heart of the "I want to sell" and "I want
to shop" UX. It:
  1. Validates the user is allowed to switch (admins are not).
  2. When switching to seller, ensures the account carries the required
     seller fields (company_name + location). If those are missing the
     client must pass them in the request body — we then atomically
     populate them on the user doc and flip the role.
  3. Increments `token_version` so all previously issued JWTs are invalid.
  4. Returns a fresh JWT plus the updated user payload.
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.security import get_current_user, make_jwt
from models import AuthOut, ToggleRoleIn, user_to_out

router = APIRouter()


def _has_seller_essentials(doc: Dict[str, Any]) -> bool:
    if not (doc.get("company_name") or "").strip():
        return False
    loc = doc.get("location") or {}
    return bool((loc.get("city") or "").strip() and (loc.get("country") or "").strip())


@router.post("/user/toggle-role", response_model=AuthOut)
async def toggle_role(
    body: ToggleRoleIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> AuthOut:
    if user.get("role") == "admin":
        raise HTTPException(status_code=403, detail="Admins cannot toggle role")

    target = body.to or ("seller" if user["role"] == "buyer" else "buyer")
    if target not in ("buyer", "seller"):
        raise HTTPException(status_code=400, detail="`to` must be buyer or seller")
    if target == user["role"]:
        # No-op — return a fresh token anyway so the client can re-sync.
        token = make_jwt(user["id"], user["role"], int(user.get("token_version") or 0))
        return AuthOut(token=token, user=user_to_out(user))

    update: Dict[str, Any] = {"role": target}

    if target == "seller":
        # Pull in onboarding fields if they're missing on the doc but the
        # client supplied them in the body.
        if not (user.get("company_name") or "").strip():
            if not body.company_name or not body.company_name.strip():
                raise HTTPException(
                    status_code=400, detail="Company name is required to switch to Seller"
                )
            update["company_name"] = body.company_name.strip()
        if not (user.get("location") or {}).get("city"):
            if not body.location:
                raise HTTPException(
                    status_code=400, detail="City and country are required to switch to Seller"
                )
            update["location"] = body.location.model_dump()
        # Bank details are optional — accept whatever they sent (sellers
        # can finish this in /seller/payouts later).
        if body.bank_details:
            update["bank_details"] = body.bank_details.model_dump(exclude_none=True)

        # Re-validate the resulting doc.
        merged = {**user, **update}
        if not _has_seller_essentials(merged):
            raise HTTPException(
                status_code=400,
                detail="Complete company name + location to switch to Seller",
            )

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": update, "$inc": {"token_version": 1}},
    )
    fresh = await db.users.find_one(
        {"id": user["id"]}, {"_id": 0, "hashed_password": 0}
    )
    assert fresh is not None
    token = make_jwt(fresh["id"], fresh["role"], int(fresh.get("token_version") or 0))
    return AuthOut(token=token, user=user_to_out(fresh))

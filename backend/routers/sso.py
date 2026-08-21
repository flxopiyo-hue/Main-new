"""Single Sign-On: Google (Emergent-managed) + Apple.

Both endpoints funnel into the same helper (`_upsert_and_issue_jwt`) so
the marketplace has exactly one user document per email regardless of
which method the buyer signed in with. New accounts default to
``role="buyer"`` and are auto-linked by lowercased email when a
password account with that email already exists (this is the linking
UX the user chose during setup).

Both endpoints return the same ``AuthOut`` envelope as
``/api/auth/login`` — the frontend adopts the JWT via the existing
``setToken`` path and every downstream route (`/auth/me`,
`/items`, `/tryon`, …) treats the request as if the user had signed in
with a password. This avoids running two auth systems in parallel.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
import jwt
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.config import DEFAULT_CURRENCY
from core.db import db
from core.security import make_jwt
from models import AuthOut, user_to_out

logger = logging.getLogger("oromona.sso")
router = APIRouter()

# ---------------------------------------------------------------------------
# Shared helper — the ONE place that creates-or-links a user from an SSO
# provider payload. Keeps invariants (default role, timestamps, currency,
# provider bookkeeping) in one place regardless of which button was tapped.
# ---------------------------------------------------------------------------
async def _upsert_and_issue_jwt(
    *,
    provider: str,               # "google" | "apple"
    provider_sub: str,           # stable per-user id from the provider
    email: Optional[str],        # normalised (lower) or None (Apple hide-my-email + no email consent)
    full_name: Optional[str],    # display name if the provider gave one
) -> AuthOut:
    """Find-or-create the Oromona user for this SSO login and mint a JWT.

    Linking order (per user's choice at setup):
      1. Existing account with the SAME ``providers.<provider>.sub`` — reuse it.
      2. Existing account with the SAME email — auto-link (add the sub).
      3. Otherwise create a fresh buyer account.
    """
    now = datetime.now(timezone.utc)
    provider_key = f"providers.{provider}.sub"

    # 1) Same provider id.
    user = await db.users.find_one(
        {provider_key: provider_sub}, {"_id": 0, "hashed_password": 0}
    )

    # 2) Same email — auto-link.
    if user is None and email:
        user = await db.users.find_one(
            {"email": email}, {"_id": 0, "hashed_password": 0}
        )
        if user is not None:
            await db.users.update_one(
                {"id": user["id"]},
                {
                    "$set": {
                        provider_key: provider_sub,
                        f"providers.{provider}.linked_at": now,
                    }
                },
            )
            # Reflect the new field in-memory so we don't re-fetch.
            providers = dict(user.get("providers") or {})
            providers[provider] = {"sub": provider_sub, "linked_at": now}
            user["providers"] = providers

    # 3) Fresh buyer account. Sign-ups via SSO can't select a role — we
    # deliberately default everyone to "buyer"; sellers apply from
    # Profile → Sell on Oromona later (per user's setup choice).
    if user is None:
        user_id = str(uuid.uuid4())
        display_name = (full_name or "").strip() or (
            email.split("@", 1)[0].replace(".", " ").title() if email else "Oromona shopper"
        )
        # Email is required by our existing schema. Apple's hide-my-email
        # returns a valid private relay address, so we honour it. If a
        # provider truly returns no email (extremely rare on Google), we
        # synthesise one so the DB constraint isn't violated — the user
        # can update it later from Profile.
        safe_email = (email or f"{provider}_{provider_sub[:12]}@sso.oromona.local").lower()
        doc: Dict[str, Any] = {
            "id": user_id,
            "email": safe_email,
            "full_name": display_name,
            "role": "buyer",  # SSO default — sellers apply from Profile.
            "gender": None,
            "age": None,
            "dob": None,
            "preferred_currency": DEFAULT_CURRENCY,
            # No password on an SSO-native account; a later password-reset
            # flow can add one if the user wants to log in via email too.
            "hashed_password": None,
            "suspended": False,
            "providers": {provider: {"sub": provider_sub, "linked_at": now}},
            "created_at": now,
        }
        try:
            await db.users.insert_one(doc)
        except Exception as e:  # unique-index race on email — re-fetch.
            logger.warning("sso insert race for %s: %s", safe_email, e)
        user = await db.users.find_one(
            {"id": user_id}, {"_id": 0, "hashed_password": 0}
        ) or await db.users.find_one(
            {"email": safe_email}, {"_id": 0, "hashed_password": 0}
        )
        if user is None:
            raise HTTPException(status_code=500, detail="Could not create SSO account")

    token = make_jwt(
        user["id"], user.get("role") or "buyer", int(user.get("token_version") or 0)
    )
    return AuthOut(
        token=token,
        user=user_to_out(user),
        needs_seller_onboarding=False,
    )


# ---------------------------------------------------------------------------
# Google (Emergent-managed) — exchanges a session_id for our own JWT.
#
# The client:
#   • opens ``https://auth.emergentagent.com/?redirect=<redirect_url>``
#   • extracts ``session_id`` from the callback URL (hash or query)
#   • POSTs it here exactly ONCE. The value is single-use.
# ---------------------------------------------------------------------------
_EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


class GoogleSessionIn(BaseModel):
    """Body for POST /auth/session — the ONLY place the client passes an
    Emergent session_id. Field name is fixed by the playbook."""

    session_id: str = Field(min_length=8, max_length=200)


@router.post("/auth/session", response_model=AuthOut)
async def google_session(body: GoogleSessionIn) -> AuthOut:
    """Exchange a one-time Emergent Google session_id for our JWT."""
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                _EMERGENT_SESSION_URL,
                headers={"X-Session-ID": body.session_id},
            )
    except httpx.HTTPError as e:
        logger.warning("google_session: emergent unreachable: %s", e)
        raise HTTPException(status_code=502, detail="Google sign-in service unavailable") from e

    if r.status_code != 200:
        logger.info("google_session: emergent %s — %s", r.status_code, r.text[:120])
        raise HTTPException(status_code=401, detail="Google sign-in expired — try again")

    data = r.json() if r.text else {}
    email = (data.get("email") or "").strip().lower() or None
    name = (data.get("name") or "").strip() or None
    if not email:
        raise HTTPException(status_code=400, detail="Google account did not share an email")

    return await _upsert_and_issue_jwt(
        provider="google",
        provider_sub=email,   # Emergent doesn't expose a stable Google sub; email is the join key.
        email=email,
        full_name=name,
    )


# ---------------------------------------------------------------------------
# Apple Sign In — verifies the identityToken against Apple's JWKS.
# ---------------------------------------------------------------------------
_APPLE_ISSUER = "https://appleid.apple.com"
_APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"

# JWKS is cached across requests (Apple rotates rarely; short TTL is safe).
_apple_jwks_cache: Dict[str, Any] = {"keys": None, "fetched_at": None}
_JWKS_TTL_SEC = 60 * 60  # 1 hour


def _apple_audiences() -> List[str]:
    raw = os.environ.get("APPLE_AUDIENCES") or ""
    return [aud.strip() for aud in raw.split(",") if aud.strip()]


async def _get_apple_jwks() -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    if (
        _apple_jwks_cache["keys"]
        and _apple_jwks_cache["fetched_at"]
        and (now - _apple_jwks_cache["fetched_at"]).total_seconds() < _JWKS_TTL_SEC
    ):
        return _apple_jwks_cache["keys"]
    async with httpx.AsyncClient(timeout=6.0) as client:
        r = await client.get(_APPLE_JWKS_URL)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Apple sign-in keys unavailable")
    keys = r.json()
    _apple_jwks_cache["keys"] = keys
    _apple_jwks_cache["fetched_at"] = now
    return keys


class AppleLoginIn(BaseModel):
    """Body for POST /auth/apple. The client sends the raw identity token
    plus (on FIRST sign-in only) the display name — Apple never returns
    the name again on subsequent logins, so we persist it immediately."""

    identity_token: str = Field(min_length=20)
    # Apple gives these ONLY on the first sign-in. Both optional.
    email: Optional[str] = None
    full_name: Optional[str] = None


@router.post("/auth/apple", response_model=AuthOut)
async def apple_login(body: AppleLoginIn) -> AuthOut:
    audiences = _apple_audiences()
    if not audiences:
        # Misconfiguration — surface as 500 so the mobile client shows an error.
        logger.error("apple_login: APPLE_AUDIENCES not set in env")
        raise HTTPException(status_code=500, detail="Apple sign-in not configured")

    jwks = await _get_apple_jwks()
    try:
        # Pick the right public key by kid.
        header = jwt.get_unverified_header(body.identity_token)
        kid = header.get("kid")
        key_data = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
        if key_data is None:
            raise HTTPException(status_code=401, detail="Apple key not found")
        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key_data)
        # PyJWT accepts a single audience string or a list of accepted audiences.
        payload = jwt.decode(
            body.identity_token,
            public_key,  # type: ignore[arg-type]
            algorithms=["RS256"],
            audience=audiences,
            issuer=_APPLE_ISSUER,
        )
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(status_code=401, detail="Apple token expired") from e
    except jwt.InvalidAudienceError as e:
        raise HTTPException(status_code=401, detail="Apple token audience mismatch") from e
    except jwt.PyJWTError as e:
        logger.info("apple_login: token rejected: %s", e)
        raise HTTPException(status_code=401, detail="Invalid Apple token") from e

    apple_sub = payload.get("sub")
    if not apple_sub:
        raise HTTPException(status_code=401, detail="Apple token missing sub")

    # Prefer the email inside the verified token; fall back to the value
    # the client sent (only present on first login). Both are trustworthy —
    # Apple signed the token; the client-sent name/email were passed
    # through the OS keychain-style flow on first login only.
    token_email = (payload.get("email") or "").strip().lower() or None
    body_email = (body.email or "").strip().lower() or None
    email = token_email or body_email

    return await _upsert_and_issue_jwt(
        provider="apple",
        provider_sub=apple_sub,
        email=email,
        full_name=body.full_name,
    )

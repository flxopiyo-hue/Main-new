"""Apple Sign In server helpers — client_secret JWT + token revocation.

Handles the flow required by Apple App Review Guideline 5.1.1(v):
account deletion must revoke previously-issued Apple refresh tokens.

Env config (backend/.env):
  APPLE_TEAM_ID          — 10-char Team ID from Apple Developer Portal.
  APPLE_KEY_ID           — 10-char Key ID of the "Sign in with Apple" p8 key.
  APPLE_CLIENT_ID        — bundle identifier / service ID that will appear
                           in ``sub`` of the client_secret JWT. Falls back
                           to the first entry of ``APPLE_AUDIENCES`` if not
                           set explicitly.
  APPLE_PRIVATE_KEY_P8   — PEM-formatted p8 private key contents. Multi-line
                           values may be encoded with literal ``\\n`` in
                           .env — we normalise them here.

If any of the above are missing, both ``exchange_code_for_refresh_token``
and ``revoke_refresh_token`` become no-ops that log a warning. That lets
Apple Sign In keep working in preview environments where the p8 key has
not been provisioned yet — the App Store production build MUST have all
four vars set to pass Apple's 5.1.1(v) review.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Optional

import httpx
import jwt

logger = logging.getLogger("oromona.apple")

_APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
# Apple currently accepts both /auth/revoke and the newer
# /auth/oauth2/v2/revoke — we use the versioned endpoint from the current
# Sign in with Apple REST reference.
_APPLE_REVOKE_URL = "https://appleid.apple.com/auth/oauth2/v2/revoke"


def _cfg() -> Optional[dict]:
    """Return the Apple server-side config, or None if not fully configured."""
    team = (os.environ.get("APPLE_TEAM_ID") or "").strip()
    kid = (os.environ.get("APPLE_KEY_ID") or "").strip()
    cid = (os.environ.get("APPLE_CLIENT_ID") or "").strip()
    # Fall back to the first audience if the caller hasn't split them out.
    if not cid:
        auds = os.environ.get("APPLE_AUDIENCES") or ""
        first = next(
            (a.strip() for a in auds.split(",") if a.strip() and a.strip() != "host.exp.Exponent"),
            "",
        )
        cid = first
    p8 = (os.environ.get("APPLE_PRIVATE_KEY_P8") or "").strip()
    # `.env` files often store multi-line keys with escaped newlines.
    p8 = p8.replace("\\n", "\n")
    if not (team and kid and cid and p8):
        return None
    return {"team_id": team, "key_id": kid, "client_id": cid, "p8": p8}


def _make_client_secret(cfg: dict) -> str:
    """Sign the ES256 client_secret JWT Apple expects on /auth/token
    and /auth/oauth2/v2/revoke."""
    now = int(time.time())
    payload = {
        "iss": cfg["team_id"],
        "iat": now,
        # Apple caps the client_secret at 6 months. 1 hour is plenty here —
        # we regenerate one per outbound call.
        "exp": now + 3600,
        "aud": "https://appleid.apple.com",
        "sub": cfg["client_id"],
    }
    return jwt.encode(
        payload,
        cfg["p8"],
        algorithm="ES256",
        headers={"kid": cfg["key_id"], "alg": "ES256"},
    )


async def exchange_code_for_refresh_token(authorization_code: str) -> Optional[str]:
    """Trade the one-time authorization_code Apple returned on first sign-in
    for a long-lived refresh_token.

    Returns the refresh_token string on success, or None if either Apple
    creds aren't configured or the exchange failed. Callers MUST NOT abort
    login on a None response — the identity_token verification has already
    established who the user is; the refresh_token is only needed later
    for account deletion.
    """
    cfg = _cfg()
    if cfg is None:
        logger.warning(
            "apple: refresh-token exchange skipped (APPLE_TEAM_ID / "
            "APPLE_KEY_ID / APPLE_CLIENT_ID / APPLE_PRIVATE_KEY_P8 not set)"
        )
        return None
    try:
        secret = _make_client_secret(cfg)
    except Exception as e:
        logger.warning("apple: could not sign client_secret JWT: %s", e)
        return None
    data = {
        "client_id": cfg["client_id"],
        "client_secret": secret,
        "code": authorization_code,
        "grant_type": "authorization_code",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(
                _APPLE_TOKEN_URL,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except httpx.HTTPError as e:
        logger.warning("apple: /auth/token unreachable: %s", e)
        return None
    if r.status_code != 200:
        logger.warning("apple: /auth/token %s — %s", r.status_code, r.text[:200])
        return None
    body = {}
    try:
        body = r.json()
    except Exception:
        pass
    return (body or {}).get("refresh_token") or None


async def revoke_refresh_token(refresh_token: str) -> bool:
    """Revoke an Apple refresh_token.

    App Store guideline 5.1.1(v) requires that when a user deletes their
    account, any Apple Sign In tokens tied to it are revoked. We always
    return quietly (True/False) — the account deletion flow must never
    fail because of a downstream Apple 5xx.
    """
    if not refresh_token:
        return False
    cfg = _cfg()
    if cfg is None:
        logger.warning("apple: revoke skipped (creds not configured)")
        return False
    try:
        secret = _make_client_secret(cfg)
    except Exception as e:
        logger.warning("apple: could not sign client_secret JWT for revoke: %s", e)
        return False
    data = {
        "client_id": cfg["client_id"],
        "client_secret": secret,
        "token": refresh_token,
        "token_type_hint": "refresh_token",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(
                _APPLE_REVOKE_URL,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except httpx.HTTPError as e:
        logger.warning("apple: /revoke unreachable: %s", e)
        return False
    if r.status_code == 200:
        return True
    logger.warning("apple: /revoke %s — %s", r.status_code, r.text[:200])
    return False


def apple_ready() -> bool:
    """True when the server has enough config to talk to Apple's token /
    revoke endpoints. Handy for /healthz-style checks."""
    return _cfg() is not None

"""Oromona Premium subscription endpoints (Paystack-backed).

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

from fastapi import APIRouter, Depends, Form, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
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
    """Idempotent: creates the Oromona Premium plan on Paystack if it
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
async def checkout(
    request: Request,
    user: Dict[str, Any] = Depends(get_current_user),
) -> CheckoutOut:
    """Start a Paystack hosted checkout session. Client redirects to
    ``authorization_url`` and Paystack redirects back to the backend
    bridge at ``/api/subs/paystack-return?reference=...`` which then
    deep-links into the mobile app (``oromona://subscription/success``).
    The ``/verify`` endpoint completes the flow and flips the user to
    premium.
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
    reference = f"oromona_{user['id'][:8]}_{uuid.uuid4().hex[:12]}"
    callback_url = _paystack_callback_url(request)
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


@router.get("/health")
async def health(request: Request) -> Dict[str, Any]:
    """Public config-state check. Returns whether Paystack is wired up
    and which mode (test/live) the keys are in, without exposing
    secrets. Useful for debugging live checkouts that 4xx unexpectedly.
    """
    import os

    secret = (os.getenv("PAYSTACK_SECRET_KEY") or "").strip()
    pub = (os.getenv("PAYSTACK_PUBLIC_KEY") or "").strip()

    def _mode(k: str) -> str:
        if k.startswith("sk_live_") or k.startswith("pk_live_"):
            return "live"
        if k.startswith("sk_test_") or k.startswith("pk_test_"):
            return "test"
        return "unset" if not k else "unknown"

    plan_code = get_plan_code()
    # Attempt a live plan lookup so we know whether ensure_premium_plan
    # actually landed a plan against the current key.
    plan_lookup_ok = None
    plan_lookup_err = None
    if secret:
        try:
            plans = await paystack.list_plans()
            plan_lookup_ok = any(
                (p.get("plan_code") == plan_code) or (p.get("name") == PREMIUM_PLAN_NAME)
                for p in plans
            )
        except paystack.PaystackError as e:
            plan_lookup_ok = False
            plan_lookup_err = str(e)

    return {
        "app": "Oromona",
        "paystack": {
            "secret_key_mode": _mode(secret),
            "public_key_mode": _mode(pub),
            "keys_match_mode": _mode(secret) == _mode(pub) and _mode(secret) != "unset",
            "cached_plan_code": plan_code,
            "plan_exists_on_paystack": plan_lookup_ok,
            "plan_lookup_error": plan_lookup_err,
        },
        "callback_url_the_checkout_will_use": _paystack_callback_url(request),
        "webhook_url_paystack_should_hit": f"{_public_base_url(request)}/api/subs/webhook",
        "public_base_url_detected": _public_base_url(request),
    }


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



# ---------------------------------------------------------------------------
# Paystack callback bridge + browser test flow
# ---------------------------------------------------------------------------
#
# Because Oromona is a mobile-only app (no public web frontend URL is
# provisioned by Emergent), Paystack's ``callback_url`` cannot point to a
# frontend route. Instead we route it to the BACKEND at
# ``/api/subs/paystack-return`` which:
#   1. Verifies the transaction (server-to-server) using the Paystack API.
#   2. Optimistically upgrades the buyer's subscription if their email
#      matches an Oromona account.
#   3. Renders a small HTML page that tries to deep-link back into the
#      Oromona mobile app via the ``oromona://`` scheme registered in
#      ``app.json``, falling back to a friendly branded "Return to app"
#      screen for browser-based testing.


APP_DEEP_LINK_SCHEME = "oromona"


def _public_base_url(request: Request) -> str:
    """Reconstructs the public HTTPS base URL of this backend.

    Behind Emergent's Kubernetes ingress ``request.base_url`` returns
    an internal HTTP cluster URL (e.g.
    ``http://fit-finder-app-5.cluster-12.preview.emergentcf.cloud``)
    which is NOT reachable from Paystack and is NOT HTTPS — Paystack
    Live mode rejects such callback URLs with 403.

    Resolution order (first non-empty wins):
      1. ``PUBLIC_BACKEND_URL`` env var — highest precedence, lets the
         operator pin the exact public URL Paystack should redirect to.
      2. ``X-Forwarded-Proto`` + ``X-Forwarded-Host`` headers set by
         the ingress (the standard reverse-proxy pattern).
      3. Fall back to ``request.base_url`` — works for local dev.
    """
    import os

    env = (os.getenv("PUBLIC_BACKEND_URL") or "").strip()
    if env:
        return env.rstrip("/")

    fwd_host = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
    fwd_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    host = (request.headers.get("host") or "").strip()
    if fwd_host:
        proto = fwd_proto or "https"
        return f"{proto}://{fwd_host}".rstrip("/")
    if host and not host.startswith("localhost") and "cluster" not in host:
        # Ingress didn't set X-Forwarded-Host but the Host header is
        # already the public one — trust it and upgrade to HTTPS.
        return f"https://{host}".rstrip("/")
    return str(request.base_url).rstrip("/")


def _paystack_callback_url(request: Request) -> str:
    """Where Paystack should redirect the buyer after payment. Always
    HTTPS — Paystack Live rejects HTTP callbacks with 403.

    An explicit ``PAYSTACK_CALLBACK_URL`` env var takes precedence for
    the rare case where the operator wants callbacks to land on a
    different domain (e.g. a marketing site that then hands off to the
    app store).
    """
    import os

    env = (os.getenv("PAYSTACK_CALLBACK_URL") or "").strip()
    if env:
        return env.rstrip("/") + "/api/subs/paystack-return"
    base = _public_base_url(request)
    if base.startswith("http://"):
        # Force HTTPS for Paystack — the internal cluster proto is HTTP
        # but the public ingress terminates TLS.
        base = "https://" + base[len("http://"):]
    return f"{base}/api/subs/paystack-return"


def _success_html(*, headline: str, body: str, ref: str, ok: bool) -> str:
    """Branded HTML shown after Paystack redirects back. Also attempts a
    deep link into the app via ``oromona://subscription/success``.
    """
    deep = f"{APP_DEEP_LINK_SCHEME}://subscription/success?reference={ref}"
    color = "#111827" if ok else "#B91C1C"
    accent = "#7C3AED" if ok else "#B91C1C"
    icon = "✓" if ok else "✕"
    return f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />
  <title>Oromona — {headline}</title>
  <style>
    :root {{ color-scheme: light; }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      background: linear-gradient(180deg, #FAF7F2 0%, #F1EBE1 100%);
      color: {color};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      display: flex; align-items: center; justify-content: center; padding: 24px;
    }}
    .card {{
      max-width: 460px; width: 100%;
      background: #fff; border-radius: 24px;
      box-shadow: 0 12px 40px rgba(17, 24, 39, 0.08);
      padding: 40px 28px 28px; text-align: center;
    }}
    .badge {{
      width: 72px; height: 72px; border-radius: 36px;
      background: {accent}; color: #fff; margin: 0 auto 20px;
      display: flex; align-items: center; justify-content: center;
      font-size: 36px; font-weight: 700;
    }}
    h1 {{ margin: 0 0 12px; font-size: 22px; font-weight: 700; }}
    p {{ margin: 0 0 20px; color: #4B5563; font-size: 15px; line-height: 1.5; }}
    .ref {{ font-family: 'SF Mono', Menlo, monospace; font-size: 12px; color: #9CA3AF; word-break: break-all; }}
    .btn {{
      display: inline-block; margin-top: 20px; padding: 14px 24px;
      background: {accent}; color: #fff; text-decoration: none;
      border-radius: 14px; font-weight: 600; font-size: 15px;
    }}
    .btn.secondary {{ background: transparent; color: {accent}; border: 1px solid {accent}; margin-left: 8px; }}
    .foot {{ margin-top: 24px; font-size: 12px; color: #9CA3AF; }}
  </style>
  <script>
    // Try to hand off to the mobile app immediately. If the scheme is not
    // registered (e.g. desktop browser), we stay on this page so the buyer
    // can see the confirmation.
    (function() {{
      try {{ window.location.replace({deep!r}); }} catch (e) {{ /* no-op */ }}
    }})();
  </script>
</head>
<body>
  <div class=\"card\">
    <div class=\"badge\">{icon}</div>
    <h1>{headline}</h1>
    <p>{body}</p>
    <p class=\"ref\">Reference: {ref}</p>
    <a class=\"btn\" href=\"{deep}\">Open Oromona app</a>
    <div class=\"foot\">You can safely close this window.</div>
  </div>
</body>
</html>"""


@router.get("/paystack-return", response_class=HTMLResponse)
async def paystack_return(reference: str = "", request: Request = None) -> HTMLResponse:  # type: ignore[assignment]
    """Bridge hit by Paystack after checkout completes. Verifies the
    transaction server-to-server, upgrades the matching Oromona user if
    the email exists, then renders a branded HTML page that deep-links
    back into the mobile app.
    """
    if not reference:
        return HTMLResponse(
            _success_html(
                headline="Missing reference",
                body="We couldn't find a payment reference in the redirect. If you were charged, please contact support and we'll resolve it.",
                ref="—",
                ok=False,
            ),
            status_code=400,
        )
    try:
        data = await paystack.verify_transaction(reference)
    except paystack.PaystackError as e:
        logger.warning("paystack-return verify failed for %s: %s", reference, e)
        return HTMLResponse(
            _success_html(
                headline="Verification failed",
                body="We couldn't confirm your payment with Paystack right now. If money was deducted, we'll reconcile it — please contact support with the reference below.",
                ref=reference,
                ok=False,
            ),
            status_code=502,
        )

    status_ = data.get("status")
    if status_ != "success":
        return HTMLResponse(
            _success_html(
                headline="Payment not completed",
                body=f"Paystack reports the transaction as '{status_ or 'unknown'}'. No changes were made to your account.",
                ref=reference,
                ok=False,
            ),
            status_code=200,
        )

    # Try to match the paying customer to an Oromona user by email and
    # upgrade them optimistically. The webhook still owns authoritative
    # state (subscription code, renewal date) — this just unlocks the UI
    # immediately after redirect.
    customer = (data.get("customer") or {})
    email = (customer.get("email") or "").lower().strip()
    metadata = data.get("metadata") or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except Exception:
            metadata = {}
    user_id = (metadata or {}).get("user_id")
    user_doc = None
    if user_id:
        user_doc = await db.users.find_one({"id": user_id})
    if user_doc is None and email:
        user_doc = await db.users.find_one({"email": email})

    if user_doc is not None:
        now = datetime.now(timezone.utc)
        trial_end = now + timedelta(days=PREMIUM_PLAN_TRIAL_DAYS)
        update: Dict[str, Any] = {
            "subscription_tier": "premium",
            "subscription_status": "trialing",
            "cancel_at_period_end": False,
            "pending_paystack_reference": None,
            "pending_paystack_reference_at": None,
            "trial_end": trial_end,
            "current_period_end": trial_end,
        }
        cc = customer.get("customer_code")
        if cc:
            update["paystack_customer_code"] = cc
        await db.users.update_one({"id": user_doc["id"]}, {"$set": update})
        body = "Your Oromona Premium subscription is now active. Returning you to the app…"
    else:
        # Test payment or unmatched email — payment succeeded but no
        # user to upgrade. That's a valid state for a browser test run.
        body = "Payment successful. This transaction wasn't linked to an Oromona account, so no subscription was activated."

    return HTMLResponse(
        _success_html(
            headline="Payment successful",
            body=body,
            ref=reference,
            ok=True,
        )
    )


@router.get("/pay-web", response_class=HTMLResponse)
async def pay_web_form(request: Request) -> HTMLResponse:
    """Simple browser-testable checkout page. Lets the user enter an
    email + name and initiates a real Paystack transaction so payments
    can be smoke-tested end-to-end without booting the mobile app.

    WARNING: In LIVE mode this initiates a REAL KES 199 charge. Only
    share this URL with people who understand that.
    """
    amount_kes = PREMIUM_PLAN_AMOUNT_KOBO // 100
    action = f"{_public_base_url(request)}/api/subs/pay-web"
    return HTMLResponse(f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />
  <title>Oromona — Test Payment</title>
  <style>
    :root {{ color-scheme: light; }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; min-height: 100vh;
      background: linear-gradient(180deg, #FAF7F2 0%, #F1EBE1 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      display: flex; align-items: center; justify-content: center; padding: 24px;
    }}
    .card {{
      max-width: 460px; width: 100%;
      background: #fff; border-radius: 24px;
      box-shadow: 0 12px 40px rgba(17, 24, 39, 0.08);
      padding: 36px 28px 28px;
    }}
    h1 {{ margin: 0 0 4px; font-size: 24px; font-weight: 700; color: #111827; }}
    .sub {{ margin: 0 0 24px; color: #6B7280; font-size: 14px; }}
    label {{ display: block; margin-top: 14px; font-size: 13px; font-weight: 600; color: #374151; }}
    input {{
      display: block; width: 100%; margin-top: 6px; padding: 12px 14px;
      border: 1px solid #E5E7EB; border-radius: 12px; font-size: 15px;
      background: #F9FAFB; color: #111827;
    }}
    button {{
      margin-top: 22px; width: 100%; padding: 14px 20px;
      background: #7C3AED; color: #fff; border: 0; border-radius: 14px;
      font-weight: 700; font-size: 16px; cursor: pointer;
    }}
    button:hover {{ background: #6D28D9; }}
    .warn {{
      margin-top: 14px; padding: 10px 12px; border-radius: 10px;
      background: #FEF3C7; color: #92400E; font-size: 12px; line-height: 1.4;
    }}
    .amount {{ display: inline-block; margin-left: 4px; font-weight: 700; color: #7C3AED; }}
  </style>
</head>
<body>
  <div class=\"card\">
    <h1>Oromona Premium</h1>
    <p class=\"sub\">You'll pay <span class=\"amount\">KES {amount_kes:,}</span> / month via Paystack (Card or M-Pesa). 7-day free trial is included on new subscriptions.</p>
    <form method=\"POST\" action=\"{action}\">
      <label for=\"email\">Email</label>
      <input id=\"email\" name=\"email\" type=\"email\" required placeholder=\"you@example.com\" />
      <label for=\"name\">Full name (optional)</label>
      <input id=\"name\" name=\"name\" type=\"text\" placeholder=\"Jane Doe\" />
      <button type=\"submit\">Continue to Paystack</button>
      <div class=\"warn\">⚠️ This initiates a REAL payment via Paystack Live mode.</div>
    </form>
  </div>
</body>
</html>""")


@router.post("/pay-web")
async def pay_web_submit(
    request: Request,
    email: str = Form(...),
    name: str = Form(""),
) -> RedirectResponse:
    """Handles the /pay-web form submission. Kicks off a Paystack
    hosted checkout for the given email and 302-redirects the browser
    to the ``authorization_url`` Paystack returns.
    """
    email_clean = (email or "").strip().lower()
    if "@" not in email_clean:
        raise HTTPException(status_code=400, detail="Invalid email")

    plan_code = get_plan_code()
    if not plan_code:
        plan_code = await ensure_premium_plan()
        set_plan_code(plan_code)
    if not plan_code:
        raise HTTPException(
            status_code=503,
            detail="Payments temporarily unavailable — please retry in a moment",
        )

    # Match to an existing Oromona account if possible so the webhook +
    # the paystack-return bridge can upgrade the right user. If no
    # match, we still allow the payment to go through — the return
    # page will explain that no account was linked.
    user_doc = await db.users.find_one({"email": email_clean})
    metadata: Dict[str, Any] = {"purpose": "premium_subscription", "source": "pay-web"}
    if user_doc:
        metadata["user_id"] = user_doc["id"]
    if name:
        metadata["display_name"] = name.strip()

    ref_prefix = "web"
    if user_doc:
        ref_prefix = f"web_{user_doc['id'][:6]}"
    reference = f"oromona_{ref_prefix}_{uuid.uuid4().hex[:12]}"

    try:
        data = await paystack.initialize_transaction(
            email=email_clean,
            amount_kobo=PREMIUM_PLAN_AMOUNT_KOBO,
            plan_code=plan_code,
            callback_url=_paystack_callback_url(request),
            reference=reference,
            metadata=metadata,
        )
    except paystack.PaystackError as e:
        raise HTTPException(status_code=502, detail=f"Paystack error: {e}") from e

    if user_doc:
        await db.users.update_one(
            {"id": user_doc["id"]},
            {
                "$set": {
                    "pending_paystack_reference": data["reference"],
                    "pending_paystack_reference_at": datetime.now(timezone.utc),
                }
            },
        )
    return RedirectResponse(url=data["authorization_url"], status_code=303)

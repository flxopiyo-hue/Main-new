"""Resend email transport for transactional emails.

Currently only the password-reset flow calls in here. The module is kept
thin and provider-agnostic so a future switch (SendGrid, SES, Postmark)
touches only this file. All email payloads are strongly typed at the
call-site so we don't fan out template concerns here.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import resend  # type: ignore

logger = logging.getLogger("oromona.mailer")

# Read at import time — mirrors the Paystack pattern in core/paystack.py.
_API_KEY: str = os.environ.get("RESEND_API_KEY", "").strip()
FROM_EMAIL: str = os.environ.get("RESEND_FROM_EMAIL", "onboarding@resend.dev").strip()
FROM_NAME: str = os.environ.get("RESEND_FROM_NAME", "Oromona").strip()

# Best-effort: bind SDK key once. If missing the send call will surface
# a clear ResendConfigError at call time — better than a silent failure.
if _API_KEY:
    resend.api_key = _API_KEY


class ResendConfigError(RuntimeError):
    """Raised when Resend is called but not configured."""


class ResendSendError(RuntimeError):
    """Wraps HTTP / SDK failures from Resend into a single exception type
    so callers only have to catch one thing."""


def is_configured() -> bool:
    return bool(_API_KEY)


def send_email(
    *,
    to: str,
    subject: str,
    html: str,
    text: str,
    reply_to: Optional[str] = None,
) -> str:
    """Send an email via Resend and return the provider message id.

    Raises `ResendConfigError` when the API key isn't set (dev/preview
    environments without a key) — callers should catch this and fall
    back gracefully (e.g. log the reset link so testers can still verify
    the flow).
    """
    if not is_configured():
        raise ResendConfigError(
            "RESEND_API_KEY missing — set it in /app/backend/.env before "
            "sending transactional email."
        )

    payload: dict = {
        "from": f"{FROM_NAME} <{FROM_EMAIL}>",
        "to": [to],
        "subject": subject,
        "html": html,
        "text": text,
    }
    if reply_to:
        payload["reply_to"] = reply_to

    try:
        r = resend.Emails.send(payload)  # type: ignore[attr-defined]
    except Exception as e:  # pragma: no cover — network / SDK-level errors
        logger.exception("Resend send failed")
        raise ResendSendError(str(e)) from e

    message_id = (r or {}).get("id", "")
    logger.info("Resend email sent id=%s to=%s subject=%r", message_id, to, subject)
    return message_id


# ---------------------------------------------------------------------------
# Password reset template
# ---------------------------------------------------------------------------
def password_reset_template(*, name: str, web_link: str, deep_link: str) -> tuple[str, str]:
    """Return (html, text) tuple for the password-reset email."""
    display_name = (name or "").strip() or "there"
    html = f"""
    <!DOCTYPE html>
    <html>
      <body style="margin:0;padding:0;background:#FAFAF7;font-family:Georgia,'Times New Roman',serif;color:#1F0A08;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="520" cellspacing="0" cellpadding="0" style="background:#FFF7EE;border:1px solid #E7DCC7;">
                <tr>
                  <td style="padding:28px 32px;background:#1F0A08;">
                    <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#C88A3D;letter-spacing:4px;">OROMONA</div>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.5px;color:rgba(255,247,238,0.7);margin-top:4px;">FASHION · KENYA · FIT ON 1ST TRY</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px;">
                    <h1 style="margin:0 0 12px 0;font-size:24px;letter-spacing:-0.5px;color:#1F0A08;">Reset your password, {display_name}</h1>
                    <p style="margin:0 0 16px 0;font-size:15px;line-height:22px;color:#3B160F;">
                      Someone (hopefully you) requested a password reset for your Oromona account. Tap the button below to choose a new password.
                      This link expires in 30 minutes.
                    </p>
                    <p style="margin:24px 0;text-align:center;">
                      <a href="{web_link}" style="display:inline-block;background:#1F0A08;color:#C88A3D;text-decoration:none;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:1.5px;">RESET MY PASSWORD</a>
                    </p>
                    <p style="margin:16px 0 0 0;font-size:13px;color:#7A6B5A;">
                      On mobile? <a href="{deep_link}" style="color:#7A3B18;">Open the Oromona app</a> directly.
                    </p>
                    <p style="margin:24px 0 0 0;font-size:12px;color:#7A6B5A;line-height:18px;">
                      Didn't request this? You can safely ignore this email — your password won't change unless you follow the link above.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px 32px;border-top:1px solid #E7DCC7;font-size:11px;color:#7A6B5A;">
                    Sent by Oromona · Nairobi. If the button doesn't work, paste this URL into your browser:<br/>
                    <span style="word-break:break-all;color:#3B160F;">{web_link}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
    """.strip()

    text = (
        f"Hi {display_name},\n\n"
        "Someone requested a password reset for your Oromona account.\n"
        "Open this link within 30 minutes to choose a new password:\n\n"
        f"  {web_link}\n\n"
        f"On your phone? Deep-link into the app: {deep_link}\n\n"
        "Didn't request this? Ignore this email — your password won't change.\n\n"
        "— Oromona · Nairobi"
    )
    return html, text

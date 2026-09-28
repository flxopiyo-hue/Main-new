"""Best-effort buyer email notifications for key order milestones.

Only THREE milestones ever email the buyer (everything else is tracked
in-app):

  * ``paid``               — payment went through, funds held in escrow
  * ``out_for_delivery``   — a rider picked the parcel up (rider flow only)
  * ``delivered``          — the item was handed over (code confirmed)

These are fire-and-forget: a failure to send (Resend down, missing key
on a given environment, bounced address) must NEVER break the payment /
delivery request itself, so every call is wrapped and swallowed here.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from core import mailer
from core.db import db

logger = logging.getLogger("oromona.notify")

_KINDS = {"paid", "out_for_delivery", "delivered"}


async def send_order_update(order: Dict[str, Any], kind: str) -> None:
    """Email the buyer about an order milestone. Never raises.

    ``order`` only needs ``buyer_id`` + ``item_name`` (an order document
    or a light dict built from a courier job both work).
    """
    if kind not in _KINDS:
        return
    try:
        if not mailer.is_configured():
            return
        buyer = await db.users.find_one(
            {"id": order.get("buyer_id")},
            {"_id": 0, "email": 1, "full_name": 1},
        )
        email = (buyer or {}).get("email")
        if not email:
            return
        subject, html, text = mailer.order_update_template(
            kind=kind,
            name=(buyer or {}).get("full_name") or "",
            item_name=order.get("item_name") or "your item",
        )
        mailer.send_email(to=email, subject=subject, html=html, text=text)
    except Exception as e:  # pragma: no cover — best-effort side effect
        logger.warning(
            "order email (%s) skipped for order %s: %s",
            kind, order.get("id"), e,
        )

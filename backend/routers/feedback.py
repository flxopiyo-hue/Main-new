"""In-app feedback — lets any signed-in user send a comment / bug report,
and lets admins read them. Used to collect tester feedback during Google
Play closed testing. Feedback is stored in the ``feedback`` collection and
emailed best-effort to FEEDBACK_NOTIFY_EMAIL when that env var is set.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core.db import db
from core.security import get_current_user, require_admin

router = APIRouter()
logger = logging.getLogger("oromona.feedback")


class FeedbackIn(BaseModel):
    message: str = Field(min_length=3, max_length=2000)
    category: Optional[str] = Field(default=None, max_length=40)
    app_version: Optional[str] = Field(default=None, max_length=40)
    platform: Optional[str] = Field(default=None, max_length=20)


class FeedbackOut(BaseModel):
    id: str
    user_id: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    message: str
    category: Optional[str] = None
    app_version: Optional[str] = None
    platform: Optional[str] = None
    created_at: datetime


@router.post("/feedback", response_model=FeedbackOut, status_code=201)
async def submit_feedback(
    body: FeedbackIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> FeedbackOut:
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user.get("id"),
        "email": user.get("email"),
        "role": user.get("role"),
        "full_name": user.get("full_name"),
        "message": body.message.strip(),
        "category": (body.category or "general").strip(),
        "app_version": body.app_version,
        "platform": body.platform,
        "created_at": datetime.now(timezone.utc),
    }
    await db.feedback.insert_one({**doc})
    _notify(doc)
    return FeedbackOut(**doc)


@router.get("/admin/feedback", response_model=List[FeedbackOut])
async def list_feedback(
    _: Dict[str, Any] = Depends(require_admin),
) -> List[FeedbackOut]:
    docs = (
        await db.feedback.find({}, {"_id": 0})
        .sort("created_at", -1)
        .limit(300)
        .to_list(length=300)
    )
    return [FeedbackOut(**d) for d in docs]


def _notify(doc: Dict[str, Any]) -> None:
    """Best-effort email to the team; never raises."""
    to = os.environ.get("FEEDBACK_NOTIFY_EMAIL")
    if not to:
        return
    try:
        from core import mailer

        if not mailer.is_configured():
            return
        subject = f"Oromona feedback ({doc.get('category')}) from {doc.get('email') or 'a user'}"
        body = (
            f"From: {doc.get('full_name') or ''} <{doc.get('email') or ''}> "
            f"({doc.get('role')})\n"
            f"Platform: {doc.get('platform')}  App: {doc.get('app_version')}\n\n"
            f"{doc.get('message')}"
        )
        mailer.send_email(to=to, subject=subject, html=f"<pre>{body}</pre>", text=body)
    except Exception as e:  # pragma: no cover — best effort
        logger.warning("feedback notify skipped: %s", e)

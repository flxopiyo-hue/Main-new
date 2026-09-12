"""Boot diagnostics sink.

  POST /api/diag   — the mobile app posts boot-stage events (fonts ready,
                     first screen mounted, layout sizes, caught errors).
                     Used to debug "blank screen on device" reports where
                     we have no access to the tester's device logs.

Events are logged at INFO (so `tail -f backend.out.log` shows them live)
and persisted to the `boot_diag` collection for later inspection.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from core.db import db

logger = logging.getLogger("aurafit.diag")

router = APIRouter()


class DiagEvent(BaseModel):
    stage: str
    data: Optional[Dict[str, Any]] = None
    t: Optional[float] = None


class DiagBatch(BaseModel):
    session: str
    device: Dict[str, Any] = Field(default_factory=dict)
    events: List[DiagEvent]


@router.post("/diag")
async def post_diag(batch: DiagBatch) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    dev = batch.device
    head = (
        f"[diag {batch.session}] {dev.get('platform')} {dev.get('osVersion')} "
        f"dev={dev.get('dev')} env={dev.get('execEnv')} expoGo={dev.get('expoGoVersion')} "
        f"host={dev.get('hostUri')} win={dev.get('window')}"
    )
    docs = []
    for ev in batch.events:
        logger.info("%s | +%sms %s %s", head, ev.t, ev.stage, ev.data or "")
        docs.append(
            {
                "session": batch.session,
                "device": dev,
                "stage": ev.stage,
                "data": ev.data,
                "t": ev.t,
                "received_at": now,
            }
        )
    if docs:
        await db.boot_diag.insert_many(docs)
    return {"ok": True, "count": len(docs)}

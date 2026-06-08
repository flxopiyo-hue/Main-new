"""Body profile routes: measurements, photos, AI estimation via Gemini multimodal."""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
from fastapi import APIRouter, Depends, HTTPException

from core.config import EMERGENT_LLM_KEY, VISION_MODEL
from core.db import db
from core.images import strip_data_prefix
from core.security import get_current_user
from models import EstimateMeasurementsIn, Measurements, ProfileIn, ProfileOut

logger = logging.getLogger("aurafit.profile")
router = APIRouter()


@router.get("/profile", response_model=ProfileOut)
async def get_profile(user: Dict[str, Any] = Depends(get_current_user)) -> ProfileOut:
    doc = await db.profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    if not doc:
        return ProfileOut(
            user_id=user["id"],
            measurements=Measurements(),
            preferred_size=None,
            has_front_photo=False,
            has_side_photo=False,
            updated_at=datetime.now(timezone.utc),
        )
    return ProfileOut(
        user_id=doc["user_id"],
        measurements=Measurements(**doc.get("measurements", {})),
        preferred_size=doc.get("preferred_size"),
        has_front_photo=bool(doc.get("front_photo_b64")),
        has_side_photo=bool(doc.get("side_photo_b64")),
        updated_at=doc["updated_at"],
    )


@router.put("/profile", response_model=ProfileOut)
async def upsert_profile(
    body: ProfileIn, user: Dict[str, Any] = Depends(get_current_user)
) -> ProfileOut:
    now = datetime.now(timezone.utc)
    update = {
        "user_id": user["id"],
        "measurements": body.measurements.model_dump(),
        "preferred_size": body.preferred_size,
        "updated_at": now,
    }
    if body.front_photo_b64:
        update["front_photo_b64"] = strip_data_prefix(body.front_photo_b64)
    if body.side_photo_b64:
        update["side_photo_b64"] = strip_data_prefix(body.side_photo_b64)
    await db.profiles.update_one(
        {"user_id": user["id"]}, {"$set": update}, upsert=True
    )
    doc = await db.profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    return ProfileOut(
        user_id=doc["user_id"],
        measurements=Measurements(**doc.get("measurements", {})),
        preferred_size=doc.get("preferred_size"),
        has_front_photo=bool(doc.get("front_photo_b64")),
        has_side_photo=bool(doc.get("side_photo_b64")),
        updated_at=doc["updated_at"],
    )


@router.post("/profile/estimate", response_model=Measurements)
async def estimate_measurements(
    body: EstimateMeasurementsIn, user: Dict[str, Any] = Depends(get_current_user)
) -> Measurements:
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")
    front_b64 = strip_data_prefix(body.front_photo_b64)
    side_b64 = strip_data_prefix(body.side_photo_b64)
    system_msg = (
        "You are a professional fit specialist. Estimate body measurements in centimeters "
        "from two photos (front and side view). Respond ONLY with valid JSON of the form "
        '{"height_cm": number, "chest_cm": number, "waist_cm": number, "hips_cm": number, '
        '"shoulders_cm": number, "inseam_cm": number}. Provide best reasonable estimates.'
    )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"measure-{user['id']}-{uuid.uuid4()}",
        system_message=system_msg,
    ).with_model("gemini", VISION_MODEL)

    user_text = "Front view and side view photos attached."
    if body.height_cm:
        user_text += (
            f" The person is approximately {body.height_cm} cm tall "
            "(use this as a calibration anchor)."
        )
    user_text += " Return strict JSON only, no commentary."

    msg = UserMessage(
        text=user_text,
        file_contents=[ImageContent(front_b64), ImageContent(side_b64)],
    )
    try:
        raw = await chat.send_message(msg)
    except Exception as e:
        logger.exception("Gemini measurement error")
        raise HTTPException(status_code=502, detail=f"AI estimation failed: {e}")

    text = raw.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
        if not match:
            raise HTTPException(status_code=502, detail="Could not parse AI response")
        parsed = json.loads(match.group(0))

    return Measurements(
        height_cm=parsed.get("height_cm"),
        chest_cm=parsed.get("chest_cm"),
        waist_cm=parsed.get("waist_cm"),
        hips_cm=parsed.get("hips_cm"),
        shoulders_cm=parsed.get("shoulders_cm"),
        inseam_cm=parsed.get("inseam_cm"),
    )

"""Try-on: multi-angle Gemini Nano Banana generation, history, share."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
from fastapi import APIRouter, Depends, HTTPException

from core.config import EMERGENT_LLM_KEY, MAX_TRYON_ANGLES, NANO_BANANA_MODEL
from core.db import db
from core.images import strip_data_prefix, watermark_image
from core.security import get_current_user
from models import TryOnImage, TryOnIn, TryOnOut, TryOnShareOut

logger = logging.getLogger("aurafit.tryon")
router = APIRouter()

# Per-angle prompt instructions used to coax Nano Banana into rendering the
# same person + garment from different viewing angles.
ANGLE_INSTRUCTIONS: Dict[str, str] = {
    "front": (
        "FRONT VIEW: facing the camera straight-on, arms relaxed at sides, "
        "studio backdrop, soft daylight, full body framing from head to feet."
    ),
    "three_quarter": (
        "THREE-QUARTER VIEW: same person rotated about 45 degrees, weight on "
        "back foot, contrapposto fashion stance, garment fully visible from this "
        "angle, soft cinematic light, full body framing."
    ),
    "side": (
        "SIDE PROFILE VIEW: same person photographed from a 90-degree side angle, "
        "arms slightly forward, garment silhouette emphasised, studio backdrop, "
        "full body framing from head to feet."
    ),
    "back": (
        "BACK VIEW: same person facing away from the camera so the back of the "
        "garment is the focal point (back seams, hem, drape clearly visible), "
        "head turned slightly toward the camera in 3/4 over-the-shoulder pose, "
        "full body framing."
    ),
}

SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"]


# ---------------------------------------------------------------------------
# Smart-sizing helpers
# ---------------------------------------------------------------------------
async def _seller_size_delta(seller_id: str) -> float:
    """Average fit feedback for a seller, mapping small=+1, perfect=0, large=-1.

    Positive delta → buyers feel pieces run small → recommend a size UP.
    Negative delta → buyers feel pieces run large → recommend a size DOWN.
    """
    cursor = db.orders.find(
        {"seller_id": seller_id, "fit_feedback": {"$in": ["small", "perfect", "large"]}},
        {"_id": 0, "fit_feedback": 1},
    )
    total = 0.0
    n = 0
    async for doc in cursor:
        v = {"small": 1, "perfect": 0, "large": -1}.get(doc.get("fit_feedback"))
        if v is None:
            continue
        total += v
        n += 1
    return (total / n) if n else 0.0


def _shift_size(label: str, steps: int) -> Optional[str]:
    if label not in SIZE_ORDER or steps == 0:
        return None
    idx = SIZE_ORDER.index(label) + steps
    if idx < 0 or idx >= len(SIZE_ORDER):
        return None
    return SIZE_ORDER[idx]


async def _compute_fit_summary(user: Dict[str, Any], item: Dict[str, Any]) -> str:
    profile = await db.profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    if not profile:
        return "Add your body measurements for a personalized fit recommendation."
    m = profile.get("measurements", {})
    chest = m.get("chest_cm")
    waist = m.get("waist_cm")
    hips = m.get("hips_cm")
    best: Optional[Dict[str, Any]] = None
    best_score = float("inf")
    for s in item.get("sizes", []):
        score = 0.0
        if chest and s.get("chest_cm"):
            score += abs(chest - s["chest_cm"])
        if waist and s.get("waist_cm"):
            score += abs(waist - s["waist_cm"])
        if hips and s.get("hips_cm"):
            score += abs(hips - s["hips_cm"])
        if score < best_score:
            best_score = score
            best = s
    if not best:
        return "Size recommendation unavailable for this item."

    base_size = best["label"]
    # Apply per-seller smart-sizing delta.
    delta = await _seller_size_delta(item["seller_id"])
    shift = 0
    if delta >= 0.5:
        shift = 1
    elif delta <= -0.5:
        shift = -1
    shifted = _shift_size(base_size, shift) if shift else None
    smart_note: Optional[str] = None
    if shifted:
        direction = "up" if shift > 0 else "down"
        smart_note = (
            f"Buyers say {item.get('seller_name', 'this brand')} runs "
            f"{'small' if shift > 0 else 'large'} — we suggest sizing {direction}."
        )

    final_size = shifted or base_size

    # Demographic flavor.
    gender = user.get("gender")
    age = user.get("age")
    persona: Optional[str] = None
    if gender in ("male", "female") and age:
        gender_word = "men" if gender == "male" else "women"
        persona = f"typically suits {age}-yr-old {gender_word} with your measurements"
    elif age:
        persona = f"typically suits {age}-year-olds with your measurements"

    base_line = (
        f"Recommended size: {final_size} — {persona}."
        if persona
        else f"Recommended size: {final_size} (closest match to your measurements)."
    )
    if smart_note:
        return base_line + " " + smart_note
    return base_line


# ---------------------------------------------------------------------------
# Multi-angle generation core
# ---------------------------------------------------------------------------
async def _generate_single_angle(
    *,
    body_b64: str,
    garment_b64: str,
    item: Dict[str, Any],
    user: Dict[str, Any],
    angle: str,
    persona: str,
) -> Optional[str]:
    """Generate a single angle for the try-on. Returns base64 image or None on failure."""
    angle_hint = ANGLE_INSTRUCTIONS.get(angle, ANGLE_INSTRUCTIONS["front"])
    system_msg = (
        "You are a fashion virtual try-on generator. You will receive two images: "
        "(1) a person's full-body photo, and (2) a clothing item. Generate a realistic "
        "photo of the same person wearing the clothing item, preserving the person's "
        "identity (face, skin tone, hair) and body shape. Replace only the relevant "
        "clothing region. The output must be a single photorealistic image with a clean, "
        "neutral studio backdrop."
    )
    chat = (
        LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"tryon-{user['id']}-{angle}-{uuid.uuid4()}",
            system_message=system_msg,
        )
        .with_model("gemini", NANO_BANANA_MODEL)
        .with_params(modalities=["image", "text"])
    )

    msg = UserMessage(
        text=(
            f"Generate a virtual try-on at the {angle.replace('_', ' ').upper()} angle. "
            f"{persona}"
            f"The person is wearing the garment '{item['name']}' "
            f"(category: {item['category']}, audience: {item.get('audience', 'unisex')}). "
            f"{angle_hint} "
            f"Maintain the same identity, skin tone, hair, and overall body proportions. "
            f"Photorealistic, full body, studio quality, fashion editorial."
        ),
        file_contents=[ImageContent(body_b64), ImageContent(garment_b64)],
    )
    try:
        _text, images = await chat.send_message_multimodal_response(msg)
    except Exception as e:
        logger.warning("Try-on angle %s failed: %s", angle, e)
        return None
    if not images:
        return None
    return images[0]["data"]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
# Route ordering: /tryon/history must come BEFORE /tryon/{tryon_id}/share — but
# since both are literal-segment routes (history is a leaf, share is a 2-segment
# trailing path), there is no actual conflict; we still declare them in order.
@router.post("/tryon", response_model=TryOnOut)
async def generate_tryon(
    body: TryOnIn, user: Dict[str, Any] = Depends(get_current_user)
) -> TryOnOut:
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")

    item = await db.items.find_one({"id": body.item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    body_b64: Optional[str] = None
    if body.body_photo_b64:
        body_b64 = strip_data_prefix(body.body_photo_b64)
    elif body.use_profile_photo:
        profile = await db.profiles.find_one({"user_id": user["id"]}, {"_id": 0})
        if profile and profile.get("front_photo_b64"):
            body_b64 = profile["front_photo_b64"]
    if not body_b64:
        raise HTTPException(
            status_code=400,
            detail="No body photo. Provide body_photo_b64 or set a profile front photo.",
        )

    garment_b64 = item["image_b64"]

    # Personalize the prompt with user demographics for better try-on.
    gender = user.get("gender")
    age = user.get("age")
    persona_bits: List[str] = []
    if gender == "male":
        persona_bits.append("the person is male")
    elif gender == "female":
        persona_bits.append("the person is female")
    if age:
        persona_bits.append(f"approximately {age} years old")
    persona = (", ".join(persona_bits) + ". ") if persona_bits else ""

    # Validate & de-dupe angles (preserve order). Always ensure "front" comes first.
    seen: set[str] = set()
    angles: List[str] = []
    if "front" in body.angles or not body.angles:
        angles.append("front")
        seen.add("front")
    for a in body.angles:
        if a in ANGLE_INSTRUCTIONS and a not in seen:
            angles.append(a)
            seen.add(a)
        if len(angles) >= MAX_TRYON_ANGLES:
            break

    # Run angle generations in parallel.
    coros = [
        _generate_single_angle(
            body_b64=body_b64,
            garment_b64=garment_b64,
            item=item,
            user=user,
            angle=a,
            persona=persona,
        )
        for a in angles
    ]
    results = await asyncio.gather(*coros, return_exceptions=False)

    angle_images: List[TryOnImage] = []
    for ang, img_b64 in zip(angles, results):
        if img_b64:
            angle_images.append(TryOnImage(angle=ang, image_b64=img_b64))  # type: ignore[arg-type]

    if not angle_images:
        raise HTTPException(
            status_code=502, detail="AI did not return any images. Please try again."
        )

    # Ensure "front" is always present in the response — fallback to first.
    front_image = next((a for a in angle_images if a.angle == "front"), angle_images[0])

    # Compute fit suggestion using stored measurements + demographics.
    fit_summary = await _compute_fit_summary(user, item)

    # Bump per-item try-on counter for seller analytics (one per try-on, not per angle).
    await db.items.update_one({"id": item["id"]}, {"$inc": {"try_ons": 1}})

    tryon_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    await db.tryons.insert_one(
        {
            "id": tryon_id,
            "user_id": user["id"],
            "item_id": item["id"],
            # Backward-compat single field still stored.
            "result_image_b64": front_image.image_b64,
            # New: array of {angle, image_b64}
            "images": [a.model_dump() for a in angle_images],
            "fit_summary": fit_summary,
            "created_at": now,
        }
    )
    return TryOnOut(
        id=tryon_id,
        item_id=item["id"],
        result_image_b64=front_image.image_b64,
        images=angle_images,
        fit_summary=fit_summary,
        created_at=now,
    )


@router.get("/tryon/history", response_model=List[TryOnOut])
async def tryon_history(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[TryOnOut]:
    docs = (
        await db.tryons.find({"user_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(50)
    )
    out: List[TryOnOut] = []
    for d in docs:
        raw_imgs = d.get("images") or []
        imgs = [TryOnImage(**a) for a in raw_imgs if a.get("image_b64")]
        # Legacy try-ons (pre multi-angle) only have result_image_b64.
        if not imgs and d.get("result_image_b64"):
            imgs = [TryOnImage(angle="front", image_b64=d["result_image_b64"])]
        out.append(
            TryOnOut(
                id=d["id"],
                item_id=d["item_id"],
                result_image_b64=d.get("result_image_b64", imgs[0].image_b64 if imgs else ""),
                images=imgs,
                fit_summary=d.get("fit_summary"),
                created_at=d["created_at"],
            )
        )
    return out


@router.get("/tryon/{tryon_id}/share", response_model=TryOnShareOut)
async def share_tryon(
    tryon_id: str,
    fmt: str = "square",
    angle: str = "front",
    user: Dict[str, Any] = Depends(get_current_user),
) -> TryOnShareOut:
    if fmt not in ("square", "story"):
        raise HTTPException(status_code=400, detail="fmt must be 'square' or 'story'")
    tryon = await db.tryons.find_one({"id": tryon_id}, {"_id": 0})
    if not tryon:
        raise HTTPException(status_code=404, detail="Try-on not found")
    if tryon["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your try-on")
    item = await db.items.find_one({"id": tryon["item_id"]}, {"_id": 0})
    seller_name = item.get("seller_name", "AuraFit Designer") if item else "AuraFit Designer"
    item_name = item.get("name", "an AuraFit piece") if item else "an AuraFit piece"
    # Pick the requested angle (default front), fall back gracefully to first available.
    angle_imgs = tryon.get("images") or []
    chosen_b64: Optional[str] = None
    for a in angle_imgs:
        if a.get("angle") == angle and a.get("image_b64"):
            chosen_b64 = a["image_b64"]
            break
    if not chosen_b64:
        # legacy fallback
        chosen_b64 = tryon.get("result_image_b64") or (
            angle_imgs[0]["image_b64"] if angle_imgs else None
        )
    if not chosen_b64:
        raise HTTPException(status_code=404, detail="No image to share")
    try:
        watermarked = watermark_image(chosen_b64, seller_name, fmt=fmt)
    except Exception as e:
        logger.exception("Watermark error")
        raise HTTPException(status_code=500, detail=f"Share image failed: {e}")
    caption = f"Tried on {item_name} by {seller_name} with @AuraFit ✨"
    return TryOnShareOut(image_b64=watermarked, caption=caption)

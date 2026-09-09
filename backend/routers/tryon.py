"""Try-on: multi-angle Gemini Nano Banana generation, history, share."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
from fastapi import APIRouter, Depends, HTTPException, Query

from core.config import EMERGENT_LLM_KEY, MAX_TRYON_ANGLES, NANO_BANANA_MODEL
from core.db import db
from core.images import strip_data_prefix, watermark_image
from core.security import get_current_user
from models import (
    GarmentTryOnIn,
    LAYER_ORDER,
    OutfitTryOnIn,
    TryOnImage,
    TryOnIn,
    TryOnOut,
    TryOnPinIn,
    TryOnPinOut,
    TryOnShareOut,
    garment_type_label,
    infer_garment_type,
)

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

# Appended to every try-on prompt so the model never invents or alters
# the buyer's face/identity (iteration 28 face-fidelity requirement).
IDENTITY_LOCK = (
    "CRITICAL IDENTITY RULE: preserve the person's face, skin tone, hair and "
    "body identity EXACTLY as in the source photo — treat the face as "
    "pixel-faithful and untouchable. Never beautify, swap, age, slim, or "
    "otherwise alter facial features, expression, or head shape. Whenever "
    "the face is visible it must be recognisably the same person from the "
    "input photo."
)


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
    extra_note: str = "",
    garment_back_b64: Optional[str] = None,
) -> Optional[str]:
    """Generate a single angle for the try-on. Returns base64 image or None on failure.

    When ``garment_back_b64`` is provided (sellers upload photo 1 = front,
    photo 2 = back) it is attached as a third reference image so the model
    renders the correct design on each side — crucial when the garment has
    different prints front vs back.
    """
    angle_hint = ANGLE_INSTRUCTIONS.get(angle, ANGLE_INSTRUCTIONS["front"])
    system_msg = (
        "You are a fashion virtual try-on generator. You will receive a person's "
        "full-body photo followed by garment reference photos: the garment's FRONT "
        "view and, when provided, its BACK view. Generate a realistic photo of the "
        "same person wearing the clothing item. Replace only the relevant clothing "
        "region. The output must be a single photorealistic image with a clean, "
        "neutral studio backdrop. "
        + IDENTITY_LOCK
    )
    file_contents = [ImageContent(body_b64), ImageContent(garment_b64)]
    back_note = ""
    if garment_back_b64:
        file_contents.append(ImageContent(garment_back_b64))
        back_note = (
            "Photo 2 shows the garment's FRONT and photo 3 shows its BACK — the two "
            "sides may carry different prints or graphics. When the person's back is "
            "visible, reproduce the back design from photo 3 faithfully; when the "
            "front is visible, reproduce the front design from photo 2. Never put "
            "the front print on the back or vice versa. "
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
            f"{extra_note}"
            f"{back_note}"
            f"{angle_hint} "
            f"{IDENTITY_LOCK} "
            f"Photorealistic, full body, studio quality, fashion editorial."
        ),
        file_contents=file_contents,
    )
    try:
        _text, images = await chat.send_message_multimodal_response(msg)
    except Exception as e:
        logger.warning("Try-on angle %s failed: %s", angle, e)
        return None
    if not images:
        return None
    return images[0]["data"]


def _build_outfit_rules(items: List[Dict[str, Any]], tuck_style: str = "auto") -> List[str]:
    """Generate human-readable styling rules to feed to Gemini based on the
    composition of an outfit.

    ``tuck_style``: "tucked" | "untucked" force the top's fit over bottoms;
    "auto" keeps the old behaviour (a belt in the outfit implies tucked,
    otherwise the model decides).
    """
    types = {it.get("garment_type") or infer_garment_type(it) for it in items}
    rules: List[str] = []
    has_belt = "belt" in types
    has_top = bool(types & {"shirt", "blouse"})
    has_bottom = bool(types & {"trousers", "shorts", "skirt"})
    has_shorts = "shorts" in types
    has_socks = "socks" in types
    has_vest_under = "vest_under" in types
    has_tie = "tie" in types
    has_outerwear = "outerwear" in types
    has_waistcoat = "waistcoat" in types

    if has_top and has_bottom:
        if tuck_style == "tucked":
            rules.append(
                "The shirt/top is FULLY TUCKED into the trousers/shorts/skirt with a clean waistline"
                + (", the belt visible around the waist." if has_belt else ".")
            )
        elif tuck_style == "untucked":
            rules.append(
                "The shirt/top is worn UNTUCKED — its hem hangs naturally OVER the waistband of the "
                "trousers/shorts/skirt. Do NOT tuck it in."
            )
        elif has_belt:
            rules.append(
                "The shirt is fully tucked into the trousers/shorts, with the belt visible around the waist."
            )
    if has_vest_under and has_top:
        rules.append("The undershirt (vest) sits next to the skin, completely hidden beneath the shirt.")
    if has_waistcoat and has_top:
        rules.append("The waistcoat is buttoned over the shirt; the shirt sleeves and collar are visible.")
    if has_tie and has_top:
        rules.append("The necktie sits over the shirt collar, knotted at the neck. If a jacket is present, the tie is partially visible between the lapels.")
    if has_outerwear:
        rules.append("The jacket/outerwear is worn unbuttoned or open, layered OVER the shirt/waistcoat/tie. Outerwear is the outermost upper layer.")
    if has_shorts and has_socks:
        rules.append("The shorts end above the knee; the socks are visible on the lower legs above the shoes.")
    if "shoes" in types:
        rules.append("The shoes are worn on the feet; if socks are part of the outfit, the socks tuck into the shoes.")
    if "scarf" in types:
        rules.append("The scarf is draped around the neck, visible over the shirt and under the jacket.")
    if "hat" in types:
        rules.append("The hat is worn on the head, not held in the hand.")
    return rules


async def _generate_outfit_angle(
    *,
    body_b64: str,
    items: List[Dict[str, Any]],
    user: Dict[str, Any],
    angle: str,
    persona: str,
    tuck_style: str = "auto",
) -> Optional[str]:
    """Render the person wearing a composed outfit (multiple garments) at one angle.

    `items` are expected to already be sorted by LAYER_ORDER (innermost first).
    """
    angle_hint = ANGLE_INSTRUCTIONS.get(angle, ANGLE_INSTRUCTIONS["front"])

    # Build the per-garment description block. Sellers upload photo 1 = FRONT
    # and photo 2 = BACK, so we attach each garment's front shot in layer
    # order, then append any available back shots (numbered after the fronts)
    # so the model renders the correct design on each side.
    garment_lines: List[str] = []
    front_imgs: List[str] = []
    backs: List[tuple] = []  # (garment_index, garment_name, back_b64)
    for idx, it in enumerate(items, start=1):
        gtype = it.get("garment_type") or infer_garment_type(it)
        gname = it.get("name", "garment")
        gallery = list(it.get("images") or [])
        if not gallery and it.get("image_b64"):
            gallery = [it["image_b64"]]
        front_imgs.append(gallery[0] if gallery else it["image_b64"])
        # Photos 2..N — keep their order aligned with this list.
        garment_lines.append(
            f"  · Garment {idx} (photo {idx + 1}): a {garment_type_label(gtype)} called '{gname}' — FRONT view."
        )
        if len(gallery) > 1:
            backs.append((idx, gname, gallery[1]))

    back_lines: List[str] = []
    for pos, (gidx, gname, _b64) in enumerate(backs):
        back_lines.append(
            f"  · Photo {len(items) + 2 + pos}: BACK view of garment {gidx} ('{gname}') — "
            "use it as the authoritative reference for that piece's back design."
        )
    backs_text = (
        "\nBack-side references (front and back may carry different prints — never swap them):\n"
        + "\n".join(back_lines)
        if back_lines
        else ""
    )

    rules = _build_outfit_rules(items, tuck_style)
    rules_text = (
        "Layering & styling rules to obey strictly:\n"
        + "\n".join(f"  - {r}" for r in rules)
        if rules
        else "No special layering rules apply."
    )

    system_msg = (
        "You are a fashion virtual try-on generator that composes multiple garments "
        "onto one person. You will receive a person photo followed by N garment photos "
        "in INNERMOST-FIRST layer order (FRONT views), optionally followed by BACK-view "
        "reference photos for some garments. Compose them onto the person as a single "
        "coherent outfit, respecting the styling rules provided. Produce ONE "
        "photorealistic image on a clean, neutral studio backdrop. "
        + IDENTITY_LOCK
    )
    chat = (
        LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"outfit-{user['id']}-{angle}-{uuid.uuid4()}",
            system_message=system_msg,
        )
        .with_model("gemini", NANO_BANANA_MODEL)
        .with_params(modalities=["image", "text"])
    )

    msg = UserMessage(
        text=(
            f"Generate a virtual outfit try-on at the {angle.replace('_', ' ').upper()} angle.\n"
            f"{persona}\n"
            f"The outfit consists of {len(items)} garment(s), layered from skin outward:\n"
            + "\n".join(garment_lines)
            + backs_text
            + "\n\n"
            + rules_text
            + "\n\n"
            + angle_hint
            + " "
            + IDENTITY_LOCK
            + " Photorealistic, full body, studio quality, fashion editorial. "
            "Return a single image."
        ),
        file_contents=[ImageContent(body_b64)]
        + [ImageContent(b) for b in front_imgs]
        + [ImageContent(b) for (_gidx, _gname, b) in backs],
    )
    try:
        _text, images = await chat.send_message_multimodal_response(msg)
    except Exception as e:
        logger.warning("Outfit angle %s failed: %s", angle, e)
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

    # Enforce 7-try-ons-per-week cap for Free users. Premium users have
    # `assert_can_tryon` skip immediately. Client catches the 402 and
    # opens the paywall modal. Multi-angle output is available on ALL
    # tiers — the only Free-tier gate here is the weekly cap.
    from core.gating import assert_can_tryon
    await assert_can_tryon(user)

    item = await db.items.find_one({"id": body.item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    body_b64: Optional[str] = None
    photo_user = user
    if body.body_photo_b64:
        body_b64 = strip_data_prefix(body.body_photo_b64)
    elif body.use_profile_photo:
        # Resolve which profile's photo to use.
        pid = body.profile_id
        if pid and pid != "self":
            lo = await db.body_profiles.find_one(
                {"id": pid, "user_id": user["id"]}, {"_id": 0}
            )
            if not lo:
                raise HTTPException(status_code=404, detail="Profile not found")
            if lo.get("front_photo_b64"):
                body_b64 = lo["front_photo_b64"]
                # Override persona with loved-one demographics.
                photo_user = {
                    **user,
                    "gender": lo.get("gender"),
                    "age": lo.get("age"),
                }
        if not body_b64:
            profile = await db.profiles.find_one({"user_id": user["id"]}, {"_id": 0})
            if profile and profile.get("front_photo_b64"):
                body_b64 = profile["front_photo_b64"]
    if not body_b64:
        raise HTTPException(
            status_code=400,
            detail="No body photo. Provide body_photo_b64 or set a profile front photo.",
        )

    # Garment references: gallery photo 1 = FRONT, photo 2 = BACK (sellers
    # upload them in that order). Colour-aware: when the buyer picked a colour
    # that has its own photo group we swap that group in, so the try-on shows
    # the exact shade. Even without a photo we still tell the model which
    # colour to render.
    gallery: List[str] = list(item.get("images") or [])
    if not gallery and item.get("image_b64"):
        gallery = [item["image_b64"]]
    garment_b64 = gallery[0] if gallery else item["image_b64"]
    garment_back_b64: Optional[str] = gallery[1] if len(gallery) > 1 else None
    color_note = ""
    if body.color_name:
        target = body.color_name.strip().lower()
        for c in item.get("colors", []):
            if (c.get("name") or "").strip().lower() == target:
                cgallery = list(c.get("images") or [])
                if not cgallery and c.get("image_b64"):
                    cgallery = [c["image_b64"]]
                if cgallery:
                    garment_b64 = cgallery[0]
                    # Prefer the colour's own back shot; fall back to the
                    # item-level back photo for the design reference.
                    if len(cgallery) > 1:
                        garment_back_b64 = cgallery[1]
                color_note = (
                    f"The buyer selected the colour '{c.get('name')}' (hex {c.get('hex')}). "
                    "Render the garment in EXACTLY this colour — match the garment photo's "
                    "shade faithfully, do not shift the hue. "
                )
                break

    # Personalize the prompt with user demographics for better try-on.
    gender = photo_user.get("gender")
    age = photo_user.get("age")
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
            extra_note=color_note,
            garment_back_b64=garment_back_b64,
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


@router.post("/tryon/outfit", response_model=TryOnOut)
async def generate_outfit_tryon(
    body: OutfitTryOnIn, user: Dict[str, Any] = Depends(get_current_user)
) -> TryOnOut:
    """Compose multiple garments onto the user, respecting the layering hierarchy.

    Garments are sorted innermost → outermost via LAYER_ORDER before being sent
    to Gemini Nano Banana. The same multi-angle infrastructure as the single-item
    try-on is reused so the response shape is identical.
    """
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")

    # Gating — Free users share the same weekly cap across all try-on
    # flavours. Multi-angle output is available on all tiers.
    from core.gating import assert_can_tryon
    await assert_can_tryon(user)

    # Fetch all items in one round-trip and preserve user-supplied order before
    # we re-sort by layer.
    items: List[Dict[str, Any]] = []
    async for doc in db.items.find({"id": {"$in": body.item_ids}}, {"_id": 0}):
        items.append(doc)
    if not items:
        raise HTTPException(status_code=404, detail="No items found for the given ids")
    if len(items) > 8:
        raise HTTPException(status_code=400, detail="Maximum 8 items per outfit")

    # Sort innermost → outermost (stable: ties broken by user-supplied order).
    id_position = {iid: i for i, iid in enumerate(body.item_ids)}
    items.sort(
        key=lambda it: (
            LAYER_ORDER.get(
                it.get("garment_type") or infer_garment_type(it), 100
            ),
            id_position.get(it["id"], 999),
        )
    )

    # Body photo resolution (same logic as single-item try-on).
    body_b64: Optional[str] = None
    photo_user = user
    if body.body_photo_b64:
        body_b64 = strip_data_prefix(body.body_photo_b64)
    elif body.use_profile_photo:
        pid = body.profile_id
        if pid and pid != "self":
            lo = await db.body_profiles.find_one(
                {"id": pid, "user_id": user["id"]}, {"_id": 0}
            )
            if not lo:
                raise HTTPException(status_code=404, detail="Profile not found")
            if lo.get("front_photo_b64"):
                body_b64 = lo["front_photo_b64"]
                photo_user = {
                    **user,
                    "gender": lo.get("gender"),
                    "age": lo.get("age"),
                }
        if not body_b64:
            profile = await db.profiles.find_one({"user_id": user["id"]}, {"_id": 0})
            if profile and profile.get("front_photo_b64"):
                body_b64 = profile["front_photo_b64"]
    if not body_b64:
        raise HTTPException(
            status_code=400,
            detail="No body photo. Provide body_photo_b64 or set a profile front photo.",
        )

    # Persona prompt.
    gender = photo_user.get("gender")
    age = photo_user.get("age")
    persona_bits: List[str] = []
    if gender == "male":
        persona_bits.append("the person is male")
    elif gender == "female":
        persona_bits.append("the person is female")
    if age:
        persona_bits.append(f"approximately {age} years old")
    persona = (", ".join(persona_bits) + ". ") if persona_bits else ""

    # Validate & de-dupe angles.
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

    coros = [
        _generate_outfit_angle(
            body_b64=body_b64,
            items=items,
            user=user,
            angle=a,
            persona=persona,
            tuck_style=body.tuck_style,
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

    front_image = next((a for a in angle_images if a.angle == "front"), angle_images[0])

    # Bump try-on counter on every item in the outfit (one per try-on per item).
    for it in items:
        await db.items.update_one({"id": it["id"]}, {"$inc": {"try_ons": 1}})

    tryon_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    fit_summary = (
        f"Outfit composed from {len(items)} pieces: "
        + ", ".join(it["name"] for it in items)
    )
    await db.tryons.insert_one(
        {
            "id": tryon_id,
            "user_id": user["id"],
            # Use the first item as the headline item for legacy /history rendering;
            # the full list lives under `item_ids`.
            "item_id": items[0]["id"],
            "item_ids": [it["id"] for it in items],
            "result_image_b64": front_image.image_b64,
            "images": [a.model_dump() for a in angle_images],
            "fit_summary": fit_summary,
            "is_outfit": True,
            "created_at": now,
        }
    )
    return TryOnOut(
        id=tryon_id,
        item_id=items[0]["id"],
        result_image_b64=front_image.image_b64,
        images=angle_images,
        fit_summary=fit_summary,
        created_at=now,
    )


# ---------------------------------------------------------------------------
# BYO Garment — buyer uploads a clothing photo and we render it on the active
# profile. No item, no seller, no checkout — pure try-on preview.
# ---------------------------------------------------------------------------
@router.post("/tryon/garment", response_model=TryOnOut)
async def generate_byo_garment_tryon(
    body: GarmentTryOnIn, user: Dict[str, Any] = Depends(get_current_user)
) -> TryOnOut:
    if user.get("role") != "buyer":
        raise HTTPException(status_code=403, detail="Only buyers can use BYO Try-On")
    if not body.garment_b64:
        raise HTTPException(status_code=400, detail="Garment photo is required")

    from core.gating import assert_can_tryon
    await assert_can_tryon(user)

    # Resolve body photo (same logic as item try-on).
    body_b64: Optional[str] = None
    photo_user = user
    if body.body_photo_b64:
        body_b64 = strip_data_prefix(body.body_photo_b64)
    elif body.use_profile_photo:
        pid = body.profile_id
        if pid and pid != "self":
            lo = await db.body_profiles.find_one(
                {"id": pid, "user_id": user["id"]}, {"_id": 0}
            )
            if not lo:
                raise HTTPException(status_code=404, detail="Profile not found")
            if lo.get("front_photo_b64"):
                body_b64 = lo["front_photo_b64"]
                photo_user = {
                    **user,
                    "gender": lo.get("gender"),
                    "age": lo.get("age"),
                }
        if not body_b64:
            profile = await db.profiles.find_one({"user_id": user["id"]}, {"_id": 0})
            if profile and profile.get("front_photo_b64"):
                body_b64 = profile["front_photo_b64"]
    if not body_b64:
        raise HTTPException(
            status_code=400,
            detail="No body photo. Add a front photo to your active profile first.",
        )

    garment_b64 = strip_data_prefix(body.garment_b64)
    gtype = body.garment_type or "other"
    label = body.label or "Your garment"

    # Build a synthetic 'item' shape so we can reuse _generate_single_angle.
    pseudo_item: Dict[str, Any] = {
        "id": f"byo-{uuid.uuid4()}",
        "name": label,
        "category": "shirts",  # neutral default
        "audience": "unisex",
        "garment_type": gtype,
    }

    # Persona prompt (mirrors the item try-on path).
    gender = photo_user.get("gender")
    age = photo_user.get("age")
    persona_bits: List[str] = []
    if gender == "male":
        persona_bits.append("the person is male")
    elif gender == "female":
        persona_bits.append("the person is female")
    if age:
        persona_bits.append(f"approximately {age} years old")
    persona = (", ".join(persona_bits) + ". ") if persona_bits else ""

    angles = body.angles or ["front"]

    # Render each angle in parallel.
    coros = [
        _generate_single_angle(
            body_b64=body_b64,
            garment_b64=garment_b64,
            item=pseudo_item,
            user=photo_user,
            angle=angle,
            persona=persona,
        )
        for angle in angles
    ]
    results = await asyncio.gather(*coros, return_exceptions=True)
    angle_images: List[TryOnImage] = []
    for angle, res in zip(angles, results):
        if isinstance(res, Exception) or not res:
            logger.warning("BYO try-on angle %s failed: %s", angle, res)
            continue
        angle_images.append(TryOnImage(angle=angle, image_b64=res))
    if not angle_images:
        raise HTTPException(
            status_code=502, detail="AI did not return any images. Please try again."
        )
    front_image = next(
        (a for a in angle_images if a.angle == "front"), angle_images[0]
    )

    tryon_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    await db.tryons.insert_one(
        {
            "id": tryon_id,
            "user_id": user["id"],
            # No real item — store the label and garment for the history view.
            "item_id": None,
            "item_name": label,
            "is_byo": True,
            "byo_garment_b64": garment_b64,
            "result_image_b64": front_image.image_b64,
            "images": [a.model_dump() for a in angle_images],
            "fit_summary": None,
            "created_at": now,
        }
    )
    return TryOnOut(
        id=tryon_id,
        item_id=pseudo_item["id"],
        result_image_b64=front_image.image_b64,
        images=angle_images,
        fit_summary=None,
        created_at=now,
    )


@router.get("/tryon/history", response_model=List[TryOnOut])
async def tryon_history(
    user: Dict[str, Any] = Depends(get_current_user),
    pinned: Optional[bool] = Query(
        default=None,
        description="Filter to just the user's Saved board (true) or the "
        "recent history (false / omitted).",
    ),
) -> List[TryOnOut]:
    # Pinned view: only saved try-ons, ordered by pin time so the most
    # recently saved sit at the top of the board.
    if pinned is True:
        query: Dict[str, Any] = {"user_id": user["id"], "pinned": True}
        sort_field = "pinned_at"
    else:
        query = {"user_id": user["id"]}
        sort_field = "created_at"
    docs = (
        await db.tryons.find(query, {"_id": 0})
        .sort(sort_field, -1)
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
                item_id=d.get("item_id"),
                result_image_b64=d.get("result_image_b64", imgs[0].image_b64 if imgs else ""),
                images=imgs,
                fit_summary=d.get("fit_summary"),
                pinned=bool(d.get("pinned")),
                pinned_at=d.get("pinned_at"),
                created_at=d["created_at"],
            )
        )
    return out


@router.patch("/tryon/{tryon_id}/pin", response_model=TryOnPinOut)
async def toggle_tryon_pin(
    tryon_id: str,
    body: TryOnPinIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> TryOnPinOut:
    """Toggle (or explicitly set) whether this try-on is on the user's
    private Saved board. Idempotent — sending the same value twice
    returns the current state."""
    tryon = await db.tryons.find_one(
        {"id": tryon_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not tryon:
        raise HTTPException(status_code=404, detail="Try-on not found")
    current = bool(tryon.get("pinned"))
    # Body optionally specifies the target state; None = toggle.
    target = (not current) if body.pinned is None else bool(body.pinned)
    now = datetime.now(timezone.utc)
    update: Dict[str, Any] = {"pinned": target}
    if target:
        update["pinned_at"] = now
    else:
        update["pinned_at"] = None
    await db.tryons.update_one({"id": tryon_id}, {"$set": update})
    return TryOnPinOut(
        id=tryon_id,
        pinned=target,
        pinned_at=now if target else None,
    )


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

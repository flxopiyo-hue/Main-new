"""AI Stylist — chat assistant that analyses the buyer's photo (skin tone /
undertone, body structure) plus their stored measurements and suggests
shoppable outfit combinations from the LIVE marketplace catalog, filtered by
occasion (casual, official/work, event/wedding, date night).

Model: Gemini 3.1 Pro (vision) via the Emergent LLM key.
Gating: Free buyers get FREE_STYLIST_SESSIONS_PER_WEEK new sessions per
rolling week (messages within a session are not capped by tier); Premium is
unlimited. A "session" is one continuous conversation thread.

The buyer's front photo is attached ONLY on the first message of a session;
the model returns a compact ``appearance_profile`` which is stored on the
session and reused as text afterwards (cheaper + faster follow-ups).
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.config import EMERGENT_LLM_KEY, STYLIST_MODEL
from core.db import db
from core.gating import assert_can_start_stylist_session, is_premium, stylist_sessions_remaining
from core.security import get_current_user

logger = logging.getLogger("aurafit.stylist")
router = APIRouter()

OCCASION_LABELS: Dict[str, str] = {
    "casual": "Casual",
    "official": "Official / Work",
    "event": "Event / Wedding",
    "date": "Date night",
}

MAX_USER_MESSAGES_PER_SESSION = 30
CATALOG_LIMIT = 80
HISTORY_TURNS = 12  # last N messages replayed to the model

SYSTEM_MESSAGE = (
    "You are Oromona's AI fashion stylist for the Kenyan marketplace. You give "
    "warm, confident, specific styling advice tailored to the buyer's skin tone, "
    "undertone, and body structure, plus the occasion they mention.\n"
    "HARD RULES:\n"
    "1. You may ONLY recommend pieces from the CATALOG provided, referenced by their "
    "exact `id`. Never invent items. If the catalog lacks something (e.g. no shoes), "
    "say so honestly and style around what exists.\n"
    "2. Build complete, coherent looks (e.g. top + bottom + shoes) when the catalog "
    "allows; respect the item's audience (male/female/unisex) vs the buyer.\n"
    "3. Explain WHY each look works for THIS buyer (skin tone ↔ colour theory, cut ↔ "
    "body structure, occasion fit). Keep it short and friendly — 2-4 sentences of "
    "reply text plus per-outfit reasons.\n"
    "4. When a photo of the buyer is attached, describe their appearance respectfully "
    "and neutrally (skin tone/undertone, build) in `appearance_profile` — never "
    "comment negatively on their body or looks.\n"
    "5. ALWAYS answer with STRICT JSON ONLY (no markdown fences, no prose outside "
    "JSON) in exactly this shape:\n"
    '{"reply": "<your conversational reply>", '
    '"outfits": [{"title": "<short look name>", "why": "<1-2 sentence reason>", '
    '"item_ids": ["<catalog id>", "..."]}], '
    '"appearance_profile": "<only when a photo is attached, else omit>"}\n'
    "Return 1-3 outfits when the buyer wants suggestions; an empty outfits array is "
    "fine for small-talk or clarification questions."
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class StylistChatIn(BaseModel):
    session_id: Optional[str] = None
    message: str = Field(min_length=1, max_length=600)
    occasion: Optional[str] = None  # casual | official | event | date


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _item_card(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc["id"],
        "name": doc.get("name", ""),
        "seller_name": doc.get("seller_name", ""),
        "price_cents": int(doc.get("price_cents") or 0),
        "currency": doc.get("currency", "KES"),
        "image_b64": doc.get("image_b64", ""),
        "garment_type": doc.get("garment_type", "other"),
        "category": doc.get("category", ""),
    }


async def _catalog_lines() -> tuple[str, Dict[str, Dict[str, Any]]]:
    """Compact text catalog for the prompt + id → item doc lookup."""
    docs = (
        await db.items.find({}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(CATALOG_LIMIT)
    )
    lines: List[str] = []
    lookup: Dict[str, Dict[str, Any]] = {}
    for d in docs:
        lookup[d["id"]] = d
        in_stock = [s["label"] for s in d.get("sizes", []) if int(s.get("available_qty") or 0) > 0]
        colours = ", ".join(c.get("name", "") for c in d.get("colors", [])) or "—"
        price = int(d.get("price_cents") or 0) // 100
        lines.append(
            f"- id={d['id']} | {d.get('garment_type', 'other')} | \"{d.get('name', '')}\" "
            f"by {d.get('seller_name', '')} | audience: {d.get('audience', 'unisex')} | "
            f"colours: {colours} | {d.get('currency', 'KES')} {price:,} | "
            f"sizes in stock: {', '.join(in_stock) or 'none'}"
        )
    return "\n".join(lines), lookup


def _buyer_context(user: Dict[str, Any], profile: Optional[Dict[str, Any]]) -> str:
    bits: List[str] = []
    if user.get("gender"):
        bits.append(f"gender: {user['gender']}")
    if user.get("age"):
        bits.append(f"age: {user['age']}")
    if user.get("preferred_size"):
        bits.append(f"preferred size: {user['preferred_size']}")
    m = (profile or {}).get("measurements") or {}
    dims = ", ".join(
        f"{k.replace('_cm', '')} {v}cm"
        for k, v in m.items()
        if isinstance(v, (int, float)) and v
    )
    if dims:
        bits.append(f"measurements: {dims}")
    return "; ".join(bits) or "no stored details"


def _parse_model_json(raw: str) -> Dict[str, Any]:
    """Best-effort strict-JSON extraction (strips ``` fences, grabs the
    outermost object). Falls back to treating the text as a plain reply."""
    text = raw.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.S)
    if fence:
        text = fence.group(1).strip()
    if not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            text = text[start : end + 1]
    try:
        data = json.loads(text)
        if isinstance(data, dict) and "reply" in data:
            return data
    except (ValueError, TypeError):
        pass
    return {"reply": raw.strip(), "outfits": []}


def _resolve_outfits(
    raw_outfits: Any, lookup: Dict[str, Dict[str, Any]]
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """→ (stored_outfits [ids only], response_outfits [with item cards])."""
    stored: List[Dict[str, Any]] = []
    resolved: List[Dict[str, Any]] = []
    if not isinstance(raw_outfits, list):
        return stored, resolved
    for o in raw_outfits[:4]:
        if not isinstance(o, dict):
            continue
        ids = [i for i in (o.get("item_ids") or []) if isinstance(i, str) and i in lookup]
        if not ids:
            continue
        title = str(o.get("title") or "Suggested look")[:80]
        why = str(o.get("why") or "")[:400]
        stored.append({"title": title, "why": why, "item_ids": ids})
        resolved.append(
            {"title": title, "why": why, "items": [_item_card(lookup[i]) for i in ids]}
        )
    return stored, resolved


async def _cards_for_ids(item_ids: List[str]) -> List[Dict[str, Any]]:
    docs = await db.items.find({"id": {"$in": item_ids}}, {"_id": 0}).to_list(len(item_ids))
    by_id = {d["id"]: d for d in docs}
    return [_item_card(by_id[i]) for i in item_ids if i in by_id]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/stylist/chat")
async def stylist_chat(
    body: StylistChatIn, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    if user.get("role") != "buyer":
        raise HTTPException(status_code=403, detail="Only buyers can use the AI Stylist")
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")

    occasion = (body.occasion or "").strip().lower() or None
    if occasion and occasion not in OCCASION_LABELS:
        raise HTTPException(status_code=400, detail="Unknown occasion")

    # ------------------------------------------------------------------
    # Session resolve / create (gate applies to NEW sessions only)
    # ------------------------------------------------------------------
    session: Optional[Dict[str, Any]] = None
    if body.session_id:
        session = await db.stylist_sessions.find_one(
            {"id": body.session_id, "user_id": user["id"]}, {"_id": 0}
        )
        if not session:
            raise HTTPException(status_code=404, detail="Stylist session not found")
    now = datetime.now(timezone.utc)
    if session is None:
        await assert_can_start_stylist_session(user)
        session = {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "occasion": occasion,
            "appearance_profile": None,
            "messages": [],
            "created_at": now,
            "updated_at": now,
        }
        await db.stylist_sessions.insert_one({**session})

    user_turns = sum(1 for m in session["messages"] if m.get("role") == "user")
    if user_turns >= MAX_USER_MESSAGES_PER_SESSION:
        raise HTTPException(
            status_code=400,
            detail="This session is quite long — start a new one to keep advice sharp.",
        )
    if occasion and not session.get("occasion"):
        session["occasion"] = occasion

    # ------------------------------------------------------------------
    # Build the prompt
    # ------------------------------------------------------------------
    catalog_text, lookup = await _catalog_lines()
    profile = await db.profiles.find_one({"user_id": user["id"]}, {"_id": 0})

    attach_photo = not session.get("appearance_profile") and bool(
        (profile or {}).get("front_photo_b64")
    )

    transcript = "\n".join(
        f"{'buyer' if m['role'] == 'user' else 'stylist'}: {m['text']}"
        for m in session["messages"][-HISTORY_TURNS:]
    )

    occ = session.get("occasion") or occasion
    context_bits = [
        f"Buyer details: {_buyer_context(user, profile)}.",
        (
            f"Appearance (from earlier photo analysis): {session['appearance_profile']}"
            if session.get("appearance_profile")
            else (
                "The buyer's full-body photo is ATTACHED — analyse skin tone/undertone "
                "and body structure and include `appearance_profile` in your JSON."
                if attach_photo
                else "No photo available — base advice on the details above and ask "
                "nothing invasive."
            )
        ),
        f"Occasion focus: {OCCASION_LABELS.get(occ, 'not specified yet')}.",
        "CATALOG of live marketplace pieces (recommend ONLY these, by exact id):\n"
        + (catalog_text or "(catalog is empty — no items listed yet; tell the buyer "
           "the boutique is being restocked and give general colour/cut advice)"),
    ]
    if transcript:
        context_bits.append("Conversation so far:\n" + transcript)

    prompt = (
        "[CONTEXT — internal, not written by the buyer]\n"
        + "\n\n".join(context_bits)
        + "\n\n[NEW MESSAGE from the buyer]\n"
        + body.message.strip()
        + "\n\nRespond with STRICT JSON only, per your rules."
    )

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"stylist-{session['id']}-{uuid.uuid4().hex[:8]}",
        system_message=SYSTEM_MESSAGE,
    ).with_model("gemini", STYLIST_MODEL)

    files = [ImageContent(profile["front_photo_b64"])] if attach_photo else []
    try:
        raw = await chat.send_message(UserMessage(text=prompt, file_contents=files))
    except Exception as e:  # noqa: BLE001 — surface any provider failure cleanly
        logger.exception("stylist chat failed")
        raise HTTPException(status_code=502, detail=f"Stylist is unavailable right now: {e}") from e

    data = _parse_model_json(str(raw))
    reply = str(data.get("reply") or "").strip() or "Let's find you a great look — tell me the occasion!"
    stored_outfits, resolved_outfits = _resolve_outfits(data.get("outfits"), lookup)

    updates: Dict[str, Any] = {"updated_at": now, "occasion": session.get("occasion")}
    appearance = data.get("appearance_profile")
    if attach_photo and isinstance(appearance, str) and appearance.strip():
        updates["appearance_profile"] = appearance.strip()[:600]

    await db.stylist_sessions.update_one(
        {"id": session["id"]},
        {
            "$set": updates,
            "$push": {
                "messages": {
                    "$each": [
                        {"role": "user", "text": body.message.strip(), "created_at": now},
                        {
                            "role": "stylist",
                            "text": reply,
                            "outfits": stored_outfits,
                            "created_at": now,
                        },
                    ]
                }
            },
        },
    )

    return {
        "session_id": session["id"],
        "occasion": session.get("occasion"),
        "reply": reply,
        "outfits": resolved_outfits,
        "sessions_remaining": -1 if is_premium(user) else await stylist_sessions_remaining(user["id"]),
    }


@router.get("/stylist/sessions")
async def stylist_sessions(user: Dict[str, Any] = Depends(get_current_user)) -> List[Dict[str, Any]]:
    docs = (
        await db.stylist_sessions.find(
            {"user_id": user["id"]}, {"_id": 0, "id": 1, "occasion": 1, "created_at": 1, "updated_at": 1, "messages": 1}
        )
        .sort("updated_at", -1)
        .to_list(20)
    )
    out = []
    for d in docs:
        msgs = d.get("messages") or []
        out.append(
            {
                "id": d["id"],
                "occasion": d.get("occasion"),
                "created_at": d.get("created_at"),
                "updated_at": d.get("updated_at"),
                "message_count": len(msgs),
                "preview": (msgs[-1]["text"][:120] if msgs else ""),
            }
        )
    return out


@router.get("/stylist/sessions/{session_id}")
async def stylist_session_detail(
    session_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    d = await db.stylist_sessions.find_one(
        {"id": session_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not d:
        raise HTTPException(status_code=404, detail="Stylist session not found")
    messages = []
    for m in d.get("messages") or []:
        entry: Dict[str, Any] = {"role": m["role"], "text": m["text"]}
        if m.get("outfits"):
            entry["outfits"] = [
                {
                    "title": o["title"],
                    "why": o.get("why", ""),
                    "items": await _cards_for_ids(o.get("item_ids") or []),
                }
                for o in m["outfits"]
            ]
        messages.append(entry)
    return {
        "id": d["id"],
        "occasion": d.get("occasion"),
        "created_at": d.get("created_at"),
        "messages": messages,
    }

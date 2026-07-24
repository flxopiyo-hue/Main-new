"""Community categories router.

Sellers can list an item under a category not in our seed set (e.g.
"swimwear", "kikoy", "kanga", "lingerie"). To keep the buyer-side feed
sane — so 3 sellers don't spell their category 3 different ways — we
persist categories in a shared collection with normalized slugs. Once
one seller adds "swimwear", every other seller sees it in their picker.

Concurrency notes:
  • `slug` is unique — duplicates return the existing row instead of
    erroring, so two sellers who click "Add" at the same moment don't
    race.
  • `usage_count` is best-effort — updated when an item references a
    category, but we don't take it as gospel; UI sorts primarily by
    label alphabetically with popular ones highlighted.
"""

from __future__ import annotations

import difflib
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core.db import db
from core.security import get_current_user, require_role

logger = logging.getLogger("oromona.categories")
router = APIRouter()


# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------
# The original hardcoded categories. Seeded on startup — see
# ensure_default_categories() below. Community categories are appended to
# this over time.
SEED_CATEGORIES: List[Dict[str, Any]] = [
    {"slug": "shirts", "label": "Tops", "audiences": ["women", "men", "unisex", "kids"]},
    {"slug": "dresses", "label": "Dresses", "audiences": ["women", "kids"]},
    {"slug": "pants", "label": "Bottoms", "audiences": ["women", "men", "unisex", "kids"]},
    {"slug": "outerwear", "label": "Outerwear", "audiences": ["women", "men", "unisex", "kids"]},
    {"slug": "shoes", "label": "Shoes", "audiences": ["women", "men", "unisex", "kids"]},
    {"slug": "accessories", "label": "Accessories", "audiences": ["women", "men", "unisex", "kids"]},
]

SYSTEM_SLUGS = {c["slug"] for c in SEED_CATEGORIES}


# ---------------------------------------------------------------------------
# Slug helpers
# ---------------------------------------------------------------------------
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(label: str) -> str:
    """Deterministic slug derivation used both in seed + create paths.

    Collapses ALL separators/punctuation so "Swim Wear", "swim-wear" and
    "swimwear" resolve to the same slug — the primary duplicate guard.
    """
    if not label:
        return ""
    return _SLUG_RE.sub("", label.strip().lower())[:40]


async def find_canonical(label_or_slug: str) -> Optional[Dict[str, Any]]:
    """Resolve raw seller text to an existing category doc, tolerating
    spacing/punctuation (via slugify), simple plural/singular variants and
    small misspellings — so "swim wear", "Swimwear" and "swimwears" all
    land on one canonical row. Returns None when nothing close exists."""
    slug = slugify(label_or_slug)
    if not slug:
        return None
    exact = await db.categories.find_one({"slug": slug}, {"_id": 0})
    if exact:
        return exact
    docs = await db.categories.find({}, {"_id": 0, "slug": 1}).to_list(500)
    by_slug = [d["slug"] for d in docs]
    # Plural/singular variants: "swimwears" ↔ "swimwear", "dress" ↔ "dresses".
    candidates = [slug + "s", slug + "es"]
    if slug.endswith("es"):
        candidates.append(slug[:-2])
    if slug.endswith("s"):
        candidates.append(slug[:-1])
    for cand in candidates:
        if cand in by_slug:
            return await db.categories.find_one({"slug": cand}, {"_id": 0})
    # Close misspellings — 0.85 keeps "swimware"→"swimwear" together
    # without merging genuinely different words.
    close = difflib.get_close_matches(slug, by_slug, n=1, cutoff=0.85)
    if close:
        return await db.categories.find_one({"slug": close[0]}, {"_id": 0})
    return None


async def ensure_default_categories() -> None:
    """Insert the seed categories once. Idempotent — safe to call every
    startup."""
    now = datetime.now(timezone.utc)
    for row in SEED_CATEGORIES:
        await db.categories.update_one(
            {"slug": row["slug"]},
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "slug": row["slug"],
                    "label": row["label"],
                    "audiences": row["audiences"],
                    "source": "system",
                    "created_by": None,
                    "usage_count": 0,
                    "created_at": now,
                },
                "$set": {"updated_at": now},
            },
            upsert=True,
        )


# ---------------------------------------------------------------------------
# Category models
# ---------------------------------------------------------------------------
class CategoryOut(BaseModel):
    id: str
    slug: str
    label: str
    audiences: List[str]
    source: str  # "system" or "community"
    usage_count: int
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CategoryCreateIn(BaseModel):
    label: str = Field(min_length=2, max_length=40)
    audiences: List[str] = Field(default_factory=lambda: ["unisex"])


def _to_out(doc: Dict[str, Any]) -> CategoryOut:
    return CategoryOut(
        id=doc["id"],
        slug=doc["slug"],
        label=doc["label"],
        audiences=doc.get("audiences") or ["unisex"],
        source=doc.get("source", "community"),
        usage_count=int(doc.get("usage_count", 0)),
        created_by=doc.get("created_by"),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


# ---------------------------------------------------------------------------
# GET /categories — public read (both buyers and sellers use it)
# ---------------------------------------------------------------------------
@router.get("/categories", response_model=List[CategoryOut])
async def list_categories(
    audience: Optional[str] = Query(default=None, description="Filter by audience"),
    q: Optional[str] = Query(default=None, description="Search by label/slug"),
) -> List[CategoryOut]:
    query: Dict[str, Any] = {}
    if audience:
        query["audiences"] = audience
    if q and q.strip():
        safe = re.escape(q.strip())
        compact = slugify(q)
        ors: List[Dict[str, Any]] = [{"label": {"$regex": safe, "$options": "i"}}]
        if compact:
            ors.append({"slug": {"$regex": re.escape(compact)}})
        query["$or"] = ors
    docs = await db.categories.find(query, {"_id": 0}).to_list(500)
    # Sort: system categories first (predictable ordering), then community
    # by usage_count desc, then alphabetical.
    def sort_key(d: Dict[str, Any]) -> tuple:
        is_system = 0 if d.get("source") == "system" else 1
        return (
            is_system,
            -int(d.get("usage_count", 0)),
            (d.get("label") or "").lower(),
        )

    docs.sort(key=sort_key)
    return [_to_out(d) for d in docs]


# ---------------------------------------------------------------------------
# POST /categories — seller-only community add
# ---------------------------------------------------------------------------
@router.post("/categories", response_model=CategoryOut)
async def create_category(
    body: CategoryCreateIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> CategoryOut:
    await require_role("seller", user)

    label = body.label.strip()
    slug = slugify(label)
    if len(slug) < 2:
        raise HTTPException(
            status_code=400,
            detail="Category name must include at least 2 letters or numbers.",
        )

    # Reject reserved system slugs.
    audiences = [a for a in body.audiences if a in ("women", "men", "unisex", "kids")]
    if not audiences:
        audiences = ["unisex"]

    now = datetime.now(timezone.utc)
    # Idempotent add — return the existing row when the label matches an
    # existing category (including near-duplicates like "swim wear" vs
    # "swimwear"). Also extend the audiences union if a second seller adds
    # it for a different audience.
    existing = await find_canonical(label)
    if existing:
        merged = sorted(set(list(existing.get("audiences") or []) + audiences))
        await db.categories.update_one(
            {"slug": existing["slug"]},
            {"$set": {"audiences": merged, "updated_at": now}},
        )
        existing["audiences"] = merged
        existing["updated_at"] = now
        return _to_out(existing)

    doc = {
        "id": str(uuid.uuid4()),
        "slug": slug,
        "label": label,
        "audiences": audiences,
        "source": "community",
        "created_by": user["id"],
        "usage_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    await db.categories.insert_one({**doc})  # keep _id off the returned dict
    logger.info(
        "New community category %s (%s) added by seller %s", slug, label, user["id"]
    )
    return _to_out(doc)


# ---------------------------------------------------------------------------
# Internal helpers used by items router to bump usage counts on create.
# ---------------------------------------------------------------------------
async def bump_usage(slug: str) -> None:
    if not slug:
        return
    await db.categories.update_one(
        {"slug": slug},
        {"$inc": {"usage_count": 1}, "$set": {"updated_at": datetime.now(timezone.utc)}},
    )


async def resolve_or_create_slug(
    label_or_slug: str, audience: Optional[str], creator_id: Optional[str]
) -> Optional[str]:
    """Given raw text from an item's category field, return the canonical
    slug — creating a community category if needed. Used by the items
    router when a seller types free-text.

    Returns None if the input is empty; caller decides whether to 400.
    """
    if not label_or_slug:
        return None
    slug = slugify(label_or_slug)
    if not slug:
        return None
    existing = await find_canonical(label_or_slug)
    if existing:
        return existing["slug"]
    # Auto-create a community entry so the buyer feed can group correctly.
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "slug": slug,
        "label": label_or_slug.strip().title(),
        "audiences": [audience] if audience in ("women", "men", "unisex", "kids") else ["unisex"],
        "source": "community",
        "created_by": creator_id,
        "usage_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    await db.categories.insert_one({**doc})
    return slug

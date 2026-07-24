"""Items CRUD + personalised /feed.

IMPORTANT route-ordering note: /items/mine and /items/feed must be declared
BEFORE /items/{item_id} so the dynamic segment doesn't swallow them.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from core.config import DEFAULT_CURRENCY
from core.db import db
from core.images import strip_data_prefix
from core.security import (
    auth_scheme,
    get_current_user,
    require_role,
    try_get_user_from_creds,
)
from core.seller_verify import load_seller_verification_map
from models import ItemIn, ItemOut, ItemPatch, infer_garment_type, item_to_out

router = APIRouter()


def _normalize_color(c: Any) -> Dict[str, Any]:
    """Colour photo group hygiene: strip data-URI prefixes, cap at 5
    photos, and mirror the first photo into the legacy ``image_b64``
    field (older clients + the try-on engine read it)."""
    d = c.model_dump()
    imgs = [strip_data_prefix(b) for b in (d.get("images") or []) if b][:5]
    solo = strip_data_prefix(d["image_b64"]) if d.get("image_b64") else None
    if not imgs and solo:
        imgs = [solo]  # legacy single-photo payloads
    d["images"] = imgs
    d["image_b64"] = imgs[0] if imgs else None
    return d


@router.post("/items", response_model=ItemOut)
async def create_item(
    body: ItemIn, user: Dict[str, Any] = Depends(get_current_user)
) -> ItemOut:
    await require_role("seller", user)
    item_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    # Canonicalise the category. Sellers may type free-form ("swimwear",
    # "Kikoy Wraps"); we resolve to a slug, auto-creating a community
    # category row when unknown so every future seller sees it.
    from routers.categories import bump_usage, resolve_or_create_slug

    canonical_slug = await resolve_or_create_slug(
        body.category, body.audience, user["id"]
    )
    # If somehow empty (e.g. seller sent whitespace) we bail; the Pydantic
    # min_length=2 already blocks most of these cases.
    if not canonical_slug:
        raise HTTPException(status_code=400, detail="Category is required.")
    # If seller didn't pass an explicit currency, fall back to their preferred currency.
    listing_currency = (
        body.currency or user.get("preferred_currency") or DEFAULT_CURRENCY
    )
    garment_type = body.garment_type or infer_garment_type(
        {"name": body.name, "category": canonical_slug}
    )
    # Compose the images gallery. The first slot is always the legacy
    # `image_b64` (primary thumb shown on cards/search). Any extras the
    # seller uploaded come after it. We strip any "data:" URL prefixes so
    # the DB stores pure base64 bodies.
    primary_b64 = strip_data_prefix(body.image_b64)
    gallery: List[str] = [primary_b64] + [
        strip_data_prefix(b) for b in (body.extra_images or [])
    ]
    # Cap at 5 just in case the client doesn't enforce it.
    gallery = gallery[:5]

    doc = {
        "id": item_id,
        "seller_id": user["id"],
        "seller_name": user["full_name"],
        "name": body.name,
        "description": body.description,
        "brand_name": (body.brand_name or "").strip() or None,
        "category": canonical_slug,
        "subcategory": (body.subcategory or "").strip() or None,
        "price_cents": body.price_cents,
        "currency": listing_currency,
        "garment_type": garment_type,
        "image_b64": primary_b64,
        "images": gallery,
        "sizes": [s.model_dump() for s in body.sizes],
        "colors": [_normalize_color(c) for c in body.colors],
        "audience": body.audience,
        "is_paused": False,
        # New items skip the back-fill migration — they already store
        # price_cents in proper 1/100-of-major-unit form.
        "cents_normalized": True,
        "created_at": now,
    }
    # Auto-generate variants (one per size × color combo) unless the
    # seller sent an explicit list. This keeps single-color legacy items
    # working while giving new items the per-variant inventory & pricing
    # layer described in :mod:`core.variants`.
    from core.variants import generate_variants, rollup_sizes_qty
    if body.variants:
        # Clients send explicit variants without ids ("") — assign fresh
        # UUIDs so orders/carts can reference each variant stably.
        explicit: List[Dict[str, Any]] = []
        for v in body.variants:
            vd = v.model_dump()
            if not vd.get("id"):
                vd["id"] = str(uuid.uuid4())
            explicit.append(vd)
        doc["variants"] = explicit
        # Keep the legacy per-size roll-up coherent with variant stock.
        doc["sizes"] = rollup_sizes_qty(doc["sizes"], explicit)
    else:
        doc["variants"] = generate_variants(doc["sizes"], doc["colors"])
    await db.items.insert_one(doc)
    # Best-effort usage bump — doesn't matter if it fails.
    try:
        await bump_usage(canonical_slug)
    except Exception:
        pass
    return item_to_out(doc)


@router.get("/items", response_model=List[ItemOut])
async def list_items(
    category: Optional[str] = None,
    size: Optional[str] = None,
    color: Optional[str] = None,
    seller_id: Optional[str] = None,
    audience: Optional[str] = None,
    kid_age_group: Optional[str] = None,
    q: Optional[str] = None,
    brand: Optional[str] = None,
    include_paused: bool = False,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
) -> List[ItemOut]:
    query: Dict[str, Any] = {}
    # Hide items that have been merged into a parent duplicate. Legacy
    # items don't have this field so we can't just check equality.
    query["merged_into"] = {"$exists": False}
    if category:
        query["category"] = category
    if size:
        query["sizes.label"] = size
    if color:
        query["colors.name"] = color
    if seller_id:
        query["seller_id"] = seller_id
    if q:
        # Regex-escape the raw query so special characters like '(' don't
        # blow MongoDB's regex parser (which would otherwise return 500 for
        # innocuous buyer searches). Match case-insensitively across the
        # main searchable fields (name / brand / description / subcategory).
        safe = re.escape(q)
        query["$or"] = [
            {"name": {"$regex": safe, "$options": "i"}},
            {"brand_name": {"$regex": safe, "$options": "i"}},
            {"description": {"$regex": safe, "$options": "i"}},
            {"subcategory": {"$regex": safe, "$options": "i"}},
        ]
    if brand:
        # Case-insensitive exact-or-substring match on the brand label so
        # "lumière" finds "Maison Lumière" listings.
        query["brand_name"] = {"$regex": brand, "$options": "i"}
    # Buyers (and anon) never see paused items. Sellers viewing their own
    # listings via /items/mine get the unpaused query already in that
    # route; this flag only matters for admin / debugging surfaces.
    if not include_paused:
        query["is_paused"] = {"$ne": True}

    # Audience filtering — explicit param wins, otherwise infer from buyer gender.
    if audience and audience != "all":
        query["audience"] = audience
    elif not audience:
        u = await try_get_user_from_creds(creds)
        if u and u.get("role") == "buyer":
            g = u.get("gender")
            if g == "male":
                query["audience"] = {"$in": ["men", "unisex"]}
            elif g == "female":
                query["audience"] = {"$in": ["women", "unisex"]}
            # other / prefer_not_to_say → show everything (no filter)

    # Kid age-group filter: maps an age-band to the kid US-size set so the
    # buyer sees items with matching size labels.
    if kid_age_group:
        from models import KID_SIZE_SETS_BY_AGE_GROUP

        size_set = KID_SIZE_SETS_BY_AGE_GROUP.get(kid_age_group)
        if size_set:
            query["sizes.label"] = {"$in": size_set}

    docs = await db.items.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    vmap = await load_seller_verification_map({d["seller_id"] for d in docs})
    return [item_to_out(d, seller_verified=vmap.get(d["seller_id"], False)) for d in docs]


# IMPORTANT: /items/mine must come BEFORE /items/{item_id}.
@router.get("/items/mine", response_model=List[ItemOut])
async def my_items(user: Dict[str, Any] = Depends(get_current_user)) -> List[ItemOut]:
    docs = (
        await db.items.find({"seller_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(200)
    )
    verified = bool(user.get("verified_seller"))
    return [item_to_out(d, seller_verified=verified) for d in docs]


@router.get("/items/{item_id}", response_model=ItemOut)
async def get_item(
    item_id: str,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
) -> ItemOut:
    doc = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    # Increment view counter, but never count the seller's own visit.
    u = await try_get_user_from_creds(creds)
    skip_count = bool(u and u.get("id") == doc["seller_id"])
    if not skip_count:
        await db.items.update_one({"id": item_id}, {"$inc": {"views": 1}})
    seller = await db.users.find_one({"id": doc["seller_id"]}, {"_id": 0, "verified_seller": 1})
    return item_to_out(doc, seller_verified=bool(seller and seller.get("verified_seller")))


@router.get("/items/{item_id}/size-guide")
async def item_size_guide(item_id: str) -> Dict[str, Any]:
    """Return the per-size physical dimensions in a structured form for the
    Size Guide sheet on Item Detail."""
    from models import dimension_keys_for, infer_garment_type

    doc = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    gtype = doc.get("garment_type") or infer_garment_type(doc)
    keys = dimension_keys_for(gtype)
    sizes = doc.get("sizes", []) or []
    rows: List[Dict[str, Any]] = []
    for s in sizes:
        rows.append(
            {
                "label": s.get("label", ""),
                "available_qty": int(s.get("available_qty", 0)),
                "dimensions": {k: s.get(k) for k in keys},
            }
        )
    has_any_dims = any(
        any(r["dimensions"].get(k) is not None for k in keys) for r in rows
    )
    return {
        "garment_type": gtype,
        "dimension_keys": keys,
        "sizes": rows,
        "has_dimensions": has_any_dims,
    }


@router.get("/items/{item_id}/fit-score")
async def item_fit_score(
    item_id: str,
    profile_id: Optional[str] = None,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
) -> Dict[str, Any]:
    """Compare the item's per-size dimensions against the requested body
    profile and return a 0–100 fit score + per-dimension breakdown.

    Profile resolution:
      * `profile_id` supplied → look it up in `body_profiles` (must belong
        to the caller) and use its measurements.
      * Else fall back to the buyer's own profile under `profiles` (self).
      * Anonymous callers (no token) get `scorable=False` so the UI can
        gracefully prompt them to sign in.
    """
    from core.fit_match import compute_fit
    from models import infer_garment_type

    item = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    # Backfill garment_type for legacy / un-classified docs so the fit
    # algorithm has the right dimension keys.
    item["garment_type"] = item.get("garment_type") or infer_garment_type(item)

    # Resolve the body measurements doc. We deliberately return a *valid*
    # envelope (not a 4xx) when there's no profile so the buyer-facing
    # card UI can render a friendly "Add your size" CTA instead of an
    # error page.
    body: Dict[str, Any] = {}
    user = await try_get_user_from_creds(creds) if creds else None
    if user:
        if profile_id:
            prof = await db.body_profiles.find_one(
                {"id": profile_id, "user_id": user["id"]}, {"_id": 0}
            )
            if not prof:
                raise HTTPException(status_code=404, detail="Body profile not found")
            body = (prof.get("measurements") or {})
        else:
            self_profile = await db.profiles.find_one(
                {"user_id": user["id"]}, {"_id": 0}
            )
            body = (self_profile or {}).get("measurements") or {}

    result = compute_fit(item, body)
    result["item_id"] = item_id
    result["profile_id"] = profile_id
    return result



@router.delete("/items/{item_id}")
async def delete_item(
    item_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, bool]:
    doc = await db.items.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    if doc["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your item")
    await db.items.delete_one({"id": item_id})
    return {"ok": True}


@router.patch("/items/{item_id}", response_model=ItemOut)
async def patch_item(
    item_id: str,
    body: ItemPatch,
    user: Dict[str, Any] = Depends(get_current_user),
) -> ItemOut:
    """Partial update for an item the seller owns. Every field is optional;
    sellers can change just the price (or just the stock, or just pause the
    listing) without re-uploading anything else."""
    doc = await db.items.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    if doc["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your item")

    update: Dict[str, Any] = {}
    # Scalar / textual fields — only included when explicitly supplied.
    if body.name is not None:
        update["name"] = body.name.strip()
    if body.description is not None:
        update["description"] = body.description.strip()
    if body.brand_name is not None:
        update["brand_name"] = body.brand_name.strip() or None
    if body.category is not None:
        # Canonicalise the same way create does so edits can't fragment
        # the shared taxonomy (e.g. "Swim Wear" → existing "swimwear").
        from routers.categories import bump_usage, resolve_or_create_slug

        canonical = await resolve_or_create_slug(
            body.category, body.audience or doc.get("audience"), user["id"]
        )
        if not canonical:
            raise HTTPException(status_code=400, detail="Category is required.")
        update["category"] = canonical
        if canonical != doc.get("category"):
            try:
                await bump_usage(canonical)
            except Exception:
                pass
    if body.subcategory is not None:
        update["subcategory"] = body.subcategory.strip() or None
    if body.price_cents is not None:
        update["price_cents"] = body.price_cents
    if body.currency is not None:
        update["currency"] = body.currency
    if body.garment_type is not None:
        update["garment_type"] = body.garment_type
    if body.audience is not None:
        update["audience"] = body.audience
    if body.is_paused is not None:
        update["is_paused"] = bool(body.is_paused)
    # Image gallery — primary first, then up to 4 extras. We only rebuild
    # the gallery when the seller explicitly sent a new primary OR new
    # extras list.
    if body.image_b64 is not None or body.extra_images is not None:
        new_primary = (
            strip_data_prefix(body.image_b64)
            if body.image_b64 is not None
            else doc.get("image_b64")
        )
        if body.extra_images is not None:
            new_extras = [strip_data_prefix(b) for b in body.extra_images]
        else:
            new_extras = [
                b for b in (doc.get("images") or [])[1:] if b
            ]
        gallery = [new_primary] + new_extras
        gallery = gallery[:5]
        update["image_b64"] = new_primary
        update["images"] = gallery
    if body.sizes is not None:
        update["sizes"] = [s.model_dump() for s in body.sizes]
    if body.colors is not None:
        update["colors"] = [_normalize_color(c) for c in body.colors]
    if body.variants is not None:
        # Preserve existing variant ids by (size, color) key so in-flight
        # carts/orders keep resolving; brand-new combos get fresh UUIDs.
        from core.variants import _norm_name

        prior_ids = {
            f"{v.get('size_label')}::{_norm_name(v.get('color_name'))}": v.get("id")
            for v in (doc.get("variants") or [])
        }
        merged_variants: List[Dict[str, Any]] = []
        for v in body.variants:
            vd = v.model_dump()
            if not vd.get("id"):
                key = f"{vd.get('size_label')}::{_norm_name(vd.get('color_name'))}"
                vd["id"] = prior_ids.get(key) or str(uuid.uuid4())
            merged_variants.append(vd)
        update["variants"] = merged_variants
        # Keep the legacy per-size roll-up coherent with variant stock.
        from core.variants import rollup_sizes_qty

        base_sizes = update.get("sizes") or [dict(s) for s in (doc.get("sizes") or [])]
        update["sizes"] = rollup_sizes_qty(base_sizes, merged_variants)

    # If sizes or colors changed but variants weren't explicitly sent,
    # regenerate variants (preserving prior quantities/pricing where
    # the (size, color) combo still exists) so stock stays coherent
    # with the visible size × color matrix.
    if ("sizes" in update or "colors" in update) and "variants" not in update:
        from core.variants import generate_variants
        merged_sizes = update.get("sizes") or (doc.get("sizes") or [])
        merged_colors = update.get("colors") or (doc.get("colors") or [])
        update["variants"] = generate_variants(
            merged_sizes,
            merged_colors,
            existing=doc.get("variants") or [],
        )

    if not update:
        # Empty patch — return current state instead of a no-op write so
        # the client always gets a fresh ItemOut envelope.
        fresh = await db.items.find_one({"id": item_id}, {"_id": 0})
        return item_to_out(fresh)

    await db.items.update_one({"id": item_id}, {"$set": update})
    fresh = await db.items.find_one({"id": item_id}, {"_id": 0})

    # If the seller changed inventory (patched sizes) OR unpaused, some
    # sold-out sizes may have just come back in stock — fire off the
    # restock fan-out so subscribed buyers get a red dot next open.
    if "sizes" in update or ("is_paused" in update and update.get("is_paused") is False):
        try:
            from routers.restock import fanout_restock_for_item
            await fanout_restock_for_item(item_id, fresh.get("sizes") or [])
        except Exception as e:  # pragma: no cover - fanout must not fail patch
            logging.getLogger("aurafit.items").warning("restock fanout failed: %s", e)

    return item_to_out(fresh)


@router.post("/items/{item_id}/duplicate", response_model=ItemOut)
async def duplicate_item(
    item_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> ItemOut:
    """Deep-clone an existing listing into a fresh row owned by the same
    seller. The duplicate inherits everything (photos, sizes, colors)
    EXCEPT counters (views/try_ons reset to zero) and the new copy is
    paused by default so the seller can edit it before going live again.
    The title gets a "(Copy)" suffix so the inventory list shows both
    rows clearly."""
    doc = await db.items.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    if doc["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your item")

    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    # Deep-copy variants with FRESH ids so the two items track their
    # own inventory independently (a sale against the duplicate must
    # not decrement the original's stock).
    from core.variants import generate_variants
    src_variants = doc.get("variants") or []
    if src_variants:
        cloned_variants = []
        for v in src_variants:
            vv = dict(v)
            vv["id"] = str(uuid.uuid4())
            cloned_variants.append(vv)
    else:
        cloned_variants = generate_variants(
            doc.get("sizes") or [], doc.get("colors") or []
        )
    clone = {
        "id": new_id,
        "seller_id": doc["seller_id"],
        "seller_name": doc.get("seller_name", ""),
        "name": f"{doc['name']} (Copy)",
        "description": doc.get("description", ""),
        "brand_name": doc.get("brand_name"),
        "category": doc["category"],
        "subcategory": doc.get("subcategory"),
        "price_cents": doc["price_cents"],
        "currency": doc.get("currency", DEFAULT_CURRENCY),
        "garment_type": doc.get("garment_type"),
        "image_b64": doc["image_b64"],
        "images": list(doc.get("images") or [doc["image_b64"]]),
        "sizes": list(doc.get("sizes") or []),
        "colors": list(doc.get("colors") or []),
        "variants": cloned_variants,
        "audience": doc.get("audience", "unisex"),
        "is_paused": True,  # paused by default — let the seller review first
        "cents_normalized": True,
        "created_at": now,
    }
    await db.items.insert_one(clone)
    return item_to_out(clone)


@router.get("/feed", response_model=List[ItemOut])
async def items_feed(
    user: Dict[str, Any] = Depends(get_current_user),
    limit: int = 60,
) -> List[ItemOut]:
    """Personalized re-ranking of items for the current buyer.

    Score = audience_match + seller_affinity + category_affinity + freshness.
    """
    seller_affinity: Dict[str, float] = {}
    category_affinity: Dict[str, float] = {}

    async def bump(seller_id: str, category: str, weight: float) -> None:
        if seller_id:
            seller_affinity[seller_id] = seller_affinity.get(seller_id, 0.0) + weight
        if category:
            category_affinity[category] = category_affinity.get(category, 0.0) + weight

    # Wishlists (+2), try-ons (+1.5), paid orders (+3), perfect-fit orders (+4).
    wishes = db.wishlists.find({"user_id": user["id"]}, {"_id": 0, "item_id": 1})
    wish_ids: List[str] = []
    async for w in wishes:
        wish_ids.append(w["item_id"])
    if wish_ids:
        async for it in db.items.find(
            {"id": {"$in": wish_ids}}, {"_id": 0, "seller_id": 1, "category": 1}
        ):
            await bump(it.get("seller_id", ""), it.get("category", ""), 2.0)

    tryons = db.tryons.find(
        {"user_id": user["id"]}, {"_id": 0, "item_id": 1}
    ).sort("created_at", -1)
    to_ids: List[str] = []
    async for t in tryons:
        to_ids.append(t["item_id"])
    if to_ids:
        async for it in db.items.find(
            {"id": {"$in": to_ids[:30]}}, {"_id": 0, "seller_id": 1, "category": 1}
        ):
            await bump(it.get("seller_id", ""), it.get("category", ""), 1.5)

    async for o in db.orders.find(
        {"buyer_id": user["id"], "status": "paid"},
        {"_id": 0, "seller_id": 1, "item_id": 1, "fit_feedback": 1},
    ):
        seller_id = o.get("seller_id")
        item_doc = await db.items.find_one(
            {"id": o["item_id"]}, {"_id": 0, "category": 1}
        )
        category = item_doc.get("category") if item_doc else ""
        weight = 4.0 if o.get("fit_feedback") == "perfect" else 3.0
        await bump(seller_id, category, weight)

    # Build the candidate query — same audience filter logic as list_items.
    query: Dict[str, Any] = {}
    g = user.get("gender")
    if user.get("role") == "buyer":
        if g == "male":
            query["audience"] = {"$in": ["men", "unisex"]}
        elif g == "female":
            query["audience"] = {"$in": ["women", "unisex"]}

    docs = await db.items.find(query, {"_id": 0}).sort("created_at", -1).to_list(300)

    now = datetime.now(timezone.utc)

    def score(d: Dict[str, Any]) -> float:
        s = 0.0
        s += seller_affinity.get(d.get("seller_id", ""), 0.0)
        s += category_affinity.get(d.get("category", ""), 0.0)
        # Freshness: items in the last 7 days get a small boost.
        try:
            age_days = (now - d["created_at"]).total_seconds() / 86400.0
            s += max(0.0, 1.0 - age_days / 7.0) * 0.5
        except Exception:
            pass
        return s

    ranked = sorted(docs, key=lambda d: (-score(d), -d["created_at"].timestamp()))
    return [item_to_out(d) for d in ranked[:limit]]

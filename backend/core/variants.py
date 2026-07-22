"""Item variant helpers — Phase 3 variants layer.

Sellers describe products as (sizes × colors) matrices in the wizard.
Under the hood the app tracks each (size, color) combo as a discrete
``ItemVariant`` with its own quantity and optional price override, so
that:

  • Buyers see a single tile per parent item on Discover and pick
    size + color on the detail page (no duplicate tiles).
  • Sellers can price XXL a bit higher or mark "M in Red" as
    permanently disabled without deleting whole size rows.
  • The order flow can decrement the exact (size, color) unit.

The layer is *derived* from the classic ``sizes`` and ``colors`` lists
so single-colour or legacy items keep working with zero DB
migration — an empty ``variants`` array means "server, please
auto-generate one variant per size × color for me".
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, Iterable, List, Optional

from core.db import db

logger = logging.getLogger("aurafit.variants")


def _norm_name(name: str | None) -> str:
    return (name or "").strip().lower()


def _slug(v: Any) -> str:
    return _norm_name(str(v)).replace(" ", "-")


def generate_variants(
    sizes: List[Dict[str, Any]],
    colors: List[Dict[str, Any]],
    existing: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Auto-produce a variant per (size, color) combo.

    - When there are no colors, one variant per size (color_name=None).
    - When there are colors, quantity is split as-evenly-as-possible
      across the color count so the total across a size row stays equal
      to ``size.available_qty`` (which is what the seller entered).
    - If ``existing`` variants were provided (edit flow), we preserve
      their ``id``, ``quantity``, ``price_cents_override`` and
      ``disabled`` flags where the (size_label, color_name) key
      matches; new combos get default values.
    """
    prior: Dict[str, Dict[str, Any]] = {}
    for v in existing or []:
        key = f"{v.get('size_label')}::{_norm_name(v.get('color_name'))}"
        prior[key] = v

    result: List[Dict[str, Any]] = []
    if not sizes:
        return result

    color_list: List[Dict[str, Any]] = list(colors or [])
    for size in sizes:
        size_label = size.get("label", "")
        base_qty = int(size.get("available_qty") or 0)
        # No colors → one variant covering the whole size row.
        if not color_list:
            key = f"{size_label}::"
            p = prior.get(key, {})
            result.append({
                "id": p.get("id") or str(uuid.uuid4()),
                "size_label": size_label,
                "color_name": None,
                "color_hex": None,
                "quantity": int(p.get("quantity", base_qty)),
                "price_cents_override": p.get("price_cents_override"),
                "disabled": bool(p.get("disabled", False)),
            })
            continue
        # Colors present → split quantity evenly.
        n = len(color_list)
        per, extra = divmod(base_qty, n) if n else (0, 0)
        for i, c in enumerate(color_list):
            cname = c.get("name")
            key = f"{size_label}::{_norm_name(cname)}"
            p = prior.get(key, {})
            default_qty = per + (1 if i < extra else 0)
            result.append({
                "id": p.get("id") or str(uuid.uuid4()),
                "size_label": size_label,
                "color_name": cname,
                "color_hex": c.get("hex"),
                # Preserve seller-edited quantity if we already had one
                # for this exact combo — otherwise fall back to the
                # newly computed default so stock stays coherent.
                "quantity": int(p.get("quantity", default_qty)),
                "price_cents_override": p.get("price_cents_override"),
                "disabled": bool(p.get("disabled", False)),
            })
    return result


def total_available_qty(variants: List[Dict[str, Any]]) -> int:
    return sum(int(v.get("quantity") or 0) for v in variants if not v.get("disabled"))


def variant_lookup(item_doc: Dict[str, Any], variant_id: str) -> Optional[Dict[str, Any]]:
    for v in item_doc.get("variants") or []:
        if v.get("id") == variant_id:
            return v
    return None


def find_variant_by_size_color(
    item_doc: Dict[str, Any],
    size_label: str,
    color_name: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Best-effort lookup used by legacy checkout clients that don't
    know about ``variant_id`` yet — matches on (size_label, color_name)
    case-insensitively. Returns the first non-disabled hit.
    """
    target = _norm_name(color_name) if color_name else ""
    for v in item_doc.get("variants") or []:
        if v.get("disabled"):
            continue
        if v.get("size_label") != size_label:
            continue
        cn = _norm_name(v.get("color_name"))
        if not target and not cn:
            return v
        if target and cn == target:
            return v
    # Fallback: any variant with matching size when color is unspecified.
    if not target:
        for v in item_doc.get("variants") or []:
            if v.get("size_label") == size_label and not v.get("disabled"):
                return v
    return None


async def ensure_item_variants(item_doc: Dict[str, Any]) -> Dict[str, Any]:
    """Backfill ``variants`` on an item document if missing/empty.

    Persists the change back to Mongo when we had to generate one.
    Idempotent — a subsequent call is a no-op.
    """
    existing = item_doc.get("variants") or []
    if existing:
        return item_doc
    generated = generate_variants(
        item_doc.get("sizes") or [], item_doc.get("colors") or []
    )
    if not generated:
        return item_doc
    await db.items.update_one({"id": item_doc["id"]}, {"$set": {"variants": generated}})
    item_doc["variants"] = generated
    return item_doc


async def backfill_all_variants() -> int:
    """One-shot startup migration: give every item a ``variants`` array.
    Returns the number of items backfilled. Idempotent — items that
    already have variants are skipped.
    """
    cursor = db.items.find({"$or": [{"variants": {"$exists": False}}, {"variants": []}]}, {"_id": 0})
    n = 0
    async for it in cursor:
        v = generate_variants(it.get("sizes") or [], it.get("colors") or [])
        if v:
            await db.items.update_one({"id": it["id"]}, {"$set": {"variants": v}})
            n += 1
    if n:
        logger.info("Backfilled variants on %d items", n)
    return n


async def group_duplicate_items() -> int:
    """Group items with identical ``(seller_id, name.lower(), brand_name)``
    into a single "parent" and merge their variants. The oldest item
    (lowest ``created_at``) becomes the parent; the rest are hidden
    from buyer surfaces via a ``merged_into`` field so historical
    order/analytics links keep working.

    Returns the number of children merged. Idempotent — items already
    marked ``merged_into`` are skipped.
    """
    # Aggregate duplicates.
    buckets: Dict[str, List[Dict[str, Any]]] = {}
    cursor = db.items.find({"merged_into": {"$exists": False}}, {"_id": 0})
    async for it in cursor:
        key = f"{it.get('seller_id')}::{_norm_name(it.get('name'))}::{_norm_name(it.get('brand_name'))}"
        buckets.setdefault(key, []).append(it)
    merged = 0
    for key, group in buckets.items():
        if len(group) < 2:
            continue
        group.sort(key=lambda x: x.get("created_at") or 0)
        parent, *children = group
        # Merge each child's variants into the parent.
        parent_variants = list(parent.get("variants") or [])
        parent_colors = list(parent.get("colors") or [])
        parent_sizes = list(parent.get("sizes") or [])
        parent_images: List[str] = list(parent.get("images") or ([parent.get("image_b64")] if parent.get("image_b64") else []))
        existing_variant_keys = {
            f"{v.get('size_label')}::{_norm_name(v.get('color_name'))}"
            for v in parent_variants
        }
        color_names = {_norm_name(c.get("name")) for c in parent_colors}
        size_labels = {s.get("label") for s in parent_sizes}
        for ch in children:
            for c in ch.get("colors") or []:
                if _norm_name(c.get("name")) not in color_names:
                    parent_colors.append(c)
                    color_names.add(_norm_name(c.get("name")))
            for s in ch.get("sizes") or []:
                if s.get("label") not in size_labels:
                    parent_sizes.append(s)
                    size_labels.add(s.get("label"))
            for v in ch.get("variants") or generate_variants(
                ch.get("sizes") or [], ch.get("colors") or []
            ):
                vk = f"{v.get('size_label')}::{_norm_name(v.get('color_name'))}"
                if vk in existing_variant_keys:
                    # If duplicate, sum the quantities.
                    for pv in parent_variants:
                        if (
                            pv.get("size_label") == v.get("size_label")
                            and _norm_name(pv.get("color_name"))
                            == _norm_name(v.get("color_name"))
                        ):
                            pv["quantity"] = int(pv.get("quantity") or 0) + int(v.get("quantity") or 0)
                            break
                else:
                    v_copy = dict(v)
                    v_copy["id"] = str(uuid.uuid4())
                    parent_variants.append(v_copy)
                    existing_variant_keys.add(vk)
            for img in ch.get("images") or ([ch.get("image_b64")] if ch.get("image_b64") else []):
                if img and img not in parent_images and len(parent_images) < 5:
                    parent_images.append(img)
            # Point the child at the parent so old links resolve.
            await db.items.update_one(
                {"id": ch["id"]},
                {"$set": {"merged_into": parent["id"], "is_paused": True}},
            )
            merged += 1
        await db.items.update_one(
            {"id": parent["id"]},
            {
                "$set": {
                    "variants": parent_variants,
                    "colors": parent_colors,
                    "sizes": parent_sizes,
                    "images": parent_images,
                    "image_b64": parent_images[0] if parent_images else parent.get("image_b64"),
                }
            },
        )
    if merged:
        logger.info("Merged %d duplicate items into parents", merged)
    return merged

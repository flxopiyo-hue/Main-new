"""Zone-based courier fees + delivery-job helpers (Phase 1 courier system).

Fee anchor from the founder: Nairobi CBD → Karen ≈ KSh 600 by boda.
Other zones are scaled off that anchor. Every fee is admin-editable via
``/api/admin/delivery-zones`` — the seeded values below only apply on
first boot (or for zones missing from the DB).

Split: 10% of each courier fee stays with Oromona (``courier_platform_bps``),
the rider earns the remaining 90%. Free delivery above the threshold is
absorbed by the platform — the rider is still paid their full cut.

Money convention: cents = 1/100 KES (KSh 600 → 60000).
"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from core.db import db

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

DEFAULT_ZONES: List[Dict[str, Any]] = [
    {
        "key": "nairobi_inner",
        "label": "Inner Nairobi",
        "fee_cents": 30000,  # KSh 300 (~half the Karen anchor distance)
        "sort": 1,
        "terms": [
            "westlands", "kilimani", "kileleshwa", "lavington", "hurlingham",
            "upper hill", "upperhill", "south b", "south c", "parklands",
            "ngara", "pangani", "eastleigh", "industrial area", "cbd",
            "city centre", "city center", "milimani", "adams arcade",
        ],
    },
    {
        "key": "nairobi_outer",
        "label": "Outer Nairobi",
        "fee_cents": 60000,  # KSh 600 — the CBD→Karen anchor
        "sort": 2,
        "terms": [
            "karen", "langata", "lang'ata", "runda", "gigiri", "muthaiga",
            "kasarani", "roysambu", "embakasi", "donholm", "umoja", "kayole",
            "njiru", "dagoretti", "kawangware", "uthiru", "ruaka", "kikuyu",
            "buruburu", "kariobangi", "githurai", "zimmerman", "kahawa",
            "utawala", "south lands", "imara daima",
        ],
    },
    {
        "key": "nairobi_metro",
        "label": "Nairobi Metro (satellite towns)",
        "fee_cents": 90000,  # KSh 900 (~1.5× the Karen anchor)
        "sort": 3,
        "terms": [
            "kitengela", "athi river", "ngong", "rongai", "ongata rongai",
            "syokimau", "mlolongo", "ruiru", "juja", "thika", "kiambu",
            "limuru", "kiserian", "tuala", "joska", "kamulu",
        ],
    },
    {
        "key": "major_towns",
        "label": "Major Towns (intercity courier)",
        "fee_cents": 50000,  # KSh 500 — parcel shuttle, not boda
        "sort": 4,
        "terms": [
            "mombasa", "kisumu", "nakuru", "eldoret", "naivasha", "nyeri",
            "meru", "machakos", "kericho", "kakamega", "kitale", "malindi",
            "embu", "kisii", "bungoma", "garissa", "nanyuki", "kilifi",
            "diani", "voi", "kitui", "narok",
        ],
    },
    {
        "key": "rest_of_kenya",
        "label": "Rest of Kenya",
        "fee_cents": 70000,  # KSh 700
        "sort": 5,
        "terms": [],
    },
]

DEFAULT_SETTINGS: Dict[str, int] = {
    "free_delivery_threshold_cents": 2_000_000,  # KSh 20,000
    "courier_platform_bps": 1000,  # 10% of the courier fee stays with Oromona
}

CBD_PICKUP_LABEL = "Pick up at Nairobi CBD point"


async def ensure_delivery_seed() -> None:
    """Idempotent boot seed — inserts any missing zones/settings without
    touching admin-edited values."""
    for z in DEFAULT_ZONES:
        await db.delivery_zones.update_one(
            {"key": z["key"]}, {"$setOnInsert": z}, upsert=True
        )
    for k, v in DEFAULT_SETTINGS.items():
        await db.platform_settings.update_one(
            {"key": k}, {"$setOnInsert": {"key": k, "value": v}}, upsert=True
        )
    logger.info("delivery: zones + settings seed ready")


# ---------------------------------------------------------------------------
# Zones / settings accessors
# ---------------------------------------------------------------------------


async def get_zones() -> List[Dict[str, Any]]:
    return await db.delivery_zones.find({}, {"_id": 0}).sort("sort", 1).to_list(20)


async def get_setting(key: str) -> int:
    doc = await db.platform_settings.find_one({"key": key}, {"_id": 0})
    if doc is not None:
        return int(doc["value"])
    return int(DEFAULT_SETTINGS.get(key, 0))


def detect_zone(addr: Dict[str, Any], zones: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Match the buyer's area/city text against zone terms. Unmatched
    Nairobi addresses default to Outer Nairobi (never undercharge);
    everything else falls to Rest of Kenya."""
    text = " ".join(
        str(addr.get(k) or "") for k in ("area", "city", "street", "building_estate")
    ).lower()
    by_key = {z["key"]: z for z in zones}
    for z in zones:  # zones sorted by `sort` — inner wins over outer etc.
        for term in z.get("terms") or []:
            if term in text:
                return z
    if "nairobi" in text and "nairobi_outer" in by_key:
        return by_key["nairobi_outer"]
    return by_key.get("rest_of_kenya") or zones[-1]


async def quote_for_address(
    addr: Dict[str, Any], item_total_kes_cents: int
) -> Dict[str, Any]:
    """Compute the courier fee the BUYER pays for a door delivery.
    Free-delivery threshold waives the buyer-side fee (platform absorbs
    the rider's cut in that case)."""
    zones = await get_zones()
    zone = detect_zone(addr, zones)
    threshold = await get_setting("free_delivery_threshold_cents")
    free = threshold > 0 and item_total_kes_cents >= threshold
    fee = int(zone["fee_cents"])
    return {
        "zone_key": zone["key"],
        "zone_label": zone["label"],
        "fee_cents": fee,
        "free_delivery_threshold_cents": threshold,
        "free_applied": free,
        "fee_due_cents": 0 if free else fee,
    }


# ---------------------------------------------------------------------------
# Delivery jobs
# ---------------------------------------------------------------------------


async def create_delivery_job(
    order: Dict[str, Any], seller: Dict[str, Any]
) -> Dict[str, Any]:
    """Seller marked the order ready for courier pickup — open a job on
    the rider board. The rider's cut is 90% of the ZONE fee even when
    the buyer got free delivery (platform absorbs it)."""
    zones = await get_zones()
    by_key = {z["key"]: z for z in zones}
    zone = by_key.get(order.get("delivery_zone_key") or "")
    if zone is None:
        zone = detect_zone(order.get("shipping_address") or {}, zones)
    base_fee = int(zone["fee_cents"])
    platform_bps = await get_setting("courier_platform_bps")
    platform_cut = (base_fee * platform_bps) // 10000
    rider_cut = base_fee - platform_cut

    seller_loc = seller.get("location") or {}
    addr = order.get("shipping_address") or {}
    now = datetime.now(timezone.utc)
    code = f"{secrets.randbelow(10000):04d}"
    job = {
        "id": str(uuid.uuid4()),
        "order_id": order["id"],
        "seller_id": order["seller_id"],
        "buyer_id": order["buyer_id"],
        "courier_id": None,
        "status": "open",  # open → accepted → picked_up → out_for_delivery → delivered
        "item_name": order.get("item_name"),
        "pickup_area": ", ".join(
            [p for p in [seller.get("company_name"), seller_loc.get("city")] if p]
        )
        or "Nairobi CBD",
        "dropoff_area": ", ".join(
            [p for p in [addr.get("area"), addr.get("city")] if p]
        )
        or "Kenya",
        "zone_key": zone["key"],
        "zone_label": zone["label"],
        "fee_cents": base_fee,
        "rider_cut_cents": rider_cut,
        "platform_cut_cents": platform_cut,
        "handover_code": code,
        "created_at": now,
        "accepted_at": None,
        "picked_up_at": None,
        "out_for_delivery_at": None,
        "delivered_at": None,
    }
    await db.delivery_jobs.insert_one({**job})
    await db.orders.update_one(
        {"id": order["id"]},
        {"$set": {"courier_job_id": job["id"], "handover_code": code}},
    )
    return job


def job_public_view(job: Dict[str, Any], *, include_dropoff_full: bool = False) -> Dict[str, Any]:
    """What a rider sees. Full buyer address/phone only after accepting."""
    out = {
        "id": job["id"],
        "order_id": job["order_id"],
        "status": job["status"],
        "item_name": job.get("item_name"),
        "pickup_area": job.get("pickup_area"),
        "dropoff_area": job.get("dropoff_area"),
        "zone_label": job.get("zone_label"),
        "rider_cut_cents": job.get("rider_cut_cents"),
        "created_at": job.get("created_at"),
        "accepted_at": job.get("accepted_at"),
        "picked_up_at": job.get("picked_up_at"),
        "out_for_delivery_at": job.get("out_for_delivery_at"),
        "delivered_at": job.get("delivered_at"),
    }
    if include_dropoff_full:
        out["dropoff_address"] = None  # filled by the router from the order
    return out

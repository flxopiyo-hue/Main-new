"""Courier delivery system (Phase 1).

Buyer:   POST /delivery/quote           — zone fee preview for an address
Courier: GET  /courier/jobs             — open board + my active jobs
         POST /courier/jobs/{id}/accept
         POST /courier/jobs/{id}/status — picked_up | out_for_delivery
         POST /courier/jobs/{id}/deliver— handover-code confirmation
         GET  /courier/earnings         — today / pending / paid ledger
Admin:   GET  /admin/couriers           — riders + pending balances
         POST /admin/couriers/{id}/approve | /reject | /mark-paid
         GET/PATCH /admin/delivery-zones, /admin/delivery-settings

Money flow: buyer pays the zone fee at checkout (waived above the
free-delivery threshold — platform absorbs). Rider earns 90% of the
zone fee, credited on successful handover-code entry; 10% stays with
Oromona. End-of-day payouts are recorded by admin (real M-Pesa
transfers are Phase 2).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import delivery as dlv
from core import escrow as escrow_mod
from core.db import db
from core.security import get_current_user, require_admin

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------


async def _require_courier(user: Dict[str, Any]) -> None:
    if user.get("role") != "courier":
        raise HTTPException(status_code=403, detail="Requires courier role")
    # Approval state lives in the DB, never in the JWT — re-read fresh.
    fresh = await db.users.find_one({"id": user["id"]}, {"courier_status": 1})
    status = (fresh or {}).get("courier_status")
    if status != "approved":
        raise HTTPException(
            status_code=403,
            detail="Your courier account is pending approval — you'll be able to take jobs once Oromona approves you.",
        )


# ---------------------------------------------------------------------------
# Buyer: fee quote
# ---------------------------------------------------------------------------


class QuoteIn(BaseModel):
    address_id: str
    item_total_cents: int = Field(ge=0)
    currency: str = "KES"


@router.post("/delivery/quote")
async def delivery_quote(
    body: QuoteIn, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    addr = await db.addresses.find_one(
        {"id": body.address_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not addr:
        raise HTTPException(status_code=404, detail="Address not found")
    if (body.currency or "KES").upper() != "KES":
        # Cross-currency courier fees aren't supported yet — no fee is
        # charged, seller arranges shipping for non-KES listings.
        return {
            "supported": False,
            "zone_key": None,
            "zone_label": None,
            "fee_cents": 0,
            "fee_due_cents": 0,
            "free_applied": False,
            "free_delivery_threshold_cents": 0,
        }
    q = await dlv.quote_for_address(addr, body.item_total_cents)
    return {"supported": True, **q}


# ---------------------------------------------------------------------------
# Courier: job board + lifecycle
# ---------------------------------------------------------------------------


@router.get("/courier/me")
async def courier_me(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if user.get("role") != "courier":
        raise HTTPException(status_code=403, detail="Requires courier role")
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return {
        "courier_status": fresh.get("courier_status") or "pending",
        "phone": fresh.get("phone"),
        "mpesa_number": fresh.get("mpesa_number"),
    }


@router.get("/courier/jobs")
async def courier_jobs(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    await _require_courier(user)
    open_jobs = (
        await db.delivery_jobs.find({"status": "open"}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(50)
    )
    mine = (
        await db.delivery_jobs.find(
            {"courier_id": user["id"], "status": {"$in": ["accepted", "picked_up", "out_for_delivery"]}},
            {"_id": 0},
        )
        .sort("accepted_at", -1)
        .to_list(50)
    )
    return {
        "open": [dlv.job_public_view(j) for j in open_jobs],
        "mine": [await _job_with_dropoff(j) for j in mine],
    }


async def _job_with_dropoff(job: Dict[str, Any]) -> Dict[str, Any]:
    """Full dropoff address + buyer phone — only for the accepted rider."""
    out = dlv.job_public_view(job)
    order = await db.orders.find_one({"id": job["order_id"]}, {"_id": 0, "shipping_address": 1})
    addr = (order or {}).get("shipping_address") or {}
    out["dropoff_address"] = {
        k: addr.get(k)
        for k in ("recipient_name", "phone", "building_estate", "house_number", "street", "area", "city", "delivery_notes")
    }
    return out


@router.get("/courier/jobs/{job_id}")
async def courier_job_detail(
    job_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    await _require_courier(user)
    job = await db.delivery_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("courier_id") == user["id"]:
        return await _job_with_dropoff(job)
    if job["status"] == "open":
        return dlv.job_public_view(job)
    raise HTTPException(status_code=403, detail="Not your job")


@router.post("/courier/jobs/{job_id}/accept")
async def accept_job(
    job_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    await _require_courier(user)
    now = datetime.now(timezone.utc)
    # Atomic claim — only one rider can win an open job.
    res = await db.delivery_jobs.update_one(
        {"id": job_id, "status": "open"},
        {"$set": {"status": "accepted", "courier_id": user["id"], "accepted_at": now}},
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=409, detail="Job already taken (or not open)")
    job = await db.delivery_jobs.find_one({"id": job_id}, {"_id": 0})
    # Surface the rider on the buyer's order.
    await db.orders.update_one(
        {"id": job["order_id"]},
        {
            "$set": {
                "courier_name": user.get("full_name"),
                "courier_phone": user.get("phone"),
            }
        },
    )
    return await _job_with_dropoff(job)


class JobStatusIn(BaseModel):
    action: Literal["picked_up", "out_for_delivery"]


@router.post("/courier/jobs/{job_id}/status")
async def job_status(
    job_id: str, body: JobStatusIn, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    await _require_courier(user)
    job = await db.delivery_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job or job.get("courier_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Job not found")
    now = datetime.now(timezone.utc)
    if body.action == "picked_up":
        if job["status"] != "accepted":
            raise HTTPException(status_code=400, detail=f"Cannot pick up from '{job['status']}'")
        await db.delivery_jobs.update_one(
            {"id": job_id}, {"$set": {"status": "picked_up", "picked_up_at": now}}
        )
        # Buyer's timeline: parcel is moving — reuse the "shipped" stage.
        await db.orders.update_one(
            {"id": job["order_id"], "status": {"$in": ["paid", "in_fulfillment"]}},
            {
                "$set": {
                    "status": "shipped",
                    "shipped_at": now,
                    "carrier": "Oromona Rider",
                    "tracking_number": f"RIDER-{job_id[:8].upper()}",
                }
            },
        )
    else:  # out_for_delivery
        if job["status"] not in ("picked_up", "accepted"):
            raise HTTPException(status_code=400, detail=f"Cannot go out-for-delivery from '{job['status']}'")
        await db.delivery_jobs.update_one(
            {"id": job_id},
            {"$set": {"status": "out_for_delivery", "out_for_delivery_at": now,
                      **({"picked_up_at": job.get("picked_up_at") or now} if not job.get("picked_up_at") else {})}},
        )
        await db.orders.update_one(
            {"id": job["order_id"]},
            {"$set": {"out_for_delivery_at": now}},
        )
    fresh = await db.delivery_jobs.find_one({"id": job_id}, {"_id": 0})
    return await _job_with_dropoff(fresh)


class DeliverIn(BaseModel):
    code: str = Field(min_length=4, max_length=4)


@router.post("/courier/jobs/{job_id}/deliver")
async def deliver_job(
    job_id: str, body: DeliverIn, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    await _require_courier(user)
    job = await db.delivery_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job or job.get("courier_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] == "delivered":
        return {"ok": True, "already": True}
    if job["status"] not in ("picked_up", "out_for_delivery"):
        raise HTTPException(status_code=400, detail=f"Cannot deliver from '{job['status']}'")
    if body.code.strip() != job.get("handover_code"):
        raise HTTPException(
            status_code=400,
            detail="Wrong handover code — ask the buyer for the 4-digit code shown on their order screen.",
        )
    now = datetime.now(timezone.utc)
    await db.delivery_jobs.update_one(
        {"id": job_id}, {"$set": {"status": "delivered", "delivered_at": now}}
    )
    # Code entry = proof of handover → order delivered + 48h escrow
    # window starts (buyer can still confirm early or dispute).
    await escrow_mod.start_delivery_window(job["order_id"])
    # Credit the rider's 90% cut — paid out end-of-day by admin.
    await db.courier_earnings.insert_one(
        {
            "id": str(uuid.uuid4()),
            "courier_id": user["id"],
            "job_id": job_id,
            "order_id": job["order_id"],
            "item_name": job.get("item_name"),
            "amount_cents": int(job.get("rider_cut_cents") or 0),
            "currency": "KES",
            "status": "pending",  # pending → paid (end-of-day batch)
            "created_at": now,
            "paid_at": None,
        }
    )
    return {"ok": True, "earned_cents": int(job.get("rider_cut_cents") or 0)}


@router.get("/courier/earnings")
async def courier_earnings(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    await _require_courier(user)
    rows = (
        await db.courier_earnings.find({"courier_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(100)
    )
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    def _aware(dt: datetime) -> datetime:
        # Mongo hands back naive datetimes — normalise before comparing.
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt

    today = sum(r["amount_cents"] for r in rows if _aware(r["created_at"]) >= day_start)
    pending = sum(r["amount_cents"] for r in rows if r["status"] == "pending")
    paid = sum(r["amount_cents"] for r in rows if r["status"] == "paid")
    return {
        "today_cents": today,
        "pending_cents": pending,
        "paid_cents": paid,
        "rows": rows,
    }


# ---------------------------------------------------------------------------
# Admin: courier approvals, payouts, zone editor
# ---------------------------------------------------------------------------


@router.get("/admin/couriers")
async def admin_couriers(admin: Dict[str, Any] = Depends(require_admin)) -> List[Dict[str, Any]]:
    riders = (
        await db.users.find(
            {"role": "courier"},
            {"_id": 0, "id": 1, "full_name": 1, "email": 1, "phone": 1, "mpesa_number": 1, "courier_status": 1, "created_at": 1},
        )
        .sort("created_at", -1)
        .to_list(200)
    )
    out = []
    for r in riders:
        pend = await db.courier_earnings.aggregate(
            [
                {"$match": {"courier_id": r["id"], "status": "pending"}},
                {"$group": {"_id": None, "total": {"$sum": "$amount_cents"}, "n": {"$sum": 1}}},
            ]
        ).to_list(1)
        r["pending_cents"] = int(pend[0]["total"]) if pend else 0
        r["pending_count"] = int(pend[0]["n"]) if pend else 0
        out.append(r)
    return out


@router.post("/admin/couriers/{user_id}/approve")
async def approve_courier(user_id: str, admin: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    res = await db.users.update_one(
        {"id": user_id, "role": "courier"},
        # token_version bump forces a re-login so the fresh approval
        # state is picked up everywhere immediately.
        {"$set": {"courier_status": "approved"}, "$inc": {"token_version": 1}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Courier not found")
    return {"ok": True, "courier_status": "approved"}


@router.post("/admin/couriers/{user_id}/reject")
async def reject_courier(user_id: str, admin: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    res = await db.users.update_one(
        {"id": user_id, "role": "courier"},
        {"$set": {"courier_status": "rejected"}, "$inc": {"token_version": 1}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Courier not found")
    return {"ok": True, "courier_status": "rejected"}


@router.post("/admin/couriers/{user_id}/mark-paid")
async def mark_courier_paid(user_id: str, admin: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    """End-of-day settlement: admin pays the rider via M-Pesa manually
    (Phase 1) and records it here. Phase 2 automates the transfer."""
    now = datetime.now(timezone.utc)
    batch_id = str(uuid.uuid4())
    pend = await db.courier_earnings.aggregate(
        [
            {"$match": {"courier_id": user_id, "status": "pending"}},
            {"$group": {"_id": None, "total": {"$sum": "$amount_cents"}, "n": {"$sum": 1}}},
        ]
    ).to_list(1)
    total = int(pend[0]["total"]) if pend else 0
    n = int(pend[0]["n"]) if pend else 0
    if n == 0:
        raise HTTPException(status_code=400, detail="No pending earnings for this rider")
    await db.courier_earnings.update_many(
        {"courier_id": user_id, "status": "pending"},
        {"$set": {"status": "paid", "paid_at": now, "batch_id": batch_id}},
    )
    await db.courier_payout_batches.insert_one(
        {
            "id": batch_id,
            "courier_id": user_id,
            "total_cents": total,
            "deliveries": n,
            "created_at": now,
            "created_by": admin["id"],
        }
    )
    return {"ok": True, "batch_id": batch_id, "total_cents": total, "deliveries": n}


@router.get("/admin/delivery-zones")
async def admin_zones(admin: Dict[str, Any] = Depends(require_admin)) -> List[Dict[str, Any]]:
    return await dlv.get_zones()


class ZonePatch(BaseModel):
    fee_cents: Optional[int] = Field(default=None, ge=0)
    label: Optional[str] = Field(default=None, min_length=2, max_length=80)


@router.patch("/admin/delivery-zones/{key}")
async def patch_zone(
    key: str, body: ZonePatch, admin: Dict[str, Any] = Depends(require_admin)
) -> Dict[str, Any]:
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.delivery_zones.update_one({"key": key}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Zone not found")
    return await db.delivery_zones.find_one({"key": key}, {"_id": 0})


@router.get("/admin/delivery-settings")
async def admin_settings(admin: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    return {
        "free_delivery_threshold_cents": await dlv.get_setting("free_delivery_threshold_cents"),
        "courier_platform_bps": await dlv.get_setting("courier_platform_bps"),
    }


class SettingsPatch(BaseModel):
    free_delivery_threshold_cents: Optional[int] = Field(default=None, ge=0)
    courier_platform_bps: Optional[int] = Field(default=None, ge=0, le=5000)


@router.patch("/admin/delivery-settings")
async def patch_settings(
    body: SettingsPatch, admin: Dict[str, Any] = Depends(require_admin)
) -> Dict[str, Any]:
    for k, v in body.model_dump().items():
        if v is not None:
            await db.platform_settings.update_one(
                {"key": k}, {"$set": {"key": k, "value": int(v)}}, upsert=True
            )
    return {
        "free_delivery_threshold_cents": await dlv.get_setting("free_delivery_threshold_cents"),
        "courier_platform_bps": await dlv.get_setting("courier_platform_bps"),
    }

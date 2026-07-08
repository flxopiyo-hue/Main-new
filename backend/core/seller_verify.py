"""Seller verification helpers.

The "verified seller" badge is auto-awarded once a seller crosses a
paid-orders threshold. Buyers see a small check-mark chip next to that
seller's name on Discover cards and the Item Detail screen, giving the
platform's trust surface a manual-review-free growth signal.
"""

from __future__ import annotations

import logging
from typing import Dict, Iterable, List, Set

from core.db import db

logger = logging.getLogger("aurafit.seller_verify")

# Sellers hit the "Verified" tier at this many paid orders. The user
# provided this value during the iter-18 kickoff Q&A. Keep it in one
# place so raising the bar later is a single-file change.
VERIFIED_ORDERS_THRESHOLD: int = 5


async def maybe_verify_seller(seller_id: str) -> bool:
    """Recount the seller's paid orders and flip `verified_seller` to
    True when the threshold is crossed. Idempotent — running it on an
    already-verified seller is a cheap no-op.

    Returns True when this call transitioned the seller from unverified
    to verified so callers can log/notify. The count is stored as
    `verified_orders_count` for surfacing on the seller dashboard.
    """
    if not seller_id:
        return False
    count = await db.orders.count_documents(
        {"seller_id": seller_id, "status": {"$in": ["paid", "in_fulfillment", "shipped", "delivered"]}}
    )
    seller = await db.users.find_one({"id": seller_id}, {"verified_seller": 1, "_id": 0})
    was_verified = bool(seller and seller.get("verified_seller"))
    should_verify = count >= VERIFIED_ORDERS_THRESHOLD
    update: Dict[str, int | bool] = {"verified_orders_count": int(count)}
    if should_verify:
        update["verified_seller"] = True
    await db.users.update_one({"id": seller_id}, {"$set": update})
    return should_verify and not was_verified


async def load_seller_verification_map(seller_ids: Iterable[str]) -> Dict[str, bool]:
    """Batched lookup — one round-trip per items list rather than N.

    Given a set of seller ids returns a `{seller_id: verified_seller}`
    dict for use inside `item_to_out(..., seller_verified=...)`.
    """
    ids: Set[str] = {sid for sid in seller_ids if sid}
    if not ids:
        return {}
    cursor = db.users.find(
        {"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "verified_seller": 1}
    )
    out: Dict[str, bool] = {}
    async for doc in cursor:
        out[doc["id"]] = bool(doc.get("verified_seller"))
    return out


async def backfill_all_seller_verifications() -> int:
    """Idempotent one-shot: walk every seller and recompute their
    verified counter. Called from server startup so that historical
    data (pre-migration) picks up its badge on next boot.

    Returns the number of sellers who newly crossed the threshold.
    """
    newly_verified = 0
    cursor = db.users.find({"role": "seller"}, {"_id": 0, "id": 1})
    seller_ids: List[str] = [d["id"] async for d in cursor]
    for sid in seller_ids:
        if await maybe_verify_seller(sid):
            newly_verified += 1
    if newly_verified:
        logger.info("verified_seller backfill: %d newly verified", newly_verified)
    return newly_verified

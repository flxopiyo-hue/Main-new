"""AuraFit backend entry point.

This file is intentionally tiny — it composes the FastAPI app from focused
routers under ``/app/backend/routers``. Shared infrastructure lives in
``/app/backend/core`` (config, db, security, images). Pydantic schemas and
DB→DTO mappers live in ``/app/backend/models.py``.

ROUTE LAYOUT (all under ``/api`` prefix)
  • auth         — register, login, /auth/me, preferences
  • profile      — body profile + Gemini measurement estimation
  • items        — items CRUD + personalised /feed
  • wishlist     — wishlist add/remove/list with restock detection
  • tryon        — multi-angle Gemini Nano Banana try-on + share
  • orders       — buyer orders + fit feedback
  • payments     — Paystack Checkout + return bridge + status polling (item purchases)
  • subs         — Paystack subscriptions (Premium tier)
  • seller       — analytics + Paystack payout account onboarding
  • collections  — designer drops (collections)
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware

from core.db import close_db
from routers import (
    addresses,
    admin,
    auth,
    categories,
    collections,
    delivery,
    items,
    legal,
    loved_ones,
    orders,
    payments,
    profile,
    restock,
    seller,
    sso,
    stylist,
    subs,
    tryon,
    users,
    wishlist,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("aurafit")

app = FastAPI(title="AuraFit API")

# All AuraFit endpoints sit under /api — Kubernetes ingress matches /api/*
# and forwards to this service on port 8001.
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root() -> dict:
    return {"app": "Oromona", "status": "ok"}


# Order doesn't matter for routing (paths are disjoint) but the order below
# determines OpenAPI tag ordering and is grouped by concern.
api_router.include_router(auth.router)
api_router.include_router(sso.router)
api_router.include_router(users.router)
api_router.include_router(profile.router)
api_router.include_router(categories.router)
api_router.include_router(loved_ones.router)
api_router.include_router(addresses.router)
api_router.include_router(items.router)
api_router.include_router(wishlist.router)
api_router.include_router(tryon.router)
api_router.include_router(stylist.router)
api_router.include_router(orders.router)
api_router.include_router(payments.router)
api_router.include_router(seller.router)
api_router.include_router(delivery.router)
api_router.include_router(collections.router)
api_router.include_router(legal.router)
api_router.include_router(admin.router)

# Store/marketing assets (App Store screenshots etc.) — read-only static
# files under /api so the ingress forwards them to this service.
_appstore_dir = Path("/app/appstore_screenshots")
if _appstore_dir.is_dir():
    app.mount("/api/appstore", StaticFiles(directory=str(_appstore_dir)), name="appstore")

# Restock notifications carry their own /api prefix (like subs.router
# below) so they can compose /api/items/{id}/notify without stepping
# on the items router's /items/{id} handler.
app.include_router(restock.router)

# Subscriptions router carries its own /api/subs prefix (unlike the
# others which are prefixed by the api_router). Mount it directly on
# the app so the shape stays /api/subs/* rather than /api/api/subs/*.
app.include_router(subs.router)

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def normalize_zero_decimal_prices() -> None:
    """One-shot migration: items created before the cents-parser fix have
    `price_cents` stored in MAJOR units (e.g. "11000" for KSh 11,000)
    rather than minor units (which `formatPrice` always divides by 100).
    Bump those by ×100 and mark them with ``cents_normalized=True`` so
    we never double-multiply.

    Only zero-decimal currencies are affected — USD/EUR/etc. were always
    stored correctly because their seller-facing decimals are 2 and
    `parseAmountToCents` multiplied appropriately. Idempotent on repeat
    runs because of the `cents_normalized` flag.

    Legacy seed items that predate the currency field default to KES so
    they get pulled through the same normalization path. The same
    correction is applied to `orders.amount_cents` so historical revenue
    figures on the seller dashboard don't show KSh 507 for what should
    be KSh 50,700.
    """
    from core.db import db as _db

    ZERO_DECIMAL = {"KES", "NGN", "UGX", "TZS", "RWF", "INR"}
    try:
        # Step 1 — legacy items missing a currency field. Assume KES so
        # they land in the zero-decimal bucket for the bump below.
        await _db.items.update_many(
            {"currency": {"$exists": False}},
            {"$set": {"currency": "KES"}},
        )
        # Step 2 — bump price_cents by ×100 for anything that hasn't been
        # normalized yet.
        cursor = _db.items.find(
            {
                "currency": {"$in": list(ZERO_DECIMAL)},
                "cents_normalized": {"$ne": True},
            },
            {"_id": 0, "id": 1, "price_cents": 1},
        )
        bumped_items = 0
        async for doc in cursor:
            await _db.items.update_one(
                {"id": doc["id"]},
                {
                    "$set": {
                        "price_cents": int(doc.get("price_cents") or 0) * 100,
                        "cents_normalized": True,
                    }
                },
            )
            bumped_items += 1
        if bumped_items:
            logger.info(
                "price_cents normalization: bumped %d zero-decimal item(s)",
                bumped_items,
            )

        # Step 3 — same fix for historical orders. Orders captured the
        # buggy item.price_cents at checkout time so the seller
        # dashboard's KSh totals are 100× smaller than the reality.
        await _db.orders.update_many(
            {"currency": {"$exists": False}},
            {"$set": {"currency": "KES"}},
        )
        cursor_o = _db.orders.find(
            {
                "currency": {"$in": list(ZERO_DECIMAL)},
                "cents_normalized": {"$ne": True},
            },
            {"_id": 0, "id": 1, "amount_cents": 1, "subtotal_cents": 1, "platform_fee_cents": 1, "seller_net_cents": 1},
        )
        bumped_orders = 0
        async for doc in cursor_o:
            update: dict = {"cents_normalized": True}
            for k in ("amount_cents", "subtotal_cents", "platform_fee_cents", "seller_net_cents"):
                v = doc.get(k)
                if v is not None:
                    update[k] = int(v) * 100
            await _db.orders.update_one({"id": doc["id"]}, {"$set": update})
            bumped_orders += 1
        if bumped_orders:
            logger.info(
                "amount_cents normalization: bumped %d zero-decimal order(s)",
                bumped_orders,
            )
    except Exception as e:  # pragma: no cover - migration must not crash boot
        logger.warning("price_cents normalization skipped: %s", e)


@app.on_event("startup")
async def backfill_verified_sellers() -> None:
    """Compute the auto-verified badge for every existing seller once at
    boot so historical demo data lights up without waiting for a fresh
    order. Idempotent — the helper itself is safe on repeat runs.
    """
    try:
        from core.seller_verify import backfill_all_seller_verifications
        await backfill_all_seller_verifications()
    except Exception as e:  # pragma: no cover
        logger.warning("verified_seller backfill skipped: %s", e)


@app.on_event("startup")
async def bootstrap_categories() -> None:
    """Seed system categories and ensure a unique index on `slug` so two
    sellers racing on 'Add category' don't create duplicates."""
    try:
        from routers.categories import ensure_default_categories
        from core.db import db

        await db.categories.create_index("slug", unique=True)
        await db.categories.create_index("audiences")
        await ensure_default_categories()
        logger.info("categories: seeded system rows + indexes ready")
    except Exception as e:  # pragma: no cover
        logger.warning("categories bootstrap skipped: %s", e)


@app.on_event("startup")
async def bootstrap_delivery() -> None:
    """Seed courier delivery zones + platform settings (idempotent)."""
    try:
        from core.delivery import ensure_delivery_seed

        await ensure_delivery_seed()
    except Exception as e:  # pragma: no cover
        logger.warning("delivery bootstrap skipped: %s", e)


@app.on_event("startup")
async def bootstrap_premium_plan() -> None:
    """Idempotent Paystack plan bootstrap for Oromona Premium.

    On the first boot after keys land in .env this creates the KES 199
    plan with a 7-day trial. On subsequent boots it just looks up the
    plan_code by name and caches it. Never crashes startup — if
    Paystack is down we log and Premium checkout stays disabled until
    the next boot picks it back up.
    """
    try:
        from routers.subs import ensure_premium_plan, set_plan_code

        code = await ensure_premium_plan()
        set_plan_code(code)
        if code:
            logger.info("paystack: premium plan ready (%s)", code)
    except Exception as e:  # pragma: no cover
        logger.warning("premium plan bootstrap skipped: %s", e)


@app.on_event("startup")
async def bootstrap_item_variants() -> None:
    """One-time migration on boot: backfill every legacy item with a
    ``variants`` array (auto-generated from sizes × colors) and merge
    duplicate items (same seller + name + brand) into single parents
    with combined variants. Fully idempotent — items already migrated
    are skipped.
    """
    try:
        from core.variants import backfill_all_variants, group_duplicate_items

        backfilled = await backfill_all_variants()
        merged = await group_duplicate_items()
        if backfilled or merged:
            logger.info(
                "variants bootstrap: backfilled=%d merged_duplicates=%d",
                backfilled,
                merged,
            )
    except Exception as e:  # pragma: no cover
        logger.warning("variants bootstrap skipped: %s", e)


# Background escrow sweep — checks for orders whose 48h buyer-
# confirmation window has expired and releases the payout. Runs every
# 5 minutes so end-of-window delay stays negligible from the seller's
# perspective. Kept lean (single DB query + optional Paystack Transfer
# per due order) so it's safe to run alongside request traffic.
_ESCROW_SWEEP_INTERVAL_SECONDS = 300


@app.on_event("startup")
async def start_escrow_sweeper() -> None:
    import asyncio

    async def _loop() -> None:
        while True:
            try:
                from core.escrow import release_due_payouts
                await release_due_payouts()
            except Exception as e:  # pragma: no cover
                logger.warning("escrow sweep tick failed: %s", e)
            await asyncio.sleep(_ESCROW_SWEEP_INTERVAL_SECONDS)

    # Fire-and-forget the loop task. The event loop keeps it alive for
    # the process's lifetime; the shutdown handler cancels it.
    app.state.escrow_task = asyncio.create_task(_loop())




@app.on_event("shutdown")
async def shutdown_db_client() -> None:
    close_db()

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
  • payments     — Stripe Checkout + webhook + status polling
  • seller       — analytics + mocked Stripe Connect onboarding
  • collections  — designer drops (collections)
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from core.db import close_db
from routers import (
    admin,
    auth,
    collections,
    items,
    orders,
    payments,
    profile,
    seller,
    tryon,
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
    return {"app": "AuraFit", "status": "ok"}


# Order doesn't matter for routing (paths are disjoint) but the order below
# determines OpenAPI tag ordering and is grouped by concern.
api_router.include_router(auth.router)
api_router.include_router(profile.router)
api_router.include_router(items.router)
api_router.include_router(wishlist.router)
api_router.include_router(tryon.router)
api_router.include_router(orders.router)
api_router.include_router(payments.router)
api_router.include_router(seller.router)
api_router.include_router(collections.router)
api_router.include_router(admin.router)

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client() -> None:
    close_db()

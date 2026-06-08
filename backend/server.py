"""AuraFit backend: virtual try-on clothing marketplace.

Auth (JWT email/password with buyer/seller roles), body profile (manual
measurements + AI estimate from photos using Gemini multimodal), clothing
items CRUD, Gemini Nano Banana try-on image generation, Stripe Checkout
purchases via emergentintegrations, plus a smart sizing engine
(per-seller fit feedback deltas), wishlist + restock detection, seller
analytics, and shareable watermarked try-on exports.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import textwrap
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
from emergentintegrations.payments.stripe.checkout import (
    CheckoutSessionRequest,
    StripeCheckout,
)
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# -------------------------------------------------------------------------
# Config
# -------------------------------------------------------------------------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRY_HOURS = int(os.environ.get("JWT_EXPIRY_HOURS", "168"))
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")

NANO_BANANA_MODEL = "gemini-3.1-flash-image-preview"
VISION_MODEL = "gemini-2.5-flash"
PLATFORM_FEE_BPS = 800  # 8% take rate
CONNECT_MOCKED_NOTE = (
    "Demo onboarding — replace `STRIPE_API_KEY` with a real Stripe test key "
    "to enable real Stripe Connect Express accounts and live payouts."
)

# -------------------------------------------------------------------------
# DB
# -------------------------------------------------------------------------
mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client[DB_NAME]

# -------------------------------------------------------------------------
# App
# -------------------------------------------------------------------------
app = FastAPI(title="AuraFit API")
api_router = APIRouter(prefix="/api")
auth_scheme = HTTPBearer(auto_error=False)
logger = logging.getLogger("aurafit")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# -------------------------------------------------------------------------
# Models
# -------------------------------------------------------------------------
Role = Literal["buyer", "seller"]
Gender = Literal["male", "female", "other", "prefer_not_to_say"]
Audience = Literal["men", "women", "unisex"]
FitFeedback = Literal["small", "perfect", "large"]
# Supported listing/display currencies. KES = Kenyan Shilling (default for new accounts).
Currency = Literal[
    "USD", "KES", "EUR", "GBP", "NGN", "ZAR", "INR", "UGX", "TZS", "RWF", "GHS", "EGP"
]
DEFAULT_CURRENCY: str = "KES"
# Try-on viewing angles. Front is the only required one (uses uploaded body photo).
TryOnAngle = Literal["front", "three_quarter", "side", "back"]
MAX_TRYON_ANGLES = 4


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    full_name: str = Field(min_length=1)
    role: Role
    gender: Gender
    age: Optional[int] = Field(default=None, ge=13, le=120)
    dob: Optional[str] = None  # ISO date "YYYY-MM-DD"; if set, server derives age
    preferred_currency: Optional[Currency] = None  # defaults to DEFAULT_CURRENCY


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class PreferencesIn(BaseModel):
    preferred_currency: Optional[Currency] = None


class UserOut(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    role: Role
    gender: Optional[Gender] = None
    age: Optional[int] = None
    dob: Optional[str] = None
    stripe_account_id: Optional[str] = None
    connect_status: Literal["unstarted", "pending", "active"] = "unstarted"
    preferred_currency: Currency = DEFAULT_CURRENCY  # type: ignore[assignment]
    created_at: datetime


class AuthOut(BaseModel):
    token: str
    user: UserOut


class Measurements(BaseModel):
    height_cm: Optional[float] = None
    chest_cm: Optional[float] = None
    waist_cm: Optional[float] = None
    hips_cm: Optional[float] = None
    shoulders_cm: Optional[float] = None
    inseam_cm: Optional[float] = None


class ProfileIn(BaseModel):
    measurements: Measurements
    preferred_size: Optional[str] = None  # XS, S, M, L, XL, XXL
    front_photo_b64: Optional[str] = None  # base64 (no data: prefix)
    side_photo_b64: Optional[str] = None


class ProfileOut(BaseModel):
    user_id: str
    measurements: Measurements
    preferred_size: Optional[str] = None
    has_front_photo: bool = False
    has_side_photo: bool = False
    updated_at: datetime


class EstimateMeasurementsIn(BaseModel):
    front_photo_b64: str
    side_photo_b64: str
    height_cm: Optional[float] = None  # optional reference height


class SizeOption(BaseModel):
    label: str  # "S", "M", "L" ...
    chest_cm: Optional[float] = None
    waist_cm: Optional[float] = None
    hips_cm: Optional[float] = None
    length_cm: Optional[float] = None
    available_qty: int = 0


class ColorOption(BaseModel):
    name: str
    hex: str  # "#000000"


class ItemIn(BaseModel):
    name: str
    description: str = ""
    category: Literal["shirts", "dresses", "pants", "outerwear", "shoes", "accessories"]
    price_cents: int = Field(ge=0)
    currency: Currency = DEFAULT_CURRENCY  # type: ignore[assignment]
    image_b64: str  # primary garment image
    sizes: List[SizeOption]
    colors: List[ColorOption] = []
    audience: Audience = "unisex"


class ItemOut(BaseModel):
    id: str
    seller_id: str
    seller_name: str
    name: str
    description: str
    category: str
    price_cents: int
    currency: Currency = "USD"  # listing currency
    image_b64: str
    sizes: List[SizeOption]
    colors: List[ColorOption]
    audience: Audience = "unisex"
    created_at: datetime


class TryOnIn(BaseModel):
    item_id: str
    use_profile_photo: bool = True  # use stored front photo
    body_photo_b64: Optional[str] = None  # override if provided
    # Angles to render. Default keeps existing single-angle behavior.
    angles: List[TryOnAngle] = Field(default_factory=lambda: ["front"])


class TryOnImage(BaseModel):
    angle: TryOnAngle
    image_b64: str


class TryOnOut(BaseModel):
    id: str
    item_id: str
    # Backward-compat: first angle's image (always "front" when present, else first).
    result_image_b64: str
    # New: every generated angle.
    images: List[TryOnImage] = Field(default_factory=list)
    fit_summary: Optional[str] = None
    created_at: datetime


class CheckoutIn(BaseModel):
    item_id: str
    size: str
    color: Optional[str] = None
    origin_url: str  # frontend base url (EXPO_PUBLIC_BACKEND_URL) for redirect targets


class CheckoutOut(BaseModel):
    session_id: str
    url: str


class OrderOut(BaseModel):
    id: str
    buyer_id: str
    item_id: str
    item_name: str
    size: str
    color: Optional[str]
    amount_cents: int
    currency: Currency = "USD"
    status: str  # pending / paid / failed / cancelled
    fit_feedback: Optional[FitFeedback] = None
    session_id: str
    created_at: datetime


class FitFeedbackIn(BaseModel):
    fit: FitFeedback


class WishlistOut(BaseModel):
    item: ItemOut
    added_at: datetime
    restocked: bool = False


class ItemPatchIn(BaseModel):
    sizes: Optional[List[SizeOption]] = None


class ItemAnalytics(BaseModel):
    item_id: str
    name: str
    views: int = 0
    try_ons: int = 0
    wishlists: int = 0
    orders_paid: int = 0
    revenue_cents: int = 0
    platform_fee_cents: int = 0
    net_cents: int = 0
    conversion: float = 0.0  # orders_paid / max(views, 1)


class SellerAnalyticsOut(BaseModel):
    total_views: int
    total_try_ons: int
    total_wishlists: int
    total_orders_paid: int
    total_revenue_cents: int
    total_platform_fee_cents: int = 0
    total_net_cents: int = 0
    connect_status: Literal["unstarted", "pending", "active"] = "unstarted"
    platform_fee_bps: int = PLATFORM_FEE_BPS
    items: List[ItemAnalytics]


class ConnectStatusOut(BaseModel):
    stripe_account_id: Optional[str] = None
    connect_status: Literal["unstarted", "pending", "active"]
    onboarding_url: Optional[str] = None
    platform_fee_bps: int = PLATFORM_FEE_BPS
    note: Optional[str] = None


class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    item_ids: List[str] = []


class CollectionOut(BaseModel):
    id: str
    seller_id: str
    seller_name: str
    name: str
    description: str
    item_ids: List[str]
    cover_image_b64: Optional[str] = None
    created_at: datetime


class TryOnShareOut(BaseModel):
    image_b64: str  # watermarked JPEG (no data: prefix)
    caption: str


# -------------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def make_jwt(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
) -> Dict[str, Any]:
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = payload.get("sub")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "hashed_password": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def require_role(role: str, user: Dict[str, Any]) -> None:
    if user.get("role") != role:
        raise HTTPException(status_code=403, detail=f"Requires {role} role")


def user_to_out(doc: Dict[str, Any]) -> UserOut:
    return UserOut(
        id=doc["id"],
        email=doc["email"],
        full_name=doc["full_name"],
        role=doc["role"],
        gender=doc.get("gender"),
        age=doc.get("age"),
        dob=doc.get("dob"),
        stripe_account_id=doc.get("stripe_account_id"),
        connect_status=doc.get("connect_status", "unstarted"),
        preferred_currency=doc.get("preferred_currency", DEFAULT_CURRENCY),
        created_at=doc["created_at"],
    )


def item_to_out(doc: Dict[str, Any]) -> ItemOut:
    return ItemOut(
        id=doc["id"],
        seller_id=doc["seller_id"],
        seller_name=doc.get("seller_name", ""),
        name=doc["name"],
        description=doc.get("description", ""),
        category=doc["category"],
        price_cents=doc["price_cents"],
        currency=doc.get("currency", "USD"),
        image_b64=doc["image_b64"],
        sizes=[SizeOption(**s) for s in doc.get("sizes", [])],
        colors=[ColorOption(**c) for c in doc.get("colors", [])],
        audience=doc.get("audience", "unisex"),
        created_at=doc["created_at"],
    )


def _strip_data_prefix(b64: str) -> str:
    if b64.startswith("data:"):
        comma = b64.find(",")
        if comma != -1:
            return b64[comma + 1 :]
    return b64


# -------------------------------------------------------------------------
# Auth routes
# -------------------------------------------------------------------------
@api_router.get("/")
async def root() -> Dict[str, str]:
    return {"app": "AuraFit", "status": "ok"}


@api_router.post("/auth/register", response_model=AuthOut)
async def register(body: RegisterIn) -> AuthOut:
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Resolve age: prefer DOB if provided, otherwise use submitted age.
    resolved_age: Optional[int] = body.age
    dob_iso: Optional[str] = None
    if body.dob:
        try:
            dob_date = datetime.strptime(body.dob, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="dob must be YYYY-MM-DD")
        today = datetime.now(timezone.utc).date()
        years = today.year - dob_date.year - (
            (today.month, today.day) < (dob_date.month, dob_date.day)
        )
        if years < 13:
            raise HTTPException(status_code=400, detail="You must be at least 13 years old")
        if years > 120:
            raise HTTPException(status_code=400, detail="Please enter a valid date of birth")
        resolved_age = years
        dob_iso = body.dob
    if resolved_age is None:
        raise HTTPException(status_code=400, detail="age or dob is required")

    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc = {
        "id": user_id,
        "email": body.email.lower(),
        "full_name": body.full_name.strip(),
        "role": body.role,
        "gender": body.gender,
        "age": resolved_age,
        "dob": dob_iso,
        "preferred_currency": body.preferred_currency or DEFAULT_CURRENCY,
        "hashed_password": hash_password(body.password),
        "created_at": now,
    }
    await db.users.insert_one(doc)
    token = make_jwt(user_id, body.role)
    return AuthOut(token=token, user=user_to_out(doc))


@api_router.post("/auth/login", response_model=AuthOut)
async def login(body: LoginIn) -> AuthOut:
    doc = await db.users.find_one({"email": body.email.lower()})
    if not doc or not verify_password(body.password, doc["hashed_password"]):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    token = make_jwt(doc["id"], doc["role"])
    return AuthOut(token=token, user=user_to_out(doc))


@api_router.get("/auth/me", response_model=UserOut)
async def me(user: Dict[str, Any] = Depends(get_current_user)) -> UserOut:
    return user_to_out(user)


@api_router.patch("/auth/preferences", response_model=UserOut)
async def update_preferences(
    body: PreferencesIn, user: Dict[str, Any] = Depends(get_current_user)
) -> UserOut:
    """Update user-level preferences (currency, etc.). Currently only currency."""
    update: Dict[str, Any] = {}
    if body.preferred_currency:
        update["preferred_currency"] = body.preferred_currency
    if not update:
        raise HTTPException(status_code=400, detail="No preferences provided")
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    fresh = await db.users.find_one(
        {"id": user["id"]}, {"_id": 0, "hashed_password": 0}
    )
    return user_to_out(fresh)


# -------------------------------------------------------------------------
# Profile routes
# -------------------------------------------------------------------------
@api_router.get("/profile", response_model=ProfileOut)
async def get_profile(user: Dict[str, Any] = Depends(get_current_user)) -> ProfileOut:
    doc = await db.profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    if not doc:
        return ProfileOut(
            user_id=user["id"],
            measurements=Measurements(),
            preferred_size=None,
            has_front_photo=False,
            has_side_photo=False,
            updated_at=datetime.now(timezone.utc),
        )
    return ProfileOut(
        user_id=doc["user_id"],
        measurements=Measurements(**doc.get("measurements", {})),
        preferred_size=doc.get("preferred_size"),
        has_front_photo=bool(doc.get("front_photo_b64")),
        has_side_photo=bool(doc.get("side_photo_b64")),
        updated_at=doc["updated_at"],
    )


@api_router.put("/profile", response_model=ProfileOut)
async def upsert_profile(
    body: ProfileIn, user: Dict[str, Any] = Depends(get_current_user)
) -> ProfileOut:
    now = datetime.now(timezone.utc)
    update = {
        "user_id": user["id"],
        "measurements": body.measurements.model_dump(),
        "preferred_size": body.preferred_size,
        "updated_at": now,
    }
    if body.front_photo_b64:
        update["front_photo_b64"] = _strip_data_prefix(body.front_photo_b64)
    if body.side_photo_b64:
        update["side_photo_b64"] = _strip_data_prefix(body.side_photo_b64)
    await db.profiles.update_one(
        {"user_id": user["id"]}, {"$set": update}, upsert=True
    )
    doc = await db.profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    return ProfileOut(
        user_id=doc["user_id"],
        measurements=Measurements(**doc.get("measurements", {})),
        preferred_size=doc.get("preferred_size"),
        has_front_photo=bool(doc.get("front_photo_b64")),
        has_side_photo=bool(doc.get("side_photo_b64")),
        updated_at=doc["updated_at"],
    )


@api_router.post("/profile/estimate", response_model=Measurements)
async def estimate_measurements(
    body: EstimateMeasurementsIn, user: Dict[str, Any] = Depends(get_current_user)
) -> Measurements:
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")
    front_b64 = _strip_data_prefix(body.front_photo_b64)
    side_b64 = _strip_data_prefix(body.side_photo_b64)
    system_msg = (
        "You are a professional fit specialist. Estimate body measurements in centimeters "
        "from two photos (front and side view). Respond ONLY with valid JSON of the form "
        '{"height_cm": number, "chest_cm": number, "waist_cm": number, "hips_cm": number, '
        '"shoulders_cm": number, "inseam_cm": number}. Provide best reasonable estimates.'
    )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"measure-{user['id']}-{uuid.uuid4()}",
        system_message=system_msg,
    ).with_model("gemini", VISION_MODEL)

    user_text = "Front view and side view photos attached."
    if body.height_cm:
        user_text += f" The person is approximately {body.height_cm} cm tall (use this as a calibration anchor)."
    user_text += " Return strict JSON only, no commentary."

    msg = UserMessage(
        text=user_text,
        file_contents=[ImageContent(front_b64), ImageContent(side_b64)],
    )
    try:
        raw = await chat.send_message(msg)
    except Exception as e:
        logger.exception("Gemini measurement error")
        raise HTTPException(status_code=502, detail=f"AI estimation failed: {e}")

    import json
    import re

    text = raw.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # try to extract first JSON object
        match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
        if not match:
            raise HTTPException(status_code=502, detail="Could not parse AI response")
        parsed = json.loads(match.group(0))

    measurements = Measurements(
        height_cm=parsed.get("height_cm"),
        chest_cm=parsed.get("chest_cm"),
        waist_cm=parsed.get("waist_cm"),
        hips_cm=parsed.get("hips_cm"),
        shoulders_cm=parsed.get("shoulders_cm"),
        inseam_cm=parsed.get("inseam_cm"),
    )
    return measurements


# -------------------------------------------------------------------------
# Items routes
# -------------------------------------------------------------------------
@api_router.post("/items", response_model=ItemOut)
async def create_item(
    body: ItemIn, user: Dict[str, Any] = Depends(get_current_user)
) -> ItemOut:
    await require_role("seller", user)
    item_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    # If seller didn't pass an explicit currency, fall back to their preferred currency.
    listing_currency = body.currency or user.get("preferred_currency") or DEFAULT_CURRENCY
    doc = {
        "id": item_id,
        "seller_id": user["id"],
        "seller_name": user["full_name"],
        "name": body.name,
        "description": body.description,
        "category": body.category,
        "price_cents": body.price_cents,
        "currency": listing_currency,
        "image_b64": _strip_data_prefix(body.image_b64),
        "sizes": [s.model_dump() for s in body.sizes],
        "colors": [c.model_dump() for c in body.colors],
        "audience": body.audience,
        "created_at": now,
    }
    await db.items.insert_one(doc)
    return item_to_out(doc)


@api_router.get("/items", response_model=List[ItemOut])
async def list_items(
    category: Optional[str] = None,
    size: Optional[str] = None,
    color: Optional[str] = None,
    seller_id: Optional[str] = None,
    audience: Optional[str] = None,
    q: Optional[str] = None,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
) -> List[ItemOut]:
    query: Dict[str, Any] = {}
    if category:
        query["category"] = category
    if size:
        query["sizes.label"] = size
    if color:
        query["colors.name"] = color
    if seller_id:
        query["seller_id"] = seller_id
    if q:
        query["name"] = {"$regex": q, "$options": "i"}

    # Audience filtering — explicit param wins, otherwise infer from buyer gender.
    if audience and audience != "all":
        query["audience"] = audience
    elif not audience:
        # Try to derive default from logged-in buyer
        if creds and creds.credentials:
            try:
                payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
                u = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
                if u and u.get("role") == "buyer":
                    g = u.get("gender")
                    if g == "male":
                        query["audience"] = {"$in": ["men", "unisex"]}
                    elif g == "female":
                        query["audience"] = {"$in": ["women", "unisex"]}
                    # other / prefer_not_to_say → show everything (no filter)
            except jwt.PyJWTError:
                pass

    docs = await db.items.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [item_to_out(d) for d in docs]


@api_router.get("/items/mine", response_model=List[ItemOut])
async def my_items(user: Dict[str, Any] = Depends(get_current_user)) -> List[ItemOut]:
    docs = (
        await db.items.find({"seller_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(200)
    )
    return [item_to_out(d) for d in docs]


@api_router.get("/items/{item_id}", response_model=ItemOut)
async def get_item(
    item_id: str,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(auth_scheme),
) -> ItemOut:
    doc = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    # Increment view counter, but never count the seller's own visit.
    skip_count = False
    if creds and creds.credentials:
        try:
            payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            if payload.get("sub") == doc["seller_id"]:
                skip_count = True
        except jwt.PyJWTError:
            pass
    if not skip_count:
        await db.items.update_one({"id": item_id}, {"$inc": {"views": 1}})
    return item_to_out(doc)


@api_router.delete("/items/{item_id}")
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


@api_router.patch("/items/{item_id}", response_model=ItemOut)
async def patch_item(
    item_id: str,
    body: ItemPatchIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> ItemOut:
    doc = await db.items.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    if doc["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your item")
    if body.sizes is not None:
        await db.items.update_one(
            {"id": item_id},
            {"$set": {"sizes": [s.model_dump() for s in body.sizes]}},
        )
    fresh = await db.items.find_one({"id": item_id}, {"_id": 0})
    return item_to_out(fresh)


# -------------------------------------------------------------------------
# Wishlist
# -------------------------------------------------------------------------
def _total_qty(item: Dict[str, Any]) -> int:
    return sum(int(s.get("available_qty", 0)) for s in item.get("sizes", []))


@api_router.post("/wishlist/{item_id}")
async def add_wishlist(
    item_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, bool]:
    item = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    now = datetime.now(timezone.utc)
    await db.wishlists.update_one(
        {"user_id": user["id"], "item_id": item_id},
        {
            "$setOnInsert": {
                "user_id": user["id"],
                "item_id": item_id,
                "qty_at_add": _total_qty(item),
                "added_at": now,
            }
        },
        upsert=True,
    )
    return {"ok": True}


@api_router.delete("/wishlist/{item_id}")
async def remove_wishlist(
    item_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, bool]:
    await db.wishlists.delete_one({"user_id": user["id"], "item_id": item_id})
    return {"ok": True}


@api_router.get("/wishlist", response_model=List[WishlistOut])
async def list_wishlist(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[WishlistOut]:
    wishes = await db.wishlists.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("added_at", -1).to_list(200)
    item_ids = [w["item_id"] for w in wishes]
    items_cursor = db.items.find({"id": {"$in": item_ids}}, {"_id": 0})
    items_by_id: Dict[str, Dict[str, Any]] = {}
    async for it in items_cursor:
        items_by_id[it["id"]] = it
    out: List[WishlistOut] = []
    for w in wishes:
        it = items_by_id.get(w["item_id"])
        if not it:
            continue
        current_qty = _total_qty(it)
        restocked = (w.get("qty_at_add", 0) == 0) and current_qty > 0
        out.append(
            WishlistOut(
                item=item_to_out(it),
                added_at=w["added_at"],
                restocked=restocked,
            )
        )
    return out


@api_router.get("/wishlist/ids")
async def list_wishlist_ids(
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, List[str]]:
    docs = await db.wishlists.find(
        {"user_id": user["id"]}, {"_id": 0, "item_id": 1}
    ).to_list(500)
    return {"item_ids": [d["item_id"] for d in docs]}


# -------------------------------------------------------------------------
# Try-On routes
# -------------------------------------------------------------------------
import asyncio


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


async def _generate_single_angle(
    *,
    body_b64: str,
    garment_b64: str,
    item: Dict[str, Any],
    user: Dict[str, Any],
    angle: str,
    persona: str,
) -> Optional[str]:
    """Generate a single angle for the try-on. Returns base64 image or None on failure."""
    angle_hint = ANGLE_INSTRUCTIONS.get(angle, ANGLE_INSTRUCTIONS["front"])
    system_msg = (
        "You are a fashion virtual try-on generator. You will receive two images: "
        "(1) a person's full-body photo, and (2) a clothing item. Generate a realistic "
        "photo of the same person wearing the clothing item, preserving the person's "
        "identity (face, skin tone, hair) and body shape. Replace only the relevant "
        "clothing region. The output must be a single photorealistic image with a clean, "
        "neutral studio backdrop."
    )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"tryon-{user['id']}-{angle}-{uuid.uuid4()}",
        system_message=system_msg,
    ).with_model("gemini", NANO_BANANA_MODEL).with_params(modalities=["image", "text"])

    msg = UserMessage(
        text=(
            f"Generate a virtual try-on at the {angle.replace('_', ' ').upper()} angle. "
            f"{persona}"
            f"The person is wearing the garment '{item['name']}' "
            f"(category: {item['category']}, audience: {item.get('audience', 'unisex')}). "
            f"{angle_hint} "
            f"Maintain the same identity, skin tone, hair, and overall body proportions. "
            f"Photorealistic, full body, studio quality, fashion editorial."
        ),
        file_contents=[ImageContent(body_b64), ImageContent(garment_b64)],
    )
    try:
        _text, images = await chat.send_message_multimodal_response(msg)
    except Exception as e:
        logger.warning("Try-on angle %s failed: %s", angle, e)
        return None
    if not images:
        return None
    return images[0]["data"]


@api_router.post("/tryon", response_model=TryOnOut)
async def generate_tryon(
    body: TryOnIn, user: Dict[str, Any] = Depends(get_current_user)
) -> TryOnOut:
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")

    item = await db.items.find_one({"id": body.item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    body_b64: Optional[str] = None
    if body.body_photo_b64:
        body_b64 = _strip_data_prefix(body.body_photo_b64)
    elif body.use_profile_photo:
        profile = await db.profiles.find_one({"user_id": user["id"]}, {"_id": 0})
        if profile and profile.get("front_photo_b64"):
            body_b64 = profile["front_photo_b64"]
    if not body_b64:
        raise HTTPException(
            status_code=400,
            detail="No body photo. Provide body_photo_b64 or set a profile front photo.",
        )

    garment_b64 = item["image_b64"]

    # Personalize the prompt with user demographics for better try-on.
    gender = user.get("gender")
    age = user.get("age")
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


SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"]


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


@api_router.get("/tryon/history", response_model=List[TryOnOut])
async def tryon_history(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[TryOnOut]:
    docs = (
        await db.tryons.find({"user_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
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
                item_id=d["item_id"],
                result_image_b64=d.get("result_image_b64", imgs[0].image_b64 if imgs else ""),
                images=imgs,
                fit_summary=d.get("fit_summary"),
                created_at=d["created_at"],
            )
        )
    return out


# -------------------------------------------------------------------------
# Payments / Orders
# -------------------------------------------------------------------------
def _stripe_client(webhook_url: Optional[str] = None) -> StripeCheckout:
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    return StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)


@api_router.post("/payments/checkout", response_model=CheckoutOut)
async def create_checkout(
    body: CheckoutIn, user: Dict[str, Any] = Depends(get_current_user)
) -> CheckoutOut:
    await require_role("buyer", user)
    item = await db.items.find_one({"id": body.item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    amount_dollars = item["price_cents"] / 100.0
    # Use the item's listing currency for Stripe (defaults to USD for legacy items).
    listing_currency = (item.get("currency") or "USD").lower()
    origin = body.origin_url.rstrip("/")
    success_url = f"{origin}/checkout/result?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/checkout/result?session_id={{CHECKOUT_SESSION_ID}}&cancelled=1"

    stripe = _stripe_client()
    req = CheckoutSessionRequest(
        amount=amount_dollars,
        currency=listing_currency,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "buyer_id": user["id"],
            "item_id": item["id"],
            "size": body.size,
            "color": body.color or "",
            "currency": listing_currency,
        },
    )
    try:
        session = await stripe.create_checkout_session(req)
    except Exception as e:
        logger.exception("Stripe checkout error")
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")

    order_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    platform_fee_cents = (item["price_cents"] * PLATFORM_FEE_BPS) // 10000
    seller_net_cents = item["price_cents"] - platform_fee_cents
    await db.orders.insert_one(
        {
            "id": order_id,
            "buyer_id": user["id"],
            "seller_id": item["seller_id"],
            "item_id": item["id"],
            "item_name": item["name"],
            "size": body.size,
            "color": body.color,
            "amount_cents": item["price_cents"],
            "currency": item.get("currency", "USD"),
            "platform_fee_cents": platform_fee_cents,
            "seller_net_cents": seller_net_cents,
            "status": "pending",
            "session_id": session.session_id,
            "created_at": now,
        }
    )
    return CheckoutOut(session_id=session.session_id, url=session.url)


@api_router.get("/payments/status/{session_id}")
async def payment_status(
    session_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    order = await db.orders.find_one(
        {"session_id": session_id, "buyer_id": user["id"]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Refresh from Stripe if still pending
    if order["status"] == "pending":
        try:
            stripe = _stripe_client()
            s = await stripe.get_checkout_status(session_id)
            new_status = order["status"]
            if s.payment_status == "paid":
                new_status = "paid"
            elif s.status == "expired":
                new_status = "cancelled"
            if new_status != order["status"]:
                await db.orders.update_one(
                    {"session_id": session_id},
                    {"$set": {"status": new_status}},
                )
                order["status"] = new_status
        except Exception as e:
            logger.warning("Stripe status fetch failed: %s", e)

    return {
        "session_id": session_id,
        "status": order["status"],
        "item_name": order["item_name"],
        "amount_cents": order["amount_cents"],
        "currency": order.get("currency", "USD"),
    }


@api_router.get("/orders", response_model=List[OrderOut])
async def my_orders(user: Dict[str, Any] = Depends(get_current_user)) -> List[OrderOut]:
    docs = (
        await db.orders.find({"buyer_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(100)
    )
    return [
        OrderOut(
            id=d["id"],
            buyer_id=d["buyer_id"],
            item_id=d["item_id"],
            item_name=d["item_name"],
            size=d["size"],
            color=d.get("color"),
            amount_cents=d["amount_cents"],
            currency=d.get("currency", "USD"),
            status=d["status"],
            fit_feedback=d.get("fit_feedback"),
            session_id=d["session_id"],
            created_at=d["created_at"],
        )
        for d in docs
    ]


@api_router.post("/orders/{order_id}/feedback", response_model=OrderOut)
async def submit_fit_feedback(
    order_id: str,
    body: FitFeedbackIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> OrderOut:
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["buyer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your order")
    if order["status"] != "paid":
        raise HTTPException(status_code=400, detail="Only paid orders can receive fit feedback")
    await db.orders.update_one(
        {"id": order_id}, {"$set": {"fit_feedback": body.fit}}
    )
    fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return OrderOut(
        id=fresh["id"],
        buyer_id=fresh["buyer_id"],
        item_id=fresh["item_id"],
        item_name=fresh["item_name"],
        size=fresh["size"],
        color=fresh.get("color"),
        amount_cents=fresh["amount_cents"],
        currency=fresh.get("currency", "USD"),
        status=fresh["status"],
        fit_feedback=fresh.get("fit_feedback"),
        session_id=fresh["session_id"],
        created_at=fresh["created_at"],
    )


# -------------------------------------------------------------------------
# Seller Analytics
# -------------------------------------------------------------------------
@api_router.get("/seller/analytics", response_model=SellerAnalyticsOut)
async def seller_analytics(
    user: Dict[str, Any] = Depends(get_current_user),
) -> SellerAnalyticsOut:
    await require_role("seller", user)
    items = await db.items.find(
        {"seller_id": user["id"]}, {"_id": 0}
    ).to_list(500)
    out_items: List[ItemAnalytics] = []
    total_views = total_try_ons = total_wishlists = total_orders_paid = 0
    total_revenue = total_fee = total_net = 0
    for it in items:
        views = int(it.get("views", 0))
        tos = int(it.get("try_ons", 0))
        wishes = await db.wishlists.count_documents({"item_id": it["id"]})
        paid = 0
        revenue = fee = net = 0
        async for o in db.orders.find(
            {"item_id": it["id"], "status": "paid"},
            {"_id": 0, "amount_cents": 1, "platform_fee_cents": 1, "seller_net_cents": 1},
        ):
            paid += 1
            amt = int(o.get("amount_cents", 0))
            f = int(o.get("platform_fee_cents", (amt * PLATFORM_FEE_BPS) // 10000))
            n = int(o.get("seller_net_cents", amt - f))
            revenue += amt
            fee += f
            net += n
        conversion = (paid / views) if views > 0 else 0.0
        out_items.append(
            ItemAnalytics(
                item_id=it["id"],
                name=it["name"],
                views=views,
                try_ons=tos,
                wishlists=wishes,
                orders_paid=paid,
                revenue_cents=revenue,
                platform_fee_cents=fee,
                net_cents=net,
                conversion=round(conversion, 4),
            )
        )
        total_views += views
        total_try_ons += tos
        total_wishlists += wishes
        total_orders_paid += paid
        total_revenue += revenue
        total_fee += fee
        total_net += net
    out_items.sort(key=lambda x: (-x.revenue_cents, -x.views))
    return SellerAnalyticsOut(
        total_views=total_views,
        total_try_ons=total_try_ons,
        total_wishlists=total_wishlists,
        total_orders_paid=total_orders_paid,
        total_revenue_cents=total_revenue,
        total_platform_fee_cents=total_fee,
        total_net_cents=total_net,
        connect_status=user.get("connect_status", "unstarted"),
        platform_fee_bps=PLATFORM_FEE_BPS,
        items=out_items,
    )


# -------------------------------------------------------------------------
# Stripe Connect (MOCKED — sk_test_emergent is a proxy key, real Connect
# cannot be invoked. The flow mirrors the real UX so swapping in a real
# Stripe test key only requires replacing this single function body.)
# -------------------------------------------------------------------------
@api_router.post("/seller/connect/setup", response_model=ConnectStatusOut)
async def connect_setup(
    user: Dict[str, Any] = Depends(get_current_user),
) -> ConnectStatusOut:
    await require_role("seller", user)
    existing = user.get("stripe_account_id")
    if existing and user.get("connect_status") == "active":
        return ConnectStatusOut(
            stripe_account_id=existing,
            connect_status="active",
            note=CONNECT_MOCKED_NOTE,
        )
    # Mocked onboarding: synthesise an Express-account-style id and mark active.
    acct_id = f"acct_demo_{uuid.uuid4().hex[:14]}"
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"stripe_account_id": acct_id, "connect_status": "active"}},
    )
    return ConnectStatusOut(
        stripe_account_id=acct_id,
        connect_status="active",
        onboarding_url=None,
        note=CONNECT_MOCKED_NOTE,
    )


@api_router.get("/seller/connect/status", response_model=ConnectStatusOut)
async def connect_status(
    user: Dict[str, Any] = Depends(get_current_user),
) -> ConnectStatusOut:
    await require_role("seller", user)
    return ConnectStatusOut(
        stripe_account_id=user.get("stripe_account_id"),
        connect_status=user.get("connect_status", "unstarted"),
        onboarding_url=None,
        note=CONNECT_MOCKED_NOTE if user.get("connect_status") != "active" else None,
    )


@api_router.get("/feed", response_model=List[ItemOut])
async def items_feed(
    user: Dict[str, Any] = Depends(get_current_user),
    limit: int = 60,
) -> List[ItemOut]:
    """Personalized re-ranking of items for the current buyer.

    Score = audience_match + seller_affinity + category_affinity + freshness.
    """
    # Build affinity vectors from this buyer's history.
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

    tryons = db.tryons.find({"user_id": user["id"]}, {"_id": 0, "item_id": 1}).sort(
        "created_at", -1
    )
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


# -------------------------------------------------------------------------
# Collections (Designer drops)
# -------------------------------------------------------------------------
def _collection_to_out(doc: Dict[str, Any]) -> CollectionOut:
    return CollectionOut(
        id=doc["id"],
        seller_id=doc["seller_id"],
        seller_name=doc.get("seller_name", ""),
        name=doc["name"],
        description=doc.get("description", ""),
        item_ids=doc.get("item_ids", []),
        cover_image_b64=doc.get("cover_image_b64"),
        created_at=doc["created_at"],
    )


@api_router.post("/collections", response_model=CollectionOut)
async def create_collection(
    body: CollectionIn,
    user: Dict[str, Any] = Depends(get_current_user),
) -> CollectionOut:
    await require_role("seller", user)
    # Use first owned item as a cover if available.
    cover: Optional[str] = None
    if body.item_ids:
        first = await db.items.find_one(
            {"id": {"$in": body.item_ids}, "seller_id": user["id"]},
            {"_id": 0, "image_b64": 1},
        )
        if first:
            cover = first.get("image_b64")
    coll_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc = {
        "id": coll_id,
        "seller_id": user["id"],
        "seller_name": user["full_name"],
        "name": body.name.strip(),
        "description": body.description.strip(),
        "item_ids": [iid for iid in body.item_ids if iid],
        "cover_image_b64": cover,
        "created_at": now,
    }
    await db.collections.insert_one(doc)
    return _collection_to_out(doc)


@api_router.get("/collections", response_model=List[CollectionOut])
async def list_collections() -> List[CollectionOut]:
    """Public list of all collections (newest first)."""
    docs = (
        await db.collections.find({}, {"_id": 0}).sort("created_at", -1).to_list(80)
    )
    return [_collection_to_out(d) for d in docs]


@api_router.get("/collections/mine", response_model=List[CollectionOut])
async def my_collections(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[CollectionOut]:
    docs = (
        await db.collections.find({"seller_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(100)
    )
    return [_collection_to_out(d) for d in docs]


@api_router.get("/collections/{collection_id}")
async def get_collection(collection_id: str) -> Dict[str, Any]:
    doc = await db.collections.find_one({"id": collection_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Collection not found")
    items: List[Dict[str, Any]] = []
    if doc.get("item_ids"):
        async for it in db.items.find(
            {"id": {"$in": doc["item_ids"]}}, {"_id": 0}
        ):
            items.append(it)
    return {
        "collection": _collection_to_out(doc).model_dump(),
        "items": [item_to_out(it).model_dump() for it in items],
    }


@api_router.delete("/collections/{collection_id}")
async def delete_collection(
    collection_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, bool]:
    doc = await db.collections.find_one({"id": collection_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Collection not found")
    if doc["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Not your collection")
    await db.collections.delete_one({"id": collection_id})
    return {"ok": True}


# -------------------------------------------------------------------------
# Shareable Try-On (Square or Story formats)
# -------------------------------------------------------------------------
def _watermark_image(b64_in: str, seller_name: str, fmt: str = "square") -> str:
    raw = base64.b64decode(b64_in)
    img = Image.open(io.BytesIO(raw)).convert("RGB")

    if fmt == "story":
        # 9:16 canvas (1080x1920). Center the image, blurred backdrop, brand block.
        W, H = 1080, 1920
        # Blurred backdrop from the source image.
        from PIL import ImageFilter

        bg = img.copy().resize((W, H)).filter(ImageFilter.GaussianBlur(radius=40))
        bg = bg.point(lambda p: int(p * 0.55))  # darken
        canvas = bg

        # Foreground image fits inside a 920×1380 area at the top.
        fg_max_w, fg_max_h = 920, 1380
        w, h = img.size
        scale = min(fg_max_w / w, fg_max_h / h)
        new_w, new_h = int(w * scale), int(h * scale)
        fg = img.resize((new_w, new_h), Image.LANCZOS)
        fg_x = (W - new_w) // 2
        fg_y = 200
        canvas.paste(fg, (fg_x, fg_y))

        # Brand bar at bottom.
        draw = ImageDraw.Draw(canvas)
        try:
            font_big = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", 110
            )
            font_sm = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 50
            )
            font_xs = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 38
            )
        except Exception:
            font_big = font_sm = font_xs = ImageFont.load_default()
        draw.text((80, 1640), "AURAFIT", fill=(250, 250, 250), font=font_big)
        draw.text(
            (80, 1760),
            f"by {textwrap.shorten(seller_name, width=30, placeholder='…')}",
            fill=(220, 220, 220),
            font=font_sm,
        )
        draw.text(
            (80, 1830),
            "Try it on yourself · aurafit.app",
            fill=(180, 180, 180),
            font=font_xs,
        )
        out = canvas
    else:
        # Original "square-ish" band beneath the image.
        w, h = img.size
        band_height = max(64, int(h * 0.08))
        out = Image.new("RGB", (w, h + band_height), (10, 10, 10))
        out.paste(img, (0, 0))
        draw = ImageDraw.Draw(out)
        try:
            font_big = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
                int(band_height * 0.42),
            )
            font_sm = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                int(band_height * 0.28),
            )
        except Exception:
            font_big = ImageFont.load_default()
            font_sm = ImageFont.load_default()
        pad = int(band_height * 0.25)
        draw.text(
            (pad, h + int(band_height * 0.18)),
            "AURAFIT",
            fill=(250, 250, 250),
            font=font_big,
        )
        credit = textwrap.shorten(f"by {seller_name}", width=40, placeholder="…")
        bbox = draw.textbbox((0, 0), credit, font=font_sm)
        tw = bbox[2] - bbox[0]
        draw.text(
            (w - tw - pad, h + int(band_height * 0.38)),
            credit,
            fill=(200, 200, 200),
            font=font_sm,
        )

    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


@api_router.get("/tryon/{tryon_id}/share", response_model=TryOnShareOut)
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
        chosen_b64 = tryon.get("result_image_b64") or (angle_imgs[0]["image_b64"] if angle_imgs else None)
    if not chosen_b64:
        raise HTTPException(status_code=404, detail="No image to share")
    try:
        watermarked = _watermark_image(chosen_b64, seller_name, fmt=fmt)
    except Exception as e:
        logger.exception("Watermark error")
        raise HTTPException(status_code=500, detail=f"Share image failed: {e}")
    caption = f"Tried on {item_name} by {seller_name} with @AuraFit ✨"
    return TryOnShareOut(image_b64=watermarked, caption=caption)


@api_router.post("/payments/webhook")
async def stripe_webhook(request: Request) -> Dict[str, Any]:
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    try:
        stripe = _stripe_client(webhook_url=str(request.url))
        event = await stripe.handle_webhook(payload, sig)
    except Exception as e:
        logger.warning("Webhook error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))

    # Best-effort update
    try:
        event_dict = event.model_dump() if hasattr(event, "model_dump") else dict(event)
        session_id = (
            event_dict.get("session_id")
            or event_dict.get("data", {}).get("object", {}).get("id")
        )
        payment_status_val = event_dict.get("payment_status") or "paid"
        if session_id and payment_status_val == "paid":
            await db.orders.update_one(
                {"session_id": session_id}, {"$set": {"status": "paid"}}
            )
    except Exception as e:
        logger.warning("Webhook handling failed: %s", e)

    return {"received": True}


# -------------------------------------------------------------------------
# Wire up & middleware
# -------------------------------------------------------------------------
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
    mongo_client.close()

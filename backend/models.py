"""Pydantic schemas + DB→DTO mappers for the AuraFit backend.

Kept separate from routers so any module can `from models import ItemOut, ...`
without pulling in route logic.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field

from core.config import DEFAULT_CURRENCY, PLATFORM_FEE_BPS

# ---------------------------------------------------------------------------
# Literal types
# ---------------------------------------------------------------------------
Role = Literal["buyer", "seller"]
Gender = Literal["male", "female", "other", "prefer_not_to_say"]
Audience = Literal["men", "women", "unisex"]
FitFeedback = Literal["small", "perfect", "large"]
# Supported listing/display currencies. KES = Kenyan Shilling (default for new accounts).
Currency = Literal[
    "USD", "KES", "EUR", "GBP", "NGN", "ZAR", "INR", "UGX", "TZS", "RWF", "GHS", "EGP"
]
# Try-on viewing angles. Front is the only required one (uses uploaded body photo).
TryOnAngle = Literal["front", "three_quarter", "side", "back"]
ConnectStatus = Literal["unstarted", "pending", "active"]


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
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
    connect_status: ConnectStatus = "unstarted"
    preferred_currency: Currency = DEFAULT_CURRENCY  # type: ignore[assignment]
    created_at: datetime


class AuthOut(BaseModel):
    token: str
    user: UserOut


# ---------------------------------------------------------------------------
# Profile / measurements
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------
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
    # When omitted, server falls back to the seller's preferred_currency.
    currency: Optional[Currency] = None
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


class ItemPatchIn(BaseModel):
    sizes: Optional[List[SizeOption]] = None


# ---------------------------------------------------------------------------
# Try-On
# ---------------------------------------------------------------------------
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


class TryOnShareOut(BaseModel):
    image_b64: str  # watermarked JPEG (no data: prefix)
    caption: str


# ---------------------------------------------------------------------------
# Checkout / orders
# ---------------------------------------------------------------------------
class CheckoutIn(BaseModel):
    item_id: str
    size: str
    color: Optional[str] = None
    origin_url: str  # frontend base url for redirect targets


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


# ---------------------------------------------------------------------------
# Wishlist
# ---------------------------------------------------------------------------
class WishlistOut(BaseModel):
    item: ItemOut
    added_at: datetime
    restocked: bool = False


# ---------------------------------------------------------------------------
# Seller analytics + Connect (mocked)
# ---------------------------------------------------------------------------
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
    connect_status: ConnectStatus = "unstarted"
    platform_fee_bps: int = PLATFORM_FEE_BPS
    items: List[ItemAnalytics]


class ConnectStatusOut(BaseModel):
    stripe_account_id: Optional[str] = None
    connect_status: ConnectStatus
    onboarding_url: Optional[str] = None
    platform_fee_bps: int = PLATFORM_FEE_BPS
    note: Optional[str] = None


# ---------------------------------------------------------------------------
# Collections (designer drops)
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# DB document → DTO helpers (single source of truth for default handling)
# ---------------------------------------------------------------------------
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


def collection_to_out(doc: Dict[str, Any]) -> CollectionOut:
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


def total_qty(item: Dict[str, Any]) -> int:
    """Sum available_qty across all sizes of an item."""
    return sum(int(s.get("available_qty", 0)) for s in item.get("sizes", []))

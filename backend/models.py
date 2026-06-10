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
Role = Literal["buyer", "seller", "admin"]
Gender = Literal["male", "female", "other", "prefer_not_to_say"]
Audience = Literal["men", "women", "unisex", "kids"]
KidAgeGroup = Literal["0-2", "3-5", "6-9", "10-13", "14-17"]
ProfileAudience = Literal["adult", "kid"]
FitFeedback = Literal["small", "perfect", "large"]
# Supported listing/display currencies. KES = Kenyan Shilling (default for new accounts).
Currency = Literal[
    "USD", "KES", "EUR", "GBP", "NGN", "ZAR", "INR", "UGX", "TZS", "RWF", "GHS", "EGP"
]
# Try-on viewing angles. Front is the only required one (uses uploaded body photo).
TryOnAngle = Literal["front", "three_quarter", "side", "back"]
ConnectStatus = Literal["unstarted", "pending", "active"]

# Kid US-style size labels used when audience="kids". Sellers pick from this
# set (instead of XS-XXL) in the new-item form. Buyers can filter by age group
# (which maps to a subset of these sizes via KID_SIZE_SETS_BY_AGE_GROUP).
KID_SIZES: List[str] = [
    "NB", "3M", "6M", "12M", "18M", "24M",
    "2T", "3T", "4T",
    "5", "6", "7", "8", "10", "12", "14", "16",
]

KID_SIZE_SETS_BY_AGE_GROUP: Dict[str, List[str]] = {
    "0-2":  ["NB", "3M", "6M", "12M", "18M", "24M", "2T"],
    "3-5":  ["3T", "4T", "5"],
    "6-9":  ["6", "7", "8"],
    "10-13": ["10", "12"],
    "14-17": ["14", "16"],
}


# ---------------------------------------------------------------------------
# Garment taxonomy (used for outfit composition + layering rules)
# ---------------------------------------------------------------------------
# Names follow British/East-African convention where they differ from US:
#   • vest_under   = tank/undershirt worn UNDER a shirt (Kenyan "vest")
#   • waistcoat    = a US "vest" — sleeveless garment worn OVER a shirt
GarmentType = Literal[
    "vest_under",
    "shirt",
    "dress",
    "skirt",
    "trousers",
    "shorts",
    "belt",
    "tie",
    "scarf",
    "waistcoat",
    "outerwear",
    "socks",
    "shoes",
    "hat",
    "bag",
    "jewelry",
    "other",
]

# Lower numbers sit closer to the body; outerwear/shoes overlay everything else.
LAYER_ORDER: Dict[str, int] = {
    "vest_under": 10,
    "shirt": 20,
    "dress": 25,
    "skirt": 30,
    "trousers": 30,
    "shorts": 30,
    "belt": 40,
    "waistcoat": 45,
    "tie": 50,
    "scarf": 52,
    "outerwear": 55,
    "socks": 60,
    "shoes": 65,
    "hat": 70,
    "bag": 90,
    "jewelry": 92,
    "other": 100,
}


def infer_garment_type(item: Dict[str, Any]) -> str:
    """Best-effort classification when the seller didn't set `garment_type` explicitly.

    Falls back to a coarse `category`→type mapping. Sellers can always override
    via the explicit field in `ItemIn`. Keyword matches are ordered most-specific
    first so e.g. "Belted Trench Coat" classifies as outerwear, not as a belt.
    """
    explicit = item.get("garment_type")
    if explicit:
        return explicit
    name = (item.get("name") or "").lower()
    category = (item.get("category") or "").lower()
    # Outerwear keywords beat "belt" so "Belted Trench Coat" → outerwear.
    if (
        "blazer" in name
        or "jacket" in name
        or "trench" in name
        or "coat" in name
        or "parka" in name
        or "bomber" in name
    ):
        return "outerwear"
    if "waistcoat" in name:
        return "waistcoat"
    if "necktie" in name or "bow tie" in name or "bowtie" in name:
        return "tie"
    # "tie" by itself — only match when isolated to avoid false hits in "tied", "satie", etc.
    if name == "tie" or " tie" in f" {name} " or name.endswith(" tie"):
        return "tie"
    if "belt" in name:
        return "belt"
    if "sock" in name:
        return "socks"
    if "scarf" in name:
        return "scarf"
    if "vest" in name or "tank" in name or "undershirt" in name or "singlet" in name:
        return "vest_under"
    if "shorts" in name or "bermuda" in name:
        return "shorts"
    if "skirt" in name:
        return "skirt"
    if "hat" in name or "cap" in name or "beanie" in name or "fedora" in name:
        return "hat"
    # Category fallback
    if category == "shirts":
        return "shirt"
    if category == "dresses":
        return "dress"
    if category == "pants":
        return "trousers"
    if category == "outerwear":
        return "outerwear"
    if category == "shoes":
        return "shoes"
    return "other"


def garment_type_label(gtype: str) -> str:
    """Human-friendly label used in AI prompts and UI."""
    return {
        "vest_under": "undershirt (vest, worn next to skin)",
        "shirt": "shirt",
        "dress": "dress",
        "skirt": "skirt",
        "trousers": "trousers",
        "shorts": "shorts",
        "belt": "belt",
        "waistcoat": "waistcoat (worn over the shirt)",
        "tie": "necktie",
        "scarf": "scarf",
        "outerwear": "jacket / outerwear",
        "socks": "socks",
        "shoes": "shoes",
        "hat": "hat",
        "bag": "bag",
        "jewelry": "jewellery",
        "other": "garment",
    }.get(gtype, gtype)


# ---------------------------------------------------------------------------
# Seller-specific structures (company info + payout details)
# ---------------------------------------------------------------------------
class Location(BaseModel):
    city: str = Field(min_length=1, max_length=80)
    country: str = Field(min_length=1, max_length=80)


class BankDetails(BaseModel):
    """Where the seller's payouts are sent. Either bank or M-Pesa is required
    when the seller is onboarding for payouts — we don't enforce here at the
    model layer; the registration handler validates it."""
    bank_name: Optional[str] = Field(default=None, max_length=80)
    branch: Optional[str] = Field(default=None, max_length=80)
    account_name: Optional[str] = Field(default=None, max_length=120)
    account_number: Optional[str] = Field(default=None, max_length=40)
    swift_code: Optional[str] = Field(default=None, max_length=20)
    # Kenyan mobile money — optional; some merchants only use M-Pesa.
    mpesa_paybill: Optional[str] = Field(default=None, max_length=20)
    mpesa_till: Optional[str] = Field(default=None, max_length=20)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    full_name: str = Field(min_length=1)
    role: Role
    # Buyer-only personal demographics (sellers leave blank)
    gender: Optional[Gender] = None
    age: Optional[int] = Field(default=None, ge=13, le=120)
    dob: Optional[str] = None  # ISO date "YYYY-MM-DD"; if set, server derives age
    preferred_currency: Optional[Currency] = None
    # Seller-only fields (buyers leave blank)
    company_name: Optional[str] = Field(default=None, max_length=120)
    location: Optional[Location] = None
    bank_details: Optional[BankDetails] = None


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
    # Seller-only (always present in response shape, null for buyers/admins)
    company_name: Optional[str] = None
    location: Optional[Location] = None
    bank_details: Optional[BankDetails] = None
    suspended: bool = False
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
    three_quarter_photo_b64: Optional[str] = None


class ProfileOut(BaseModel):
    user_id: str
    measurements: Measurements
    preferred_size: Optional[str] = None
    has_front_photo: bool = False
    has_side_photo: bool = False
    has_three_quarter_photo: bool = False
    updated_at: datetime


class EstimateMeasurementsIn(BaseModel):
    # All photos optional individually but caller must supply at least one.
    front_photo_b64: Optional[str] = None
    side_photo_b64: Optional[str] = None
    three_quarter_photo_b64: Optional[str] = None
    height_cm: Optional[float] = None  # optional reference height (recommended)


# ---------------------------------------------------------------------------
# Loved-one body profiles (shop on behalf of family/gift recipients)
# ---------------------------------------------------------------------------
class LovedOneIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    audience: ProfileAudience
    gender: Optional[Gender] = None
    age: Optional[int] = Field(default=None, ge=0, le=99)  # required for kids client-side
    relation: Optional[str] = Field(default=None, max_length=40)  # "son", "partner", "friend"
    measurements: Optional[Measurements] = None
    preferred_size: Optional[str] = None
    front_photo_b64: Optional[str] = None
    side_photo_b64: Optional[str] = None


class LovedOnePatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    audience: Optional[ProfileAudience] = None
    gender: Optional[Gender] = None
    age: Optional[int] = Field(default=None, ge=0, le=99)
    relation: Optional[str] = Field(default=None, max_length=40)
    measurements: Optional[Measurements] = None
    preferred_size: Optional[str] = None
    front_photo_b64: Optional[str] = None
    side_photo_b64: Optional[str] = None


class LovedOneOut(BaseModel):
    id: str
    user_id: str
    name: str
    audience: ProfileAudience
    gender: Optional[Gender] = None
    age: Optional[int] = None
    relation: Optional[str] = None
    measurements: Measurements
    preferred_size: Optional[str] = None
    has_front_photo: bool = False
    has_side_photo: bool = False
    created_at: datetime
    updated_at: datetime


class ProfileSummary(BaseModel):
    """Either the buyer's own 'self' profile or a loved-one profile, used in
    the unified profile switcher."""

    id: str  # "self" for the user's own profile, UUID for loved ones
    is_self: bool
    name: str  # "Me", "<LovedOne name>"
    audience: ProfileAudience
    gender: Optional[Gender] = None
    age: Optional[int] = None
    has_front_photo: bool = False
    has_side_photo: bool = False
    preferred_size: Optional[str] = None


class ActiveProfileIn(BaseModel):
    profile_id: str  # "self" or a LovedOne uuid


class ActiveProfileOut(BaseModel):
    profile_id: str  # "self" or a LovedOne uuid
    profile: ProfileSummary


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
    # When omitted, server infers from category + name keywords.
    garment_type: Optional[GarmentType] = None
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
    garment_type: GarmentType = "other"  # layered try-on classification
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
    # Optional: switch to a loved-one profile's photos instead of the user's own.
    # "self" or null → use the buyer's main profile. UUID → use that loved one.
    profile_id: Optional[str] = None
    # Angles to render. Default keeps existing single-angle behavior.
    angles: List[TryOnAngle] = Field(default_factory=lambda: ["front"])


class OutfitTryOnIn(BaseModel):
    """Compose multiple garments onto the user, respecting layering rules."""
    item_ids: List[str] = Field(min_length=1, max_length=8)
    use_profile_photo: bool = True
    body_photo_b64: Optional[str] = None
    profile_id: Optional[str] = None
    angles: List[TryOnAngle] = Field(default_factory=lambda: ["front"])


class GarmentTryOnIn(BaseModel):
    """BYO Garment: buyer uploads a clothing photo and tries it on themselves
    or a loved one. No item/seller involved — purely a Try-On preview."""

    garment_b64: str  # base64 of the garment to render
    garment_type: Optional[GarmentType] = "other"
    use_profile_photo: bool = True
    body_photo_b64: Optional[str] = None
    profile_id: Optional[str] = None
    angles: List[TryOnAngle] = Field(default_factory=lambda: ["front"])
    # Optional human label saved into history for the buyer ("Blue Aloha shirt")
    label: Optional[str] = Field(default=None, max_length=60)


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


class OrderSellerOut(BaseModel):
    """Lightweight seller card for the order detail screen."""

    id: str
    full_name: str
    company_name: Optional[str] = None
    location: Optional[Location] = None
    payout_summary: Optional[str] = None  # masked bank/M-Pesa summary


class OrderDetailOut(OrderOut):
    seller_id: str
    platform_fee_cents: int = 0
    seller_net_cents: int = 0
    item_image_b64: Optional[str] = None
    item_garment_type: Optional[str] = None
    fit_feedback_comment: Optional[str] = None
    seller: Optional[OrderSellerOut] = None


class FitFeedbackIn(BaseModel):
    fit: FitFeedback
    comment: Optional[str] = Field(default=None, max_length=600)


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


class PayoutDetailsIn(BaseModel):
    bank_name: Optional[str] = Field(default=None, max_length=80)
    branch: Optional[str] = Field(default=None, max_length=80)
    account_name: Optional[str] = Field(default=None, max_length=120)
    account_number: Optional[str] = Field(default=None, max_length=40)
    swift_code: Optional[str] = Field(default=None, max_length=20)
    mpesa_paybill: Optional[str] = Field(default=None, max_length=20)
    mpesa_till: Optional[str] = Field(default=None, max_length=20)


class SellerCompanyIn(BaseModel):
    company_name: Optional[str] = Field(default=None, max_length=120)
    location: Optional[Location] = None


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
    raw_loc = doc.get("location")
    raw_bank = doc.get("bank_details")
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
        company_name=doc.get("company_name"),
        location=Location(**raw_loc) if raw_loc else None,
        bank_details=BankDetails(**raw_bank) if raw_bank else None,
        suspended=bool(doc.get("suspended", False)),
        created_at=doc["created_at"],
    )


def item_to_out(doc: Dict[str, Any]) -> ItemOut:
    gtype = doc.get("garment_type") or infer_garment_type(doc)
    return ItemOut(
        id=doc["id"],
        seller_id=doc["seller_id"],
        seller_name=doc.get("seller_name", ""),
        name=doc["name"],
        description=doc.get("description", ""),
        category=doc["category"],
        price_cents=doc["price_cents"],
        currency=doc.get("currency", "USD"),
        garment_type=gtype,
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

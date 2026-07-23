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
# Fulfillment state machine for orders. `paid` is the initial state right
# after Paystack checkout completes; `in_fulfillment` is set when the seller
# acknowledges. `shipped` requires a tracking number/URL. `delivered` is
# the terminal state.
OrderStatus = Literal[
    "pending", "paid", "failed", "cancelled",
    "in_fulfillment", "shipped", "delivered",
]
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
    # Paystack bank/mobile-money code captured from the picker. Enables the
    # payout-account screen to resolve the actual account owner via
    # `POST /api/seller/payout-account` without asking the seller to
    # re-type the bank name.
    bank_code: Optional[str] = Field(default=None, max_length=20)
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
    # When provided and != current role, server flips the user to that role
    # before returning the token (only buyer ↔ seller — admins cannot toggle).
    # If the destination role lacks required data (e.g. seller without
    # company_name), the response carries `needs_seller_onboarding=True` so
    # the client can route to the 1-screen onboarding form.
    as_role: Optional[Literal["buyer", "seller"]] = None


class ForgotPasswordIn(BaseModel):
    """Request-body for POST /auth/forgot-password."""
    email: EmailStr


class ResetPasswordIn(BaseModel):
    """Request-body for POST /auth/reset-password."""
    token: str = Field(min_length=8)
    new_password: str = Field(min_length=6)




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
    connect_status: ConnectStatus = "unstarted"
    preferred_currency: Currency = DEFAULT_CURRENCY  # type: ignore[assignment]
    # Seller-only (always present in response shape, null for buyers/admins)
    company_name: Optional[str] = None
    location: Optional[Location] = None
    bank_details: Optional[BankDetails] = None
    suspended: bool = False
    # Trust signal shown next to seller names once they cross the paid-
    # order threshold. Auto-granted; the platform never awards this
    # manually. See `maybe_verify_seller()` in core/seller.py.
    verified_seller: bool = False
    verified_orders_count: int = 0
    # Subscription state — updated by Paystack webhooks. Free is the
    # default for every user.
    subscription_tier: Literal["free", "premium"] = "free"
    subscription_status: Optional[str] = None  # trialing / active / past_due / canceled / etc
    current_period_end: Optional[datetime] = None
    trial_end: Optional[datetime] = None
    cancel_at_period_end: bool = False
    # Token-versioning support — every increment invalidates outstanding JWTs
    # (security middleware compares this against the JWT's `tv` claim).
    token_version: int = 0
    created_at: datetime


class AuthOut(BaseModel):
    token: str
    user: UserOut
    # True iff `as_role=seller` but the account is missing required seller
    # fields. The client is expected to detour through /seller/onboarding.
    needs_seller_onboarding: bool = False


class ToggleRoleIn(BaseModel):
    """Body for POST /user/toggle-role. When `to` is omitted, the server
    flips the user between buyer and seller (admins are rejected). When `to`
    is provided, the server moves to that explicit role (so the client can
    request a re-authentication after onboarding without depending on
    current state)."""

    to: Optional[Literal["buyer", "seller"]] = None
    # When the target is seller and the account has no seller details yet
    # the client passes them here so we can atomically complete onboarding
    # and toggle. The endpoint validates the same way `register` does.
    company_name: Optional[str] = Field(default=None, max_length=120)
    location: Optional[Location] = None
    bank_details: Optional[BankDetails] = None


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
    preferred_shoe_size: Optional[str] = None  # EU numeric, e.g. "40"
    front_photo_b64: Optional[str] = None  # base64 (no data: prefix)
    side_photo_b64: Optional[str] = None
    three_quarter_photo_b64: Optional[str] = None


class ProfileOut(BaseModel):
    user_id: str
    measurements: Measurements
    preferred_size: Optional[str] = None
    preferred_shoe_size: Optional[str] = None
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
    preferred_shoe_size: Optional[str] = None
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
    preferred_shoe_size: Optional[str] = None
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
    preferred_shoe_size: Optional[str] = None
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
    preferred_shoe_size: Optional[str] = None


class ActiveProfileIn(BaseModel):
    profile_id: str  # "self" or a LovedOne uuid


class ActiveProfileOut(BaseModel):
    profile_id: str  # "self" or a LovedOne uuid
    profile: ProfileSummary


# ---------------------------------------------------------------------------
# Delivery addresses (multi-address book per buyer)
# ---------------------------------------------------------------------------
AddressLabel = Literal["home", "office", "parents", "other"]


class AddressIn(BaseModel):
    label: AddressLabel = "home"
    custom_label: Optional[str] = Field(default=None, max_length=40)  # used when label="other"
    recipient_name: str = Field(min_length=1, max_length=80)
    phone: str = Field(min_length=4, max_length=24)
    alt_phone: Optional[str] = Field(default=None, max_length=24)  # landline or home number
    building_estate: Optional[str] = Field(default=None, max_length=80)
    house_number: Optional[str] = Field(default=None, max_length=24)
    street: Optional[str] = Field(default=None, max_length=120)
    area: Optional[str] = Field(default=None, max_length=80)
    city: str = Field(min_length=1, max_length=60)
    postal_code: Optional[str] = Field(default=None, max_length=20)
    country: str = Field(min_length=2, max_length=60)
    delivery_notes: Optional[str] = Field(default=None, max_length=400)
    is_default: bool = False


class AddressPatch(BaseModel):
    label: Optional[AddressLabel] = None
    custom_label: Optional[str] = Field(default=None, max_length=40)
    recipient_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    phone: Optional[str] = Field(default=None, min_length=4, max_length=24)
    alt_phone: Optional[str] = Field(default=None, max_length=24)
    building_estate: Optional[str] = Field(default=None, max_length=80)
    house_number: Optional[str] = Field(default=None, max_length=24)
    street: Optional[str] = Field(default=None, max_length=120)
    area: Optional[str] = Field(default=None, max_length=80)
    city: Optional[str] = Field(default=None, min_length=1, max_length=60)
    postal_code: Optional[str] = Field(default=None, max_length=20)
    country: Optional[str] = Field(default=None, min_length=2, max_length=60)
    delivery_notes: Optional[str] = Field(default=None, max_length=400)
    is_default: Optional[bool] = None


class AddressOut(BaseModel):
    id: str
    user_id: str
    label: AddressLabel
    custom_label: Optional[str] = None
    recipient_name: str
    phone: str
    alt_phone: Optional[str] = None
    building_estate: Optional[str] = None
    house_number: Optional[str] = None
    street: Optional[str] = None
    area: Optional[str] = None
    city: str
    postal_code: Optional[str] = None
    country: str
    delivery_notes: Optional[str] = None
    is_default: bool = False
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------
class SizeOption(BaseModel):
    label: str  # "S", "M", "L" ...
    # --- Tops / jackets / outerwear / sweaters ---
    chest_cm: Optional[float] = None
    shoulder_cm: Optional[float] = None
    sleeve_cm: Optional[float] = None
    length_cm: Optional[float] = None
    # --- Bottoms (trousers / shorts / skirts) ---
    waist_cm: Optional[float] = None
    hips_cm: Optional[float] = None
    inseam_cm: Optional[float] = None
    rise_cm: Optional[float] = None
    # --- Dresses ---
    bust_cm: Optional[float] = None
    # --- Inventory ---
    available_qty: int = 0


# Which physical measurements are meaningful for each garment_type. Used by
# the seller upload form (decides which fields to render), the size-guide
# sheet, and the Fit Match Score algorithm in iteration 12.
DIMENSION_KEYS_BY_TYPE: Dict[str, List[str]] = {
    # Tops & layering
    "shirt": ["chest_cm", "shoulder_cm", "sleeve_cm", "length_cm"],
    "vest_under": ["chest_cm", "shoulder_cm", "length_cm"],
    "waistcoat": ["chest_cm", "shoulder_cm", "length_cm"],
    "outerwear": ["chest_cm", "shoulder_cm", "sleeve_cm", "length_cm"],
    # Dresses
    "dress": ["bust_cm", "waist_cm", "hips_cm", "length_cm"],
    "skirt": ["waist_cm", "hips_cm", "length_cm"],
    # Bottoms
    "trousers": ["waist_cm", "hips_cm", "inseam_cm", "rise_cm"],
    "shorts": ["waist_cm", "hips_cm", "inseam_cm"],
    # Accessories — no body-fit dimensions (size still optional).
    "belt": ["waist_cm", "length_cm"],
    "tie": ["length_cm"],
    "scarf": ["length_cm"],
    "socks": [],
    "shoes": [],  # uses size labels (EU/US) — no per-size dimensions for now
    "hat": [],
    "bag": [],
    "jewelry": [],
    "other": [],
}


def dimension_keys_for(garment_type: Optional[str]) -> List[str]:
    return DIMENSION_KEYS_BY_TYPE.get(garment_type or "other", [])


class ColorOption(BaseModel):
    name: str
    hex: str  # "#000000"


class ItemVariant(BaseModel):
    """A concrete (size × color) inventory unit.

    Modelled as a computed layer on top of ``sizes`` + ``colors`` so
    existing items (single-color / single-variant) keep working without
    a data migration and sellers who don't care about variant-level
    accounting see zero UI change. When present, ``variants`` is the
    authoritative source of stock; the legacy ``SizeOption.available_qty``
    still exists as the per-size roll-up for backwards compatibility.

    A variant with ``disabled=True`` means the seller confirmed that
    combo doesn't exist (e.g. "M in Red is out of stock permanently").
    """

    id: str  # stable variant UUID — used by orders + carts
    size_label: str  # matches a SizeOption.label on the same item
    color_name: Optional[str] = None  # None = single-color item
    color_hex: Optional[str] = None
    quantity: int = 0
    # When set, buyers see this price instead of the item's base price
    # for this specific variant (e.g. XXL priced higher). Stored in the
    # item's listing currency so the display code doesn't need to know.
    price_cents_override: Optional[int] = Field(default=None, ge=0)
    disabled: bool = False


class ItemIn(BaseModel):
    name: str
    description: str = ""
    brand_name: Optional[str] = Field(default=None, max_length=80)
    category: Literal["shirts", "dresses", "pants", "outerwear", "shoes", "accessories"]
    subcategory: Optional[str] = Field(default=None, max_length=40)
    price_cents: int = Field(ge=0)
    # When omitted, server falls back to the seller's preferred_currency.
    currency: Optional[Currency] = None
    # When omitted, server infers from category + name keywords.
    garment_type: Optional[GarmentType] = None
    # Primary garment image (legacy field, also auto-mirrored as images[0]).
    image_b64: str
    # Up to 4 additional photos (total 5 including image_b64). Iter 14:
    # sellers can showcase front/back/detail shots in a buyer gallery.
    extra_images: List[str] = Field(default_factory=list, max_length=4)
    sizes: List[SizeOption]
    colors: List[ColorOption] = []
    # Optional per-(size × color) inventory + pricing overrides. When
    # empty, the server auto-generates a variant per (size, color) using
    # the size's ``available_qty`` split evenly across colors — sellers
    # opting into variant-level accounting can send an explicit list.
    variants: List[ItemVariant] = Field(default_factory=list)
    audience: Audience = "unisex"


class ItemOut(BaseModel):
    id: str
    seller_id: str
    seller_name: str
    # Auto-verified flag mirrored from the seller's user document (True
    # once they've fulfilled 5+ paid orders). Populated by the list/get
    # endpoints via a batched join so buyer surfaces can show a small
    # "Verified" badge without an extra round-trip per item.
    seller_verified: bool = False
    name: str
    description: str
    brand_name: Optional[str] = None
    category: str
    subcategory: Optional[str] = None
    price_cents: int
    currency: Currency = "USD"  # listing currency
    garment_type: GarmentType = "other"  # layered try-on classification
    image_b64: str  # primary thumb (kept for back-compat clients)
    images: List[str] = Field(default_factory=list)  # full gallery, primary first
    sizes: List[SizeOption]
    colors: List[ColorOption]
    variants: List[ItemVariant] = Field(default_factory=list)
    audience: Audience = "unisex"
    # Paused listings are hidden from buyer Discover/search but still
    # appear in the seller's Inventory dashboard with a "Paused" badge so
    # the seller can unpause without re-listing.
    is_paused: bool = False
    created_at: datetime


class ItemPatch(BaseModel):
    """Partial update body for `PATCH /items/{id}` — every field optional.
    Sellers can edit any of these without re-uploading photos. Stock and
    dimensions live inside `sizes`; passing it replaces the entire list.
    Pause/unpause uses the `is_paused` toggle."""

    name: Optional[str] = None
    description: Optional[str] = None
    brand_name: Optional[str] = Field(default=None, max_length=80)
    category: Optional[
        Literal["shirts", "dresses", "pants", "outerwear", "shoes", "accessories"]
    ] = None
    subcategory: Optional[str] = Field(default=None, max_length=40)
    price_cents: Optional[int] = Field(default=None, ge=0)
    currency: Optional[Currency] = None
    garment_type: Optional[GarmentType] = None
    image_b64: Optional[str] = None
    extra_images: Optional[List[str]] = Field(default=None, max_length=4)
    sizes: Optional[List[SizeOption]] = None
    colors: Optional[List[ColorOption]] = None
    variants: Optional[List[ItemVariant]] = None
    audience: Optional[Audience] = None
    is_paused: Optional[bool] = None


# Legacy alias — older imports referenced ItemPatchIn. Kept so we don't
# break any in-flight clients that bundle the old field list.
ItemPatchIn = ItemPatch


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
    # BYO (Bring-Your-Own) try-ons have no marketplace item attached, so
    # this field is nullable. Catalog try-ons still always carry an id.
    item_id: Optional[str] = None
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
    # Optional variant_id — Phase-3 clients pass this; legacy clients
    # omit it and the backend resolves the variant from (size, color).
    variant_id: Optional[str] = None
    origin_url: str  # frontend base url for redirect targets
    address_id: Optional[str] = None  # required at endpoint level — graceful 400 if missing


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
    status: str  # pending / paid / failed / cancelled / in_fulfillment / shipped / delivered
    fit_feedback: Optional[FitFeedback] = None
    session_id: str
    created_at: datetime
    # Fulfillment metadata (populated as the seller progresses the order
    # through the state machine). Buyers see this on the order detail screen.
    tracking_number: Optional[str] = None
    tracking_url: Optional[str] = None
    # Auto-detected from tracking_url hostname (e.g. "G4S Courier",
    # "Sendy", "DHL", falling back to "External carrier").
    carrier: Optional[str] = None
    shipped_at: Optional[datetime] = None
    # Seller-picked at ship time, in business days (1-5). We compute the
    # eta timestamp server-side so the buyer sees a concrete date.
    estimated_delivery_days: Optional[int] = None
    estimated_delivery_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    fulfillment_note: Optional[str] = None
    # Escrow / dispute lifecycle
    buyer_confirmed_at: Optional[datetime] = None
    dispute_raised_at: Optional[datetime] = None
    dispute_reason: Optional[str] = None
    # When funds are/will be released from escrow to the seller. Set
    # to (delivered_at + 48h) at delivery time; ``buyer_confirmed_at``
    # advances the release to now.
    escrow_release_at: Optional[datetime] = None
    escrow_status: Optional[str] = None  # held / released / settled / disputed / cancelled
    payout_id: Optional[str] = None
    notified_seller_at: Optional[datetime] = None  # rate-limit buyer nudges


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
    shipping_address: Optional[Dict[str, Any]] = None


class FitFeedbackIn(BaseModel):
    fit: FitFeedback
    comment: Optional[str] = Field(default=None, max_length=600)


class FulfillmentIn(BaseModel):
    """Body for `POST /seller/orders/{id}/fulfillment` — drives the order
    state machine. Sellers POST one of:
      - `action: "acknowledge"` → paid → in_fulfillment
      - `action: "ship"` + `tracking_number` (and optional `tracking_url`,
                          `estimated_delivery_days` 1-5)
                          → in_fulfillment | paid → shipped
      - `action: "deliver"` → shipped → delivered (marked by seller/
                              courier). Starts the 48h buyer-confirmation
                              window before funds auto-release.
    """

    action: Literal["acknowledge", "ship", "deliver"]
    tracking_number: Optional[str] = Field(default=None, max_length=120)
    tracking_url: Optional[str] = Field(default=None, max_length=400)
    estimated_delivery_days: Optional[int] = Field(default=None, ge=1, le=5)
    note: Optional[str] = Field(default=None, max_length=400)


class ReportProblemIn(BaseModel):
    """Body for `POST /orders/{id}/report-problem` — a buyer flags an
    issue during the 48h escrow window. Freezes the auto-release until
    an admin (or the seller resolving with the buyer off-app) marks
    the dispute resolved.
    """

    reason: str = Field(min_length=6, max_length=800)


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
    """Legacy shape kept for backwards-compatibility of already-shipped
    frontend clients. Populated from Paystack payout account presence."""
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
        connect_status=doc.get("connect_status", "unstarted"),
        preferred_currency=doc.get("preferred_currency", DEFAULT_CURRENCY),
        company_name=doc.get("company_name"),
        location=Location(**raw_loc) if raw_loc else None,
        bank_details=BankDetails(**raw_bank) if raw_bank else None,
        suspended=bool(doc.get("suspended", False)),
        verified_seller=bool(doc.get("verified_seller", False)),
        verified_orders_count=int(doc.get("verified_orders_count") or 0),
        subscription_tier=doc.get("subscription_tier") or "free",
        subscription_status=doc.get("subscription_status"),
        current_period_end=doc.get("current_period_end"),
        trial_end=doc.get("trial_end"),
        cancel_at_period_end=bool(doc.get("cancel_at_period_end", False)),
        token_version=int(doc.get("token_version") or 0),
        created_at=doc["created_at"],
    )


def item_to_out(doc: Dict[str, Any], seller_verified: bool = False) -> ItemOut:
    gtype = doc.get("garment_type") or infer_garment_type(doc)
    # Back-compat: legacy items have only `image_b64`. Synthesize a one-
    # element images list when needed so the client always gets a gallery.
    gallery = list(doc.get("images") or [])
    if not gallery and doc.get("image_b64"):
        gallery = [doc["image_b64"]]
    return ItemOut(
        id=doc["id"],
        seller_id=doc["seller_id"],
        seller_name=doc.get("seller_name", ""),
        seller_verified=bool(seller_verified),
        name=doc["name"],
        description=doc.get("description", ""),
        brand_name=doc.get("brand_name"),
        category=doc["category"],
        subcategory=doc.get("subcategory"),
        price_cents=doc["price_cents"],
        currency=doc.get("currency", "USD"),
        garment_type=gtype,
        image_b64=doc["image_b64"],
        images=gallery,
        sizes=[SizeOption(**s) for s in doc.get("sizes", [])],
        colors=[ColorOption(**c) for c in doc.get("colors", [])],
        variants=[ItemVariant(**v) for v in doc.get("variants", [])],
        audience=doc.get("audience", "unisex"),
        is_paused=bool(doc.get("is_paused", False)),
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
    """Total available quantity for the item.

    When variants are present (post-Phase-3 items), they are the
    authoritative stock source and disabled variants don't count.
    Legacy items fall back to summing ``sizes[*].available_qty``.
    """
    variants = item.get("variants") or []
    if variants:
        return sum(
            int(v.get("quantity") or 0)
            for v in variants
            if not v.get("disabled")
        )
    return sum(int(s.get("available_qty", 0)) for s in item.get("sizes", []))

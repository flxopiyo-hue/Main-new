"""AuraFit backend: virtual try-on clothing marketplace.

Auth (JWT email/password with buyer/seller roles), body profile (manual
measurements + AI estimate from photos using Gemini multimodal), clothing
items CRUD, Gemini Nano Banana try-on image generation, and Stripe Checkout
purchases via emergentintegrations.
"""

from __future__ import annotations

import base64
import logging
import os
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


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    full_name: str = Field(min_length=1)
    role: Role
    gender: Gender
    age: Optional[int] = Field(default=None, ge=13, le=120)
    dob: Optional[str] = None  # ISO date "YYYY-MM-DD"; if set, server derives age


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    role: Role
    gender: Optional[Gender] = None
    age: Optional[int] = None
    dob: Optional[str] = None
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
    image_b64: str
    sizes: List[SizeOption]
    colors: List[ColorOption]
    audience: Audience = "unisex"
    created_at: datetime


class TryOnIn(BaseModel):
    item_id: str
    use_profile_photo: bool = True  # use stored front photo
    body_photo_b64: Optional[str] = None  # override if provided


class TryOnOut(BaseModel):
    id: str
    item_id: str
    result_image_b64: str
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
    status: str  # pending / paid / failed / cancelled
    session_id: str
    created_at: datetime


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
    doc = {
        "id": item_id,
        "seller_id": user["id"],
        "seller_name": user["full_name"],
        "name": body.name,
        "description": body.description,
        "category": body.category,
        "price_cents": body.price_cents,
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
async def get_item(item_id: str) -> ItemOut:
    doc = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
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


# -------------------------------------------------------------------------
# Try-On routes
# -------------------------------------------------------------------------
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

    system_msg = (
        "You are a fashion virtual try-on generator. You will receive two images: "
        "(1) a person's full-body photo, and (2) a clothing item. Generate a realistic "
        "photo of the same person wearing the clothing item, preserving the person's "
        "identity, pose, body shape, skin tone, hair, and background. Replace only the "
        "relevant clothing region. The output must be a single photorealistic image."
    )
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"tryon-{user['id']}-{uuid.uuid4()}",
        system_message=system_msg,
    ).with_model("gemini", NANO_BANANA_MODEL).with_params(modalities=["image", "text"])

    msg = UserMessage(
        text=(
            f"Generate a virtual try-on. {persona}"
            f"The person is wearing the garment '{item['name']}' "
            f"(category: {item['category']}, audience: {item.get('audience', 'unisex')}). "
            f"Maintain pose, identity, and background; replace only the relevant clothing. "
            f"Photorealistic, full body, studio quality."
        ),
        file_contents=[ImageContent(body_b64), ImageContent(garment_b64)],
    )

    try:
        text_resp, images = await chat.send_message_multimodal_response(msg)
    except Exception as e:
        logger.exception("Nano Banana error")
        raise HTTPException(status_code=502, detail=f"Try-on generation failed: {e}")

    if not images:
        raise HTTPException(
            status_code=502, detail=f"AI did not return an image. Response: {text_resp[:200]}"
        )

    result_b64 = images[0]["data"]
    # validate base64
    try:
        base64.b64decode(result_b64[:200] + "==", validate=False)
    except Exception:
        pass

    # Compute fit suggestion using stored measurements + demographics.
    fit_summary = await _compute_fit_summary(user, item)

    tryon_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    await db.tryons.insert_one(
        {
            "id": tryon_id,
            "user_id": user["id"],
            "item_id": item["id"],
            "result_image_b64": result_b64,
            "fit_summary": fit_summary,
            "created_at": now,
        }
    )
    return TryOnOut(
        id=tryon_id,
        item_id=item["id"],
        result_image_b64=result_b64,
        fit_summary=fit_summary,
        created_at=now,
    )


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

    # Add demographic flavor when available
    gender = user.get("gender")
    age = user.get("age")
    persona: Optional[str] = None
    if gender in ("male", "female") and age:
        gender_word = "men" if gender == "male" else "women"
        persona = f"typically suits {age}-yr-old {gender_word} with your measurements"
    elif age:
        persona = f"typically suits {age}-year-olds with your measurements"

    if persona:
        return f"Recommended size: {best['label']} — {persona}."
    return f"Recommended size: {best['label']} (closest match to your measurements)."


@api_router.get("/tryon/history", response_model=List[TryOnOut])
async def tryon_history(
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[TryOnOut]:
    docs = (
        await db.tryons.find({"user_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .to_list(50)
    )
    return [
        TryOnOut(
            id=d["id"],
            item_id=d["item_id"],
            result_image_b64=d["result_image_b64"],
            fit_summary=d.get("fit_summary"),
            created_at=d["created_at"],
        )
        for d in docs
    ]


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
    origin = body.origin_url.rstrip("/")
    success_url = f"{origin}/checkout/result?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/checkout/result?session_id={{CHECKOUT_SESSION_ID}}&cancelled=1"

    stripe = _stripe_client()
    req = CheckoutSessionRequest(
        amount=amount_dollars,
        currency="usd",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "buyer_id": user["id"],
            "item_id": item["id"],
            "size": body.size,
            "color": body.color or "",
        },
    )
    try:
        session = await stripe.create_checkout_session(req)
    except Exception as e:
        logger.exception("Stripe checkout error")
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")

    order_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
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
            status=d["status"],
            session_id=d["session_id"],
            created_at=d["created_at"],
        )
        for d in docs
    ]


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

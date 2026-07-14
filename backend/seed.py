"""Seed AuraFit with a demo seller account and a starter clothing catalog.

Re-running is idempotent: the seller is upserted by email and items are only
created if the seller currently has no inventory.
"""

import asyncio
import base64
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

import bcrypt
import httpx
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

SELLER = {
    "email": "atelier@aurafit.com",
    "full_name": "Maison Lumière",
    "password": "demo-seller-2026",
    "company_name": "Maison Lumière",
    "location": {"city": "Nairobi", "country": "Kenya"},
    "bank_details": {
        "bank_name": "Equity Bank",
        "account_name": "Maison Lumière Ltd",
        "account_number": "0123456789",
        "mpesa_paybill": "247247",
    },
}

ADMIN = {
    "email": "admin@oromona.com",
    "full_name": "Oromona Platform Admin",
    "password": "oromona-admin-2026",
}

ITEMS = [
    {
        "name": "Cropped Linen Shirt",
        "description": "Tailored linen blend with a relaxed cropped silhouette. Hand-finished hem.",
        "category": "shirts",
        "audience": "women",
        "price_cents": 12900,
        "image_url": "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=800&q=80",
        "sizes": [
            {"label": "XS", "chest_cm": 86, "waist_cm": 70, "length_cm": 50, "available_qty": 5},
            {"label": "S", "chest_cm": 92, "waist_cm": 75, "length_cm": 52, "available_qty": 8},
            {"label": "M", "chest_cm": 98, "waist_cm": 80, "length_cm": 54, "available_qty": 6},
            {"label": "L", "chest_cm": 106, "waist_cm": 88, "length_cm": 56, "available_qty": 3},
        ],
        "colors": [
            {"name": "White", "hex": "#FFFFFF"},
            {"name": "Camel", "hex": "#C8A77B"},
        ],
    },
    {
        "name": "Wide-Leg Trousers",
        "description": "High-rise wide-leg trousers in lightweight Italian wool.",
        "category": "pants",
        "audience": "unisex",
        "price_cents": 18900,
        "image_url": "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=800&q=80",
        "sizes": [
            {"label": "S", "waist_cm": 70, "hips_cm": 92, "length_cm": 100, "available_qty": 4},
            {"label": "M", "waist_cm": 76, "hips_cm": 98, "length_cm": 102, "available_qty": 5},
            {"label": "L", "waist_cm": 82, "hips_cm": 104, "length_cm": 104, "available_qty": 3},
        ],
        "colors": [
            {"name": "Olive", "hex": "#5C6F44"},
            {"name": "Black", "hex": "#0A0A0A"},
        ],
    },
    {
        "name": "Editorial Slip Dress",
        "description": "Bias-cut slip dress in fluid silk. A modern staple for evening or layering.",
        "category": "dresses",
        "audience": "women",
        "price_cents": 24900,
        "image_url": "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=80",
        "sizes": [
            {"label": "XS", "chest_cm": 84, "waist_cm": 68, "hips_cm": 90, "length_cm": 120, "available_qty": 3},
            {"label": "S", "chest_cm": 90, "waist_cm": 74, "hips_cm": 96, "length_cm": 122, "available_qty": 5},
            {"label": "M", "chest_cm": 96, "waist_cm": 80, "hips_cm": 102, "length_cm": 124, "available_qty": 4},
        ],
        "colors": [
            {"name": "Black", "hex": "#0A0A0A"},
            {"name": "Rose", "hex": "#D4859A"},
        ],
    },
    {
        "name": "Belted Trench Coat",
        "description": "Classic belted trench in water-resistant cotton gabardine.",
        "category": "outerwear",
        "audience": "unisex",
        "price_cents": 34900,
        "image_url": "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&q=80",
        "sizes": [
            {"label": "S", "chest_cm": 96, "waist_cm": 80, "length_cm": 110, "available_qty": 2},
            {"label": "M", "chest_cm": 102, "waist_cm": 86, "length_cm": 112, "available_qty": 3},
            {"label": "L", "chest_cm": 110, "waist_cm": 94, "length_cm": 114, "available_qty": 2},
        ],
        "colors": [
            {"name": "Camel", "hex": "#C8A77B"},
            {"name": "Navy", "hex": "#1B2A4E"},
        ],
    },
    {
        "name": "Pointed Leather Mule",
        "description": "Pointed-toe square heel mule, hand-crafted in Italian calfskin.",
        "category": "shoes",
        "audience": "women",
        "price_cents": 19900,
        "image_url": "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=800&q=80",
        "sizes": [
            {"label": "S", "length_cm": 24, "available_qty": 6},
            {"label": "M", "length_cm": 25, "available_qty": 8},
            {"label": "L", "length_cm": 26, "available_qty": 5},
        ],
        "colors": [
            {"name": "Black", "hex": "#0A0A0A"},
            {"name": "Camel", "hex": "#C8A77B"},
        ],
    },
    {
        "name": "Oversized Knit Pullover",
        "description": "Chunky merino-cashmere pullover with dropped shoulders.",
        "category": "shirts",
        "audience": "unisex",
        "price_cents": 22900,
        "image_url": "https://images.unsplash.com/photo-1485518882345-15568b007407?auto=format&fit=crop&w=800&q=80",
        "sizes": [
            {"label": "S", "chest_cm": 100, "shoulder_cm": 44, "sleeve_cm": 62, "length_cm": 64, "available_qty": 4},
            {"label": "M", "chest_cm": 108, "shoulder_cm": 46, "sleeve_cm": 63, "length_cm": 66, "available_qty": 6},
            {"label": "L", "chest_cm": 116, "shoulder_cm": 48, "sleeve_cm": 64, "length_cm": 68, "available_qty": 3},
        ],
        "colors": [
            {"name": "White", "hex": "#FFFFFF"},
            {"name": "Olive", "hex": "#5C6F44"},
        ],
    },
    {
        "name": "Tailored Linen Shirt",
        "description": "Crisp straight-cut linen shirt with mother-of-pearl buttons.",
        "category": "shirts",
        "audience": "men",
        "price_cents": 14900,
        "image_url": "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=800&q=80",
        "sizes": [
            {"label": "S", "chest_cm": 102, "shoulder_cm": 45, "sleeve_cm": 64, "length_cm": 70, "available_qty": 4},
            {"label": "M", "chest_cm": 108, "shoulder_cm": 47, "sleeve_cm": 65, "length_cm": 72, "available_qty": 6},
            {"label": "L", "chest_cm": 114, "shoulder_cm": 49, "sleeve_cm": 66, "length_cm": 74, "available_qty": 5},
            {"label": "XL", "chest_cm": 120, "shoulder_cm": 51, "sleeve_cm": 67, "length_cm": 76, "available_qty": 3},
        ],
        "colors": [
            {"name": "White", "hex": "#FFFFFF"},
            {"name": "Navy", "hex": "#1B2A4E"},
        ],
    },
    {
        "name": "Selvedge Denim",
        "description": "Raw indigo selvedge denim with a tapered straight leg.",
        "category": "pants",
        "audience": "men",
        "price_cents": 16900,
        "image_url": "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=800&q=80",
        "sizes": [
            {"label": "S", "waist_cm": 76, "hips_cm": 96, "length_cm": 108, "available_qty": 5},
            {"label": "M", "waist_cm": 82, "hips_cm": 102, "length_cm": 110, "available_qty": 7},
            {"label": "L", "waist_cm": 88, "hips_cm": 108, "length_cm": 112, "available_qty": 4},
        ],
        "colors": [
            {"name": "Navy", "hex": "#1B2A4E"},
            {"name": "Black", "hex": "#0A0A0A"},
        ],
    },
]


async def fetch_image_b64(url: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    return base64.b64encode(resp.content).decode("utf-8")


async def main() -> None:
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # ----- Seller -----
    seller_extras = {
        "company_name": SELLER["company_name"],
        "location": SELLER["location"],
        "bank_details": SELLER["bank_details"],
        "suspended": False,
    }
    existing = await db.users.find_one({"email": SELLER["email"]})
    if existing:
        seller_id = existing["id"]
        update: Dict[str, Any] = {"$set": {**seller_extras, "role": "seller"}}
        await db.users.update_one({"id": seller_id}, update)
    else:
        seller_id = str(uuid.uuid4())
        hashed = bcrypt.hashpw(SELLER["password"].encode(), bcrypt.gensalt()).decode()
        await db.users.insert_one(
            {
                "id": seller_id,
                "email": SELLER["email"],
                "full_name": SELLER["full_name"],
                "role": "seller",
                "hashed_password": hashed,
                "created_at": datetime.now(timezone.utc),
                **seller_extras,
            }
        )

    # ----- Admin -----
    admin_existing = await db.users.find_one({"email": ADMIN["email"]})
    if admin_existing:
        await db.users.update_one(
            {"id": admin_existing["id"]},
            {"$set": {"role": "admin", "suspended": False}},
        )
        print(f"  · admin already present ({ADMIN['email']})")
    else:
        admin_id = str(uuid.uuid4())
        hashed_admin = bcrypt.hashpw(ADMIN["password"].encode(), bcrypt.gensalt()).decode()
        await db.users.insert_one(
            {
                "id": admin_id,
                "email": ADMIN["email"],
                "full_name": ADMIN["full_name"],
                "role": "admin",
                "hashed_password": hashed_admin,
                "suspended": False,
                "created_at": datetime.now(timezone.utc),
            }
        )
        print(f"  + seeded admin {ADMIN['email']} / {ADMIN['password']}")

    item_count = await db.items.count_documents({"seller_id": seller_id})
    if item_count > 0:
        print(f"Seller already has {item_count} items, skipping item seeding.")
        client.close()
        return

    for spec in ITEMS:
        try:
            image_b64 = await fetch_image_b64(spec["image_url"])
        except Exception as e:
            print(f"  ⚠️ image fetch failed for {spec['name']}: {e}")
            continue
        now = datetime.now(timezone.utc)
        # Convert legacy price_cents (originally drafted in dollars) into
        # proper KES minor units. Each unit was meant to be ÷100 (USD
        # cents) — we re-scale by 100 so 12900 → 1,290,000 (KSh 12,900),
        # which is a realistic Kenyan boutique price tag.
        kes_price_cents = int(spec["price_cents"]) * 100
        await db.items.insert_one(
            {
                "id": str(uuid.uuid4()),
                "seller_id": seller_id,
                "seller_name": SELLER["full_name"],
                "name": spec["name"],
                "description": spec["description"],
                "category": spec["category"],
                "price_cents": kes_price_cents,
                "currency": "KES",
                "image_b64": image_b64,
                "sizes": spec["sizes"],
                "colors": spec["colors"],
                "audience": spec.get("audience", "unisex"),
                "is_paused": False,
                "cents_normalized": True,
                "created_at": now,
            }
        )
        print(f"  + seeded {spec['name']}")

    print("Done.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())

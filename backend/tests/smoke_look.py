"""Smoke test — iteration 40: size-aware stylist catalog + Shop-the-look checkout.

  1. Recreates smoke seller(s)/catalog/buyer (with measurements + address).
  2. Unit-checks _size_for_buyer / _catalog_lines filtering (no LLM call).
  3. POST /api/payments/checkout-look (3 pieces, one seller) → LIVE Paystack
     INITIALIZATION ONLY (never paid) → asserts N pending orders share one
     session_id, delivery fee on first order only, totals correct.
  4. Multi-seller look → parcel_count 2, fee doubled.
  5. Cleans up pending orders it created.

Run: python tests/smoke_look.py
"""
import asyncio
import base64
import io
import os
import random
import sys

import httpx
from PIL import Image, ImageDraw

BASE = os.environ.get("BASE", "http://localhost:8001/api")


def img_b64(kind: str, w=320, h=420) -> str:
    random.seed(kind)
    im = Image.new("RGB", (w, h), (240, 236, 228))
    d = ImageDraw.Draw(im)
    for i in range(0, w, 16):
        d.line([(i, 0), (i, h)], fill=(225, 220, 210), width=1)
    c = tuple(random.randint(30, 220) for _ in range(3))
    d.rectangle([40, 60, w - 40, h - 60], fill=c, outline=(20, 20, 20), width=3)
    for _ in range(8):
        x, y = random.randint(50, w - 60), random.randint(70, h - 80)
        d.ellipse([x, y, x + 14, y + 14], fill=(255, 255, 255))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode()


async def register_or_login(c, email, password, role, extra=None):
    body = {"email": email, "password": password, "full_name": f"Smoke {role}", "role": role}
    body.update(extra or {})
    r = await c.post(f"{BASE}/auth/register", json=body)
    if r.status_code != 200:
        r = await c.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    return r.json()["token"]


async def make_item(c, hdrs, name, gtype, cat, price, sizes):
    r = await c.post(f"{BASE}/items", headers=hdrs, json={
        "name": name, "category": cat, "garment_type": gtype,
        "price_cents": price, "currency": "KES",
        "image_b64": img_b64(name + "f"), "extra_images": [img_b64(name + "b")],
        "sizes": sizes, "audience": "men",
    })
    assert r.status_code == 200, f"{name}: {r.status_code} {r.text[:200]}"
    return r.json()["id"]


async def main() -> int:
    async with httpx.AsyncClient(timeout=120) as c:
        s1 = await register_or_login(c, "stylist_seller@oromona.com", "smoke-seller-2026", "seller",
                                     {"company_name": "Smoke Atelier", "location": {"city": "Nairobi", "country": "Kenya"}})
        s2 = await register_or_login(c, "stylist_seller2@oromona.com", "smoke-seller-2026", "seller",
                                     {"company_name": "Smoke Atelier 2", "location": {"city": "Nairobi", "country": "Kenya"}})
        h1 = {"Authorization": f"Bearer {s1}"}
        h2 = {"Authorization": f"Bearer {s2}"}
        std = [{"label": "M", "chest_cm": 100, "waist_cm": 86, "available_qty": 5},
               {"label": "L", "chest_cm": 106, "waist_cm": 92, "available_qty": 3}]
        shirt = await make_item(c, h1, "Crisp White Oxford Shirt", "shirt", "shirts", 249900, std)
        trous = await make_item(c, h1, "Charcoal Wool Trousers", "trousers", "pants", 399900,
                                [{"label": "M", "waist_cm": 86, "hips_cm": 100, "available_qty": 4}])
        shoes = await make_item(c, h1, "Black Leather Derby Shoes", "shoes", "shoes", 549900,
                                [{"label": "42", "available_qty": 4}])
        # This one should be EXCLUDED for the buyer: only tiny size stocked.
        tiny = await make_item(c, h1, "Tiny XS Tee", "shirt", "shirts", 99900,
                               [{"label": "XS", "chest_cm": 80, "available_qty": 9}])
        jacket2 = await make_item(c, h2, "Relaxed Denim Jacket", "outerwear", "outerwear", 459900, std)

        bt = await register_or_login(c, "stylist_buyer@oromona.com", "smoke-buyer-2026", "buyer",
                                     {"gender": "male", "age": 28})
        bh = {"Authorization": f"Bearer {bt}"}
        r = await c.put(f"{BASE}/profile", headers=bh, json={
            "measurements": {"height_cm": 178, "chest_cm": 99, "waist_cm": 84, "hips_cm": 98},
        })
        assert r.status_code == 200
        r = await c.post(f"{BASE}/addresses", headers=bh, json={
            "label": "home", "recipient_name": "Smoke Buyer", "phone": "0712345678",
            "street": "Kimathi St", "area": "CBD", "city": "Nairobi", "country": "Kenya",
        })
        assert r.status_code == 200, r.text[:300]
        addr_id = r.json()["id"]

        # ------------------------------------------------------------------
        # 2. Direct catalog-filter check (no LLM)
        # ------------------------------------------------------------------
        import sys as _sys
        _sys.path.insert(0, "/app/backend")
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        from routers.stylist import _catalog_lines  # noqa: E402
        meas = {"height_cm": 178, "chest_cm": 99, "waist_cm": 84, "hips_cm": 98}
        text, lookup, size_map = await _catalog_lines(meas, None)
        assert tiny not in lookup, "XS-only item should be filtered out"
        assert size_map.get(shirt) == "M", f"shirt best-fit expected M, got {size_map.get(shirt)}"
        assert size_map.get(trous) == "M"
        assert size_map.get(shoes) == "42", "non-apparel keeps any stocked size"
        assert "buyer's size: M (in stock)" in text
        print("catalog filter OK — sizes:", {k[:6]: v for k, v in size_map.items()})

        # ------------------------------------------------------------------
        # 3. Shop-the-look — single seller (LIVE init only!)
        # ------------------------------------------------------------------
        r = await c.post(f"{BASE}/payments/checkout-look", headers=bh, json={
            "lines": [{"item_id": shirt, "size": "M"},
                      {"item_id": trous, "size": "M"},
                      {"item_id": shoes, "size": "42"}],
            "address_id": addr_id,
        })
        print("look#1 status:", r.status_code)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert "checkout.paystack.com" in d["url"]
        assert d["parcel_count"] == 1
        assert d["items_total_cents"] == 249900 + 399900 + 549900
        assert d["delivery_fee_cents"] > 0
        assert d["total_cents"] == d["items_total_cents"] + d["delivery_fee_cents"]
        print("look#1 totals OK:", d["items_total_cents"], "+", d["delivery_fee_cents"], "fee, 1 parcel")

        from motor.motor_asyncio import AsyncIOMotorClient
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])["aurafit"]
        orders = await db.orders.find({"session_id": d["session_id"]}, {"_id": 0}).to_list(10)
        assert len(orders) == 3
        assert all(o["status"] == "pending" for o in orders)
        fees = sorted(o["delivery_fee_cents"] for o in orders)
        assert fees == [0, 0, d["delivery_fee_cents"]], f"fee allocation wrong: {fees}"
        assert all(o["look_id"] == d["look_id"] for o in orders)
        print("look#1 orders OK: 3 pending, fee on exactly one order")

        # status poll shape (combined name/amount) — poll may flip states via
        # Paystack verify; accept pending/cancelled but check the shape.
        r = await c.get(f"{BASE}/payments/status/{d['session_id']}", headers=bh)
        ps = r.json()
        assert "+ 2 more" in ps["item_name"], ps
        assert ps["amount_cents"] == d["total_cents"]
        print("status poll OK:", ps["status"], "|", ps["item_name"], "|", ps["amount_cents"])

        # ------------------------------------------------------------------
        # 4. Multi-seller look → 2 parcels, fee doubled
        # ------------------------------------------------------------------
        r = await c.post(f"{BASE}/payments/checkout-look", headers=bh, json={
            "lines": [{"item_id": shirt, "size": "M"}, {"item_id": jacket2, "size": "M"}],
            "address_id": addr_id,
        })
        assert r.status_code == 200, r.text[:400]
        d2 = r.json()
        assert d2["parcel_count"] == 2
        assert d2["delivery_fee_cents"] == 2 * d["delivery_fee_cents"]
        print("look#2 OK: 2 parcels, fee", d2["delivery_fee_cents"])

        # Bad size → 409? (variant resolution) or accepted (legacy fallback)
        r = await c.post(f"{BASE}/payments/checkout-look", headers=bh, json={
            "lines": [{"item_id": tiny, "size": "XS"}], "address_id": addr_id})
        print("tiny-item look allowed (buyer explicitly chose):", r.status_code)

        # ------------------------------------------------------------------
        # 5. Cleanup pending orders (no money ever moved)
        # ------------------------------------------------------------------
        res = await db.orders.delete_many({"buyer_id": orders[0]["buyer_id"], "status": "pending"})
        print("cleaned pending orders:", res.deleted_count)

    print("LOOK SMOKE OK")
    return 0


sys.exit(asyncio.run(main()))

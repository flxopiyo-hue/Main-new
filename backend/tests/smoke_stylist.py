"""Smoke test for the AI Stylist (iteration 39).

Creates a demo seller + catalog + a demo buyer (with measurements + a
synthetic front photo), then:
  1. POST /api/stylist/chat (new session, occasion=official) → JSON with
     reply + outfits referencing REAL catalog ids.
  2. Follow-up message in the same session (no photo re-attach).
  3. GET /api/stylist/sessions + session detail.
  4. Free-tier gate: two sessions used → third NEW session → 402 paywall.

Run: python tests/smoke_stylist.py
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
    """Generate a feature-rich synthetic image (edges, shapes, texture)."""
    random.seed(kind)
    im = Image.new("RGB", (w, h), (240, 236, 228))
    d = ImageDraw.Draw(im)
    for i in range(0, w, 16):
        d.line([(i, 0), (i, h)], fill=(225, 220, 210), width=1)
    if kind.startswith("person"):
        d.ellipse([w // 2 - 28, 30, w // 2 + 28, 86], fill=(150, 105, 70))       # head
        d.rectangle([w // 2 - 45, 90, w // 2 + 45, 240], fill=(90, 90, 120))     # torso
        d.rectangle([w // 2 - 40, 240, w // 2 - 6, 400], fill=(60, 60, 80))      # legs
        d.rectangle([w // 2 + 6, 240, w // 2 + 40, 400], fill=(60, 60, 80))
    else:
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


async def main() -> int:
    async with httpx.AsyncClient(timeout=180) as c:
        seller_tok = await register_or_login(
            c, "stylist_seller@oromona.com", "smoke-seller-2026", "seller",
            {"company_name": "Smoke Atelier", "location": {"city": "Nairobi", "country": "Kenya"}},
        )
        sh = {"Authorization": f"Bearer {seller_tok}"}
        catalog = [
            ("Crisp White Oxford Shirt", "shirts", "shirt", 249900),
            ("Charcoal Wool Trousers", "pants", "trousers", 399900),
            ("Black Leather Derby Shoes", "shoes", "shoes", 549900),
            ("Relaxed Denim Jacket", "outerwear", "outerwear", 459900),
        ]
        ids = []
        for name, cat, gtype, price in catalog:
            r = await c.post(f"{BASE}/items", headers=sh, json={
                "name": name, "category": cat, "garment_type": gtype,
                "price_cents": price, "currency": "KES",
                "image_b64": img_b64(name + "front"),
                "extra_images": [img_b64(name + "back")],
                "sizes": [{"label": "M", "chest_cm": 100, "available_qty": 5},
                          {"label": "L", "chest_cm": 106, "available_qty": 3}],
                "audience": "men",
            })
            if r.status_code != 200:
                print("item create failed:", r.status_code, r.text[:300]); return 1
            ids.append(r.json()["id"])
        print("catalog items:", len(ids))

        buyer_tok = await register_or_login(
            c, "stylist_buyer@oromona.com", "smoke-buyer-2026", "buyer",
            {"gender": "male", "age": 28},
        )
        bh = {"Authorization": f"Bearer {buyer_tok}"}
        r = await c.put(f"{BASE}/profile", headers=bh, json={
            "front_photo_b64": img_b64("person-front"),
            "measurements": {"height_cm": 178, "chest_cm": 99, "waist_cm": 84, "hips_cm": 98},
        })
        print("profile save:", r.status_code)

        # 1. New session — occasion official
        r = await c.post(f"{BASE}/stylist/chat", headers=bh, json={
            "message": "Style me for the office — official wear.", "occasion": "official",
        })
        print("chat#1 status:", r.status_code)
        if r.status_code != 200:
            print(r.text[:500]); return 1
        d = r.json()
        sid = d["session_id"]
        print("reply:", d["reply"][:160].replace("\n", " "))
        print("outfits:", [(o["title"], [i["name"] for i in o["items"]]) for o in d["outfits"]])
        print("sessions_remaining:", d["sessions_remaining"])
        for o in d["outfits"]:
            for it in o["items"]:
                assert it["id"] in ids, f"hallucinated item {it['id']}"

        # 2. Follow-up in same session
        r = await c.post(f"{BASE}/stylist/chat", headers=bh, json={
            "session_id": sid, "message": "Nice — can you make it a bit more relaxed?",
        })
        print("chat#2 status:", r.status_code)
        if r.status_code != 200:
            print(r.text[:400]); return 1
        print("reply2:", r.json()["reply"][:120].replace("\n", " "))

        # 3. History endpoints
        r = await c.get(f"{BASE}/stylist/sessions", headers=bh)
        print("sessions list:", r.status_code, len(r.json()))
        r = await c.get(f"{BASE}/stylist/sessions/{sid}", headers=bh)
        det = r.json()
        print("session detail msgs:", len(det["messages"]),
              "appearance stored:", "yes" if any(m.get("outfits") for m in det["messages"]) else "n/a")

        # 4. Gate: start session #2 then #3 should 402
        r = await c.post(f"{BASE}/stylist/chat", headers=bh, json={"message": "hi", "occasion": "casual"})
        print("chat new-session#2 status:", r.status_code)
        r = await c.post(f"{BASE}/stylist/chat", headers=bh, json={"message": "hi again", "occasion": "date"})
        print("chat new-session#3 status (expect 402):", r.status_code)
        assert r.status_code == 402, "gate did not trip"
        print("paywall detail:", r.json()["detail"]["feature"])
    print("STYLIST SMOKE OK")
    return 0


sys.exit(asyncio.run(main()))

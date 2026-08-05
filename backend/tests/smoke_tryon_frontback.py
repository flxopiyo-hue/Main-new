"""Smoke: outfit try-on (3 garments) + single-item colour try-on after the
front/back garment-reference changes. Run: python tests/smoke_tryon_frontback.py"""
import asyncio
import os
import sys

import httpx

BASE = os.environ.get("BASE", "http://localhost:8001/api")


async def main() -> int:
    async with httpx.AsyncClient(timeout=180) as c:
        r = await c.post(f"{BASE}/auth/login", json={"email": "buyer@aurafit.com", "password": "demo-buyer-2026"})
        r.raise_for_status()
        tok = r.json()["token"]
        h = {"Authorization": f"Bearer {tok}"}

        r = await c.get(f"{BASE}/items", headers=h)
        r.raise_for_status()
        items = r.json()
        by_type = {}
        for it in items:
            gt = it.get("garment_type") or ""
            by_type.setdefault(gt, it)
        picks = []
        for want in ("shirt", "trousers", "shoes"):
            if want in by_type:
                picks.append(by_type[want])
        if len(picks) < 3:
            # fall back to any 3 distinct types
            picks = list({(it.get("garment_type") or i): it for i, it in enumerate(items)}.values())[:3]
        ids = [p["id"] for p in picks]
        print("outfit items:", [(p.get("garment_type"), p["name"][:30]) for p in picks])

        r = await c.post(
            f"{BASE}/tryon/outfit",
            headers=h,
            json={"item_ids": ids, "use_profile_photo": True, "angles": ["front"]},
        )
        print("outfit status:", r.status_code)
        if r.status_code != 200:
            print(r.text[:400])
            return 1
        d = r.json()
        print("outfit images:", [a["angle"] for a in d.get("images", [])], "b64 len:", len(d["result_image_b64"]))

        # Single-item colour-aware try-on (back angle exercises the back photo path)
        coloured = next((it for it in items if it.get("colors")), None)
        if coloured:
            cname = coloured["colors"][0]["name"]
            r = await c.post(
                f"{BASE}/tryon",
                headers=h,
                json={
                    "item_id": coloured["id"],
                    "use_profile_photo": True,
                    "color_name": cname,
                    "angles": ["back"],
                },
            )
            print("single colour+back status:", r.status_code, "colour:", cname)
            if r.status_code != 200:
                print(r.text[:400])
                return 1
            d = r.json()
            print("single images:", [a["angle"] for a in d.get("images", [])])
        else:
            print("no coloured item found — skipped colour test")
    print("SMOKE OK")
    return 0


sys.exit(asyncio.run(main()))

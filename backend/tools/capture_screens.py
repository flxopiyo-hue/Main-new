"""Capture raw 1290x2796 (iPhone 6.7") screenshots of the 6 hero screens
for the App Store, logged in as the demo buyer. Saves PNGs to
/app/appstore_screenshots/raw/.
"""
import asyncio
import os

from playwright.async_api import async_playwright

URL = "https://fit-finder-app-5.preview.emergentagent.com"
EMAIL = "amara.demo@oromona.com"
PASSWORD = "demo-amara-2026"
TRYON_ID = os.environ.get("TRYON_ID", "92ecfc14-9bca-4897-8bea-80877055e150")
ORDER_ID = os.environ.get("ORDER_ID", "abb40bf2-8596-45d8-ae14-d5708585b0cc")
OUT = "/app/appstore_screenshots/raw"
os.makedirs(OUT, exist_ok=True)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        page = await b.new_page(viewport={"width": 430, "height": 932}, device_scale_factor=3)

        async def shot(name):
            await page.wait_for_timeout(1200)
            await page.screenshot(path=f"{OUT}/{name}.png")
            print("captured", name)

        # ---- login ----
        await page.goto(URL, wait_until="domcontentloaded")
        await page.wait_for_timeout(3500)
        if await page.get_by_text("I ALREADY HAVE AN ACCOUNT", exact=False).count() > 0:
            await page.get_by_text("I ALREADY HAVE AN ACCOUNT", exact=False).click(force=True)
            await page.wait_for_timeout(1200)
        await page.locator('input[type="email"]').first.fill(EMAIL)
        await page.locator('input[type="password"]').first.fill(PASSWORD)
        await page.locator('[data-testid="login-submit-btn"]').click(force=True)
        await page.wait_for_selector('[data-testid^="item-card-"]', timeout=25000)
        await page.wait_for_timeout(2500)

        # 1. Marketplace home
        await shot("01_home")

        # 2. Item detail (dress) — open first card
        await page.locator('[data-testid^="item-card-"]').first.click(force=True)
        await page.wait_for_selector('[data-testid="item-outfit-toggle-btn"]', timeout=15000)
        await page.wait_for_timeout(2000)
        await shot("02_item")

        # 3. AI Try-On result
        await page.goto(f"{URL}/outfit/result?id={TRYON_ID}", wait_until="domcontentloaded")
        await page.wait_for_timeout(4000)
        await shot("03_tryon")

        # 4. AI Stylist chat
        await page.goto(f"{URL}/stylist", wait_until="domcontentloaded")
        await page.wait_for_timeout(4500)
        # scroll a touch so an outfit card is visible under the reply
        try:
            await page.locator('[data-testid^="stylist-shop-look-"]').first.scroll_into_view_if_needed()
        except Exception:
            pass
        await page.wait_for_timeout(1000)
        await shot("04_stylist")

        # 5. Shop-the-look sheet (open from the first stylist outfit)
        try:
            await page.locator('[data-testid^="stylist-shop-look-"]').first.click(force=True)
            await page.wait_for_selector('[data-testid="look-pay-btn"]', state="visible", timeout=10000)
            await page.wait_for_timeout(2500)
            await shot("05_shoplook")
        except Exception as e:
            print("shoplook capture issue:", e)

        # 6. Order tracking
        await page.goto(f"{URL}/order/{ORDER_ID}", wait_until="domcontentloaded")
        await page.wait_for_timeout(4000)
        await shot("06_order")

        await b.close()
    print("ALL CAPTURED")


asyncio.run(main())

# AuraFit — Virtual Try-On Clothing Marketplace

## Vision
A mobile marketplace where shoppers see clothes on **their own body** before buying. Sellers (independent designers, ateliers, boutiques) upload pieces with real dimensions; buyers browse only what fits, try it on with AI, and check out via Stripe.

## Roles
1. **Buyer** — creates body profile (manual measurements + optional AI estimate from photos), browses items filtered by size, runs AI try-on, buys via Stripe.
2. **Seller** — uploads garments with real per-size dimensions, colors, and stock counts. Sees own inventory in the **Atelier** tab.

## Tech Stack
- **Frontend:** Expo SDK 54, expo-router, React Native, react-native-keyboard-controller, expo-image-picker, expo-image-manipulator, expo-web-browser
- **Backend:** FastAPI + Motor (MongoDB)
- **Auth:** JWT (email/password) with role claim, bcrypt hashing
- **AI try-on:** Gemini Nano Banana (`gemini-3.1-flash-image-preview`) via `emergentintegrations.llm.chat.LlmChat`
- **AI body measurement:** Gemini `gemini-2.5-flash` multimodal via `LlmChat`
- **Payments:** Stripe Checkout via `emergentintegrations.payments.stripe.checkout.StripeCheckout`

## Core User Flows
1. **Sign Up** → choose Buyer / Seller → JWT issued.
2. **Body Profile (buyer)** → capture front+side photos → "Estimate with AI" fills measurements → save preferred size.
3. **Discover** → category chips (Shirts, Dresses, Pants, Outerwear, Shoes, Accessories) + size banner auto-applied → tap an item.
4. **Item Detail** → pick size + color → "Try It On" runs Nano Banana, image refreshes inline + fit summary banner ("Recommended size: M") → "Buy" opens Stripe Checkout URL via `expo-web-browser`.
5. **Checkout Result** → polls `/api/payments/status/{session_id}` → success / cancelled.
6. **Atelier (seller)** → "+ New" → upload garment photo, set per-size chest/waist/hips/qty, choose colors, publish.
7. **Profile** → edit body profile, see orders, sign out.

## Key API Endpoints
- `POST /api/auth/{register,login}`, `GET /api/auth/me`
- `GET|PUT /api/profile`, `POST /api/profile/estimate`
- `GET|POST /api/items`, `GET /api/items/{id}`, `GET /api/items/mine`, `DELETE /api/items/{id}`
- `POST /api/tryon` (accepts `angles: ["front","three_quarter","side","back"]`), `GET /api/tryon/history`, `GET /api/tryon/{id}/share?fmt=square|story&angle=…`
- `POST /api/payments/checkout`, `GET /api/payments/status/{session_id}`, `GET /api/orders`
- `POST /api/payments/webhook` (Stripe → server)
- `PATCH /api/auth/preferences` (update `preferred_currency`)
- `GET /api/collections`, `GET /api/collections/{id}`, `POST /api/collections` (seller)
- `GET /api/seller/analytics`, `POST /api/seller/connect/setup` (mocked Stripe Connect)
- `GET|POST|DELETE /api/wishlist*`

## Design Direction
Editorial Swiss / High-Contrast: Cormorant Garamond display + Manrope body text, off-white `#FAFAFA` background, sharp 0-radius corners, generous spacing, photos dominate.

## Currency & Region
12 supported currencies (KES default for new accounts — product originates in Kenya): KES, USD, EUR, GBP, NGN, ZAR, INR, UGX, TZS, RWF, GHS, EGP. Sellers list items in their own currency; buyers see the listed price plus an "≈ KSh …" indicative conversion when their preferred currency differs. Stripe checkout uses the item's listed currency directly.

## Multi-angle Virtual Try-On
`/api/tryon` accepts up to 4 angles (front, three_quarter, side, back) and renders them in parallel via Gemini Nano Banana with angle-specific prompts. The UI shows a thumb strip below the hero; share works per-angle.

## Seeded Data
`/app/backend/seed.py` creates one seller (Maison Lumière) with six garments spanning every category, each with real dimensions per size and 2 colors. Re-running is idempotent. Legacy seeded items default to `currency="USD"`.

## Smart Business Hook (next iteration)
**Designer royalty payouts:** Stripe Connect for sellers + monthly auto-payout — turns the platform into a marketplace SaaS.

---

## Update — June 2026 (shared categories + variant grid iteration)
- **Payments are Paystack** (Stripe fully purged earlier). 15% platform fee, escrow with 48h auto-release, Kenya banks + M-Pesa payouts.
- **Shared marketplace categories**: `GET/POST /api/categories` backed by a `categories` Mongo collection (unique compact slug). Sellers can add community categories ("Swimwear") in the add-item wizard via search-or-add; near-duplicates ("swim wear", "Swimwears", "swimware") canonicalise onto one row (slugify + plural + difflib fuzzy match). `POST/PATCH /api/items` canonicalise free-text categories. Buyer Discover chips load from the same endpoint so community categories are discoverable.
- **Variant grid completed**: size × colour matrix with per-combo quantity, disable toggle, and optional per-variant **price override** input. Explicit variants get server-assigned UUIDs (create) and preserve ids by (size,colour) key (patch). `sizes[].available_qty` roll-up now recomputed from variants server-side; frontend uses shared `itemTotalQty()` (variants-authoritative).
- **P0 crash fixed & verified**: `pickedColors is not defined` in add-item wizard — variant matrix JSX now lives in `StepSizing`; full seller flow (photo → taxonomy → sizing → publish) verified via browser automation.

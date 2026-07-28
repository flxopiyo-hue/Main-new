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
- **Per-colour photos**: `ColorOption.image_b64` — seller attaches a photo per colour in the wizard; buyer item detail swaps the hero image when a colour swatch is tapped.
- **Colour-aware try-on + identity lock**: /api/tryon takes color_name (uses colour photo as garment ref); hardened face-preservation prompts.
- **Category size charts**: waist-inch (men bottoms), UK 6–18 (women), bra band+cup, underwear, socks EU, kids ages, one-size — seller-selectable "Size system" in wizard (src/lib/size-charts.ts).
- **Min-1 measurement rule**: any single measurement per size suffices (no mandatory chest).
- **Confirm received**: buyer can confirm from shipped OR delivered; promotes to delivered + releases escrow.

## Update — June 2026 (M-Pesa Premium + colour photo groups)
- **Premium payments — two paths** (`POST /api/subs/checkout` body `{method}`):
  - `card` (default): Paystack plan subscription, 7-day trial, auto-renews (cards-only per Paystack recurring-billing rules).
  - `mpesa`: one-time `mobile_money` charge (metadata `purpose=premium_once`) → **30-day Premium pass**, no auto-renew; paying again EXTENDS the pass (days stack). Grant applied in /subs/verify, /subs/paystack-return AND webhook charge.success (purpose-aware). User doc flag `premium_one_time`; `is_premium()` expires passes past `current_period_end`. `/subs/me.subscription.one_time`; `/subs/cancel` → 400 friendly msg for pass holders.
  - UI `/subscription`: two buttons (sub-upgrade-btn card / sub-mpesa-btn) + channel note; pass holders see status + "Extend 30 days with M-Pesa" (sub-extend-btn).
- **Colour photo groups (Amazon-style)**: `ColorOption.images: List[str]` (max 5, first = hero; `image_b64` kept as back-compat mirror of images[0], maintained by `_normalize_color` in items POST/PATCH). Seller wizard step 3: per-colour group card (`wizard-color-group-{name}`) with thumbs (COVER badge, remove), ADD/CAMERA tiles, and one-tap "Reuse a product photo" row (no re-uploading). Buyer item page: selected colour's photo group leads the gallery + hero; colour without photos falls back to general photos honestly.
- Tested: iteration 30 — backend 13/13 pytest + frontend UI verified (report /app/test_reports/iteration_29.json). LIVE Paystack: initialization-only testing forever.

## Update — June 2026 (Phase 1 Courier System)
- Zone-based courier fees from Nairobi CBD (buyer pays at checkout; admin-editable at /admin/delivery): inner 300 / outer 600 (Karen anchor) / metro 900 / major towns 500 / rest 700 KSh; free ≥ KSh 20,000; CBD pickup option KSh 0.
- Courier role (boda riders): self-register w/ phone + M-Pesa → admin approval (/admin/couriers) → rider portal /(courier) with job board, accept → picked_up → out_for_delivery → deliver via buyer's 4-digit handover code (code entry = proof of delivery, starts 48h escrow window).
- Split: rider earns 90% of zone fee (credited on handover), Oromona keeps 10% (both admin-tunable). Earnings ledger + end-of-day payout recorded by admin mark-paid (real M-Pesa transfers = Phase 2).
- Seller flow: "Request rider pickup" button on paid door-delivery orders; CBD-pickup orders show drop-at-pickup-point hint.
- Admin console login: app /login with admin@oromona.com (see test_credentials) → lands on /admin dashboard; new tabs: Riders, Fees.

## Update — June 2026 (Interactive measurement guides)
- **Buyer guide** (`src/components/BodyMeasureGuide.tsx`, shown on /onboarding/measurements above the input grid): gender-based SVG silhouettes (male/female toggle, defaults from user.gender) with labelled double-arrow measurement lines (height/shoulders/chest/waist/hips/inseam). Focusing an input highlights the matching arrow (solid black + pulsing halo via RN Animated), highlights the legend row (live values, unit-aware cm/in/ft) and swaps in a how-to-measure tip. After AI estimate, applied measurements light up sequentially (900ms apart).
- **Seller guide** (`src/components/GarmentMeasureGuide.tsx`, add-item wizard step 3 above the per-size grids): flat-lay garment diagram adapts to garment_type (top/dress/skirt/trousers/shorts/belt/tie/scarf) drawing arrows only for that garment's DIMENSION_KEYS_BY_TYPE; focusing a dimension field highlights the arrow + shows DIMENSION_HINTS copy. Shared SVG/animation parts in `src/components/MeasureGuideParts.tsx`.
- Tested: iteration 32 — testing agent 13/13 frontend PASS (report /app/test_reports/iteration_31.json) incl. trousers/shirt/dress diagrams, unit conversion, save regressions.
- **Escrow window confirmed by user: stays 48h** (no change made).
- ⚠️ Known pre-existing dead links (user approval pending to fix): pushes to "/seller", "/seller/new-item", "/seller/new-collection", "/seller/analytics", "/seller/onboarding" in (tabs)/atelier.tsx, (tabs)/profile.tsx, (auth)/login.tsx, HeaderMenu.tsx → Unmatched Route (real routes live under /(seller)/*).
- ⚠️ Login intent chip flips account role server-side — demo seller was accidentally toggled to buyer during testing and restored; always log in atelier@aurafit.com with the seller chip.

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

## Update — June 2026 (dead links fixed + buyer measurement map)
- Restored `app/seller-onboarding.tsx` (route /seller-onboarding) and `app/(seller)/new-collection.tsx` (hidden tab) — both were deleted in the seller-portal restructure while links to them remained. All "/seller/*" pushes repointed to real routes (atelier tab, profile, login, HeaderMenu).
- Buyer item page: "See where size X is measured" toggle under the size details expands the SAME GarmentMeasureGuide diagram with the selected size's dimensions in the legend (cm/in aware); legend rows are tappable to highlight arrows. GarmentMeasureGuide gained optional values/unit/onSelectKey props (seller wizard usage unchanged).

## Update — June 2026 (KES standard + compare-with-body)
- **KSh (KES) is the standard currency always**: device-locale auto-switching removed (locale.ts deleted); buyer/seller registration hard-defaults preferred_currency=KES; frontend getCurrencyMeta + backend item/order currency fallbacks now KES; all 52 existing users migrated to KES in DB. Manual picker kept (header pill + Profile) for optional display conversion.
- **Currency sheet scroll bug fixed** (user: "slider refuses to go up"): CurrencyPill FlatList now has bounded height (maxHeight 420, flexGrow 0) so it scrolls on web; KES first with active check.
- **Compare with my body**: highlighting a measurement in the buyer item measurement map shows "Your waist: 81cm — this size runs 5cm smaller/roomier/exact match" (from fit-score body/diff; cm/in aware; hidden when no body value e.g. rise).
- Demo buyer seeded with full measurements (170/92/81/98/44/78).
- Tested: iteration 34 — testing agent 7/7 frontend PASS incl. buyer+seller registration regressions (report /app/test_reports/iteration_32.json).

## Update — June 2026 (fit banner size suggestion)
- Fit-preview banner now suggests the better size when the selected one runs tight/loose: "Size S runs 5cm tight — M fits your waist better →" (tappable, jumps to that size). Only suggests sizes with a strictly better overall fit score; prefers in-stock. Implemented in SizeSlider.tsx; verified in browser.

## Update — June 2026 (Phase 2: Rider M-Pesa payouts)
- Riders add their M-Pesa number under Earnings → creates a live Paystack transfer recipient (mobile_money/MPESA/KES).
- Admin → Riders: "M-PESA KSh X" one-tap settlement of a rider's full pending balance via Paystack Transfer (earnings claimed before transfer, auto-rollback to pending on failure); "Mark paid manually" fallback retained; payout history with per-batch status (processing/sent/settled/failed) + VERIFY poll button; transfer webhooks (rider_ refs) reconcile automatically.
- Rider Earnings screen: payout account card + payout history with status chips.
- ⚠️ BLOCKER (user side): the Paystack account is a **starter business** — Paystack rejects third-party payouts until the account is upgraded to a Registered Business (Paystack dashboard → Compliance). All code paths verified live; failed transfers roll back safely and surface the exact Paystack reason.
- Verified: live recipient creation, payout attempt + rollback + failure reason in UI, manual settlement, history rendering (iteration 36, main-agent E2E).

## Update — June 2026 (multi-garment try-on fix, front/back photos, courier-only workflow, clean reset)
- **Outfit Drawer fixed** (user bug: multi-garment try-on unusable): RN-web Modal slide animation left the sheet stuck off-screen → restructured to flex-based bottom sheet (overlay flex-end, sheet maxHeight 88%, shrinkable list) with animationType "none". Generate buttons verified tappable at 390×800.
- **Front/back item photos**: sellers' photo 1 = FRONT (cover), photo 2 = BACK — wizard badges ("FRONT · COVER"/"BACK" on general + colour-group thumbs), "Add front"/"Add back" placeholders, publishing blocked unless ≥2 photos. Backend try-on now sends the back photo as an extra labelled reference (single-item AND outfit generation) so different front/back prints render on the correct side; colour group's own front/back photos preferred when a colour is selected.
- **Colour-aware try-on confirmed + improved**: try-on already used the selected colour's photo + hue lock; NOW switching colour also resets the previous AI result so the hero shows the new colour and the next generation uses it.
- **In-store/CBD pickup REMOVED** (user: no in-store pickups): checkout is door-delivery-by-rider only (CheckoutIn Literal["door"], pickup → 422; AddressPickerSheet single static delivery row; seller pickup hints deleted).
- **Seller→rider workflow tightened**: paid → "Accept order" → in_fulfillment → "Package ready · Call rider" (riders notified ONLY then; request_courier from paid → 400) or "Ship myself" (external carrier). Courier orders: rider pickup auto-ships, buyer's 4-digit handover code delivers + starts 48h escrow; seller ship/deliver on courier orders → 400. "Mark as delivered" remains ONLY for self-shipped orders.
- **Clean data reset (user-requested)**: all users except admin@oromona.com, plus items/orders/tryons/profiles/addresses/collections/jobs/earnings/batches wiped. Zones, settings, categories, admin kept. Old demo creds dead — see memory/test_credentials.md.
- Tested: iteration 38 — backend 14/14 pytest (state machine, rider lifecycle, self-ship, pickup 422, LIVE-init-only checkout) + frontend drawer/checkout/wizard PASS; seller orders UI re-verified in browser after fixing a same-file parallel-edit race that had reverted the action row.

## Update — June 2026 (AI Stylist)
- **AI Stylist chat** (user-requested): chat assistant at `/stylist` (CTA card on the Try-On tab). Gemini 3.1 Pro (Emergent LLM key) analyses the buyer's front photo (skin tone/undertone, body structure — stored once per session as `appearance_profile`) + measurements + occasion (Casual / Official·Work / Event·Wedding / Date night) and recommends ONLY real catalog items (strict-JSON contract, ids validated server-side; hallucinated ids dropped).
- Suggestion cards: title + why-it-works + tappable item thumbs + **"Try this look on"** → stages all pieces into the outfit store and opens the Outfit Drawer for a one-tap multi-garment AI try-on.
- Gating: Free buyers = 2 NEW sessions per rolling week (messages within a session uncapped), Premium unlimited; 402 → PaywallModal. Sessions persist in `db.stylist_sessions`; screen resumes the latest session; "new session" pencil in the header.
- Backend: `routers/stylist.py` (POST /api/stylist/chat, GET /api/stylist/sessions[/id]), `core/gating.py` stylist helpers, `STYLIST_MODEL`/`FREE_STYLIST_SESSIONS_PER_WEEK` in config. Non-streaming send (response is structured JSON parsed server-side).
- Tested (iteration 39, main agent, real LLM): backend smoke `tests/smoke_stylist.py` all-pass incl. 402 gate; browser E2E: CTA → resume → send → outfit cards (with skin-tone/height reasoning) → try-look → drawer with 4 layered pieces → paywall on 3rd new session. Smoke seller/buyer/items cleaned after — marketplace stays clean (admin only).

## Update — June 2026 (Stylist size-aware catalog + Shop the look)
- **Size-aware stylist**: the catalog sent to Gemini is pre-filtered server-side — each piece must be in stock in THE BUYER'S size (best-fit from measurements via the fit engine with score ≥ 50 "amber" floor → fallback preferred size → any stocked size for non-apparel like shoes/accessories). Each catalog line + suggestion card carries the buyer's size (`suggested_size`, `sizes_in_stock`).
- **Shop the look**: POST /api/payments/checkout-look — ONE live Paystack charge for a whole outfit (reference `oromona_order_look_*`); creates one pending order per piece sharing the session_id; delivery = one parcel per seller, per-parcel zone fee (free-threshold applied per parcel) summed and shown as a single delivery line; fee stored on the first order of each seller group. All reconciliation paths (status poll, paystack-return bridge, both webhooks) are now multi-order aware. Frontend: `LookCheckoutSheet` (pieces + size chips pre-picked, address radio, one delivery line "+N parcels", Pay button) wired to outfit cards ("Try it on" ghost + "Shop the look" primary).
- Tested (iteration 40, main agent): tests/smoke_look.py all-pass (XS-only item excluded, best-fit sizes, single/multi-seller fee math, fee-on-one-order allocation, combined status poll "X + 2 more"); browser E2E: occasion → suggestion → Shop-the-look sheet with best-fit sizes, KSh 300 delivery, KSh 12,297 total (LIVE Paystack — Pay NOT tapped). Smoke data cleaned; DB holds admin + owner account only.

## Update — June 2026 (deployment health check → PASS)
- Deployment agent health check iterated to **PASS** (no findings). Fixes applied:
  1. FRONTEND_PUBLIC_URL (core/config.py) + APP_WEB_URL (routers/auth.py) are env-only — no hardcoded preview-domain fallbacks in source.
  2. app.json Android permissions trimmed to CAMERA only (media picking via Expo plugin-managed permissions).
  3. **Account deletion** (App/Play review requirement): DELETE /api/auth/me (blocks admin; wipes profiles/addresses/tryons/stylist sessions/wishlists/collections/stock notifications + seller items; retains order records) + red "Delete Account" action with confirmDialog on the profile tab. Verified: delete 200 → token 401 → login 400; admin self-delete 400.
  4. seed.py rewritten: admin bootstrap only, credentials from ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD env (aborts if unset); demo seller/catalog seeding removed; no plaintext passwords in source.
  5. seller_analytics N+1 replaced with bulk $group aggregations (wishlists + paid orders by item_id).

## Update — June 2026 (App Store readiness + Share fix + Landing page)
- **Share Square / Share Story 9:16 fixed** (was throwing on every tap): SDK 54 upgrade quietly deprecated `expo-file-system`'s top-level `writeAsStringAsync` / `cacheDirectory` / `EncodingType`, which now **throw at runtime**. `frontend/src/lib/share.ts` migrated to the new File API (`File`, `Paths.cache`) — writes with `{ encoding: "base64" }`, ensures parent dir with `create({ intermediates: true, overwrite: true })`, and now also gracefully falls back to a browser `Blob` download on web (previously silently returned false). Callers in `item/[id].tsx`, `outfit/result.tsx`, and `(tabs)/tryon.tsx` unchanged.
- **Seller pricing calculator refined**: preview under the "Your price" input now shows the exact backend math — "Buyers see KSh 3,000 · Oromona fee KSh 450. You receive KSh 2,550" — instead of the previous phrasing that quoted the seller's typed take-home even though ceil rounding lands them slightly higher. Matches `core/escrow.py` fee = floor(gross * 1500 / 10000).
- **App Store descriptions**: `/app/appstore_descriptions.md` — App Store subtitle/promotional/keywords/short/full body + Google Play title/short/full body + support/privacy/deletion URLs all drafted. Same body works for both stores.
- **6.1"/6.3" iPhone screenshots (1206×2622)**: new composer `backend/tools/compose_appstore_61.py` produces the six branded slides at Apple's smaller portrait size for iPhone 15/16 & 16 Pro slots. Output at `/app/appstore_screenshots/final_61/*.png` and zipped at `/app/oromona_appstore_screenshots_6_1.zip` (5.2 MB). The existing 1290×2796 zip for 6.9" is unchanged.
- **oromona.com landing page**: mobile + desktop friendly, self-contained (no external CSS/JS). Two delivery paths — served by the backend at `GET /api/landing` (backed by `backend/routers/_landing_template.html`), and a standalone HTML at `/app/oromona_landing.html` for hosting on Netlify/Vercel/S3/cPanel. App Store / Google Play buttons ship as `#` placeholders the user will swap when store links go live. Footer links Privacy Policy and Delete Account & Data.

## Update — June 2026 (SSO: Google + Apple)
- **SSO added** (user chose Google + Apple only; auto-link by email; default role = buyer).
- **Backend** — new `backend/routers/sso.py` with two endpoints:
  - `POST /api/auth/session` — Emergent Google exchange. Client posts a one-time `session_id`; server calls `demobackend.emergentagent.com/auth/v1/env/oauth/session-data` with `X-Session-ID`, reads email + name, upserts a user (linking to any existing account with the same email), returns the SAME `AuthOut` shape (`{token, user}`) as `/auth/login` so no dual-token system exists.
  - `POST /api/auth/apple` — verifies Apple's identity JWT against `https://appleid.apple.com/auth/keys` (JWKS cached 1h), checks `iss=https://appleid.apple.com` and `aud ∈ APPLE_AUDIENCES` (set in `backend/.env`), then upserts by `apple_sub`, then by email if no sub match. Handles Apple's "name/email only on first sign-in" rule by persisting whatever the client sent on that first call.
  - Shared helper `_upsert_and_issue_jwt` — one place where new SSO accounts are created with `role="buyer"`, `hashed_password=None`, and `providers.<google|apple>.sub`. Auto-link precedence: same provider sub → same email → new account.
- **Password login guard** — `POST /api/auth/login` now surfaces a clear "This account signs in with Google/Apple. Tap Continue with … above." error instead of the generic "Invalid email or password" when someone types a password for an SSO-only account.
- **Frontend** — new `frontend/src/lib/sso.ts` and `frontend/src/components/SsoButtons.tsx`:
  - Google works everywhere (Expo Go, native builds, web). Uses `expo-web-browser` + `expo-linking` on mobile with de-dupe guard + listener/getInitialURL fallback for Android's flaky Custom Tabs "dismiss on success" behaviour. On web it does a full-page navigate; `AuthProvider` reads `#session_id=…` on mount via `consumeGoogleColdStart()`.
  - Apple gated behind `isAppleSignInAvailable()` (iOS only). Uses `expo-apple-authentication@8.0.8`; iOS-only button is hidden on Android/web.
  - `AuthProvider` gets `loginWithGoogle()` and `loginWithApple()`; both hit the new backend routes and adopt the returned JWT via the existing `setToken` path.
  - Login screen shows the SSO strip above email/password. Register screen shows it only on the Buyer path (seller/rider need extra role-specific fields that SSO can't capture).
- **app.json** — `expo.ios.usesAppleSignIn: true` and `"expo-apple-authentication"` plugin. Existing scheme `oromona`, bundle id `com.emergent.fitfinderapp.leor5k` unchanged.
- **backend/.env** — `APPLE_AUDIENCES="com.emergent.fitfinderapp.leor5k,host.exp.Exponent"` (both required per the playbook: standalone builds use the bundle id, Expo Go uses `host.exp.Exponent`).
- **Verified end-to-end** — login screen renders both buttons, clicking Google redirects to `https://auth.emergentagent.com/` and then to Google's real OAuth consent screen; Apple + password endpoints reject invalid tokens correctly; existing `/api/auth/login` still works.

## Update — June 2026 (Try-On viewer fix + multi-image zoom)
- **Fixed "AI image doesn't fit the screen" bug** — `outfit/result.tsx` and `tryon/byo.tsx` were using a fixed height (60% / 55% of `winH`) plus `resizeMode="contain"`, which letterboxed portrait Gemini renders (9:16 aspect) with wide grey bars. Introduced `frontend/src/components/TryOnResultImage.tsx` which reads real image dimensions via `Image.getSize` and applies `aspectRatio` to the container so the image fills the width with no letterboxing. Container is capped at 70% of screen height and clamped to a minimum 3:5 aspect so extreme portraits can't push the CTAs off-fold.
- **Fixed "no way to swipe between angles in fullscreen" bug** — enhanced `frontend/src/components/ImageZoomModal.tsx` to accept `images?: string[]` + `labels?: string[]` + `initialIndex?: number`. Horizontal `ScrollView` with `pagingEnabled` between images; each page owns its own pinch/pan/double-tap state via a dedicated `ZoomablePage` sub-component. Page-swipe auto-disables when the current page is zoomed (>1x) so the pan-gesture doesn't fight the scroll view. Header shows current label + `1/4` counter; footer shows dot indicators + prev/next arrow buttons (disabled at edges). Single-image usage still works via the legacy `uri` prop — `tryon/byo.tsx` keeps that shape.
- `outfit/result.tsx` now passes all `angles.map(...) → images/labels/initialIndex` so the fullscreen viewer lets users flick through Front / 3-4 / Side / Back with per-angle zoom.

## Update — June 2026 (Try-On Save — private board)
- **New feature: Try-On Save** — shoppers can pin favourite renders to a private "Saved" board and revisit them anytime. Single unnamed board for v1 (like Instagram Bookmarks); multiple named boards can be added later without a data migration (just add a `board` field).
- **Data model** (`backend/models.py`): `TryOnOut` gained `pinned: bool` and `pinned_at: datetime | None`. New `TryOnPinIn` / `TryOnPinOut` models for the toggle endpoint. Existing try-on documents just carry the new keys when the user pins for the first time.
- **Backend** (`backend/routers/tryon.py`):
  - `GET /api/tryon/history` now accepts `?pinned=true` — returns only pinned rows ordered by `pinned_at desc` (the actual "Saved board" query). Without the flag it behaves exactly as before.
  - `PATCH /api/tryon/{id}/pin` toggles pin state; body `{"pinned": true|false|null}` (null = toggle, idempotent). 404 on someone else's try-on, 401 unauth.
- **Frontend**:
  - `frontend/src/lib/api.ts` — `tryOnHistory({pinned?})` + new `tryOnPin(id, pinned?)` method. `TryOnResult` interface carries the new `pinned` / `pinned_at` fields.
  - `frontend/app/(tabs)/tryon.tsx` — new Recent / Saved segmented tabs above the history list. Each history card now has a bookmark button + share button (both amber when active) with optimistic UI toggling and toast confirmation. Distinct empty state when Saved is empty.
  - `frontend/app/outfit/result.tsx` + `frontend/app/tryon/byo.tsx` + `frontend/app/item/[id].tsx` — Save-to-board button rendered on the AI-result view. Copy flips between "☆ Save to my board" and "★ Saved to your board" (item detail uses a bordered mini-button with a bookmark icon).
- **Verified end-to-end**: registered a QA buyer, seeded a try-on doc, listed history (`pinned=false`), toggled via PATCH (server-side flip), saved-board filter returned the pinned row, explicit unpin returned the row to unpinned state, saved-board became empty. Cleaned up the QA user afterwards. Lint clean on every touched file.

## Update — June 2026 (SDK 57 + Doubled trials + Loved-one parity)

### Expo SDK 54 → 57 upgrade
- Unblocks the Expo Go 57.0.0 mismatch users saw on production. `expo` bumped to `~57`, `react-native` to `0.86.3`, `react` to `19.2.3`, `expo-router` to `~57.0.20`, `expo-file-system` to `~57.0.6`, `expo-apple-authentication` to `~57.0.1`, `react-native-reanimated` to `4.5.1`. Ran `yarn expo install --fix` — all peer packages realigned. Metro bundles, welcome + login (with Google SSO button) + try-on tab all boot cleanly on the new SDK. Full frontend ESLint pass.
- Trigger note: after the upgrade Metro needs the OLD long-running `expo start` process killed before restart (stale `metro-config` reference cached). Restart via `sudo supervisorctl restart expo` handles this on production redeploys.

### Doubled free-tier trials (ahead of Google Play 14-day closed test)
- `backend/core/config.py`: `FREE_TRYONS_PER_WEEK: 7 → 14` and `FREE_STYLIST_SESSIONS_PER_WEEK: 2 → 4`. Comment explicitly notes the reason and that they can be dialled back post-launch. `FREE_MAX_PROFILES` intentionally unchanged.
- Frontend copy is dynamic ("weekly try-on limit" without a hard number) so no follow-up UI change needed; stale numeric comments in `stylist.tsx` + `PaywallModal.tsx` tidied.

### Loved-one profile — full parity with self-user onboarding
- Backend: `LovedOneIn` / `LovedOnePatch` / `LovedOneOut` all gained `three_quarter_photo_b64` + `preferred_shoe_size`; router `create_loved_one` + `update_loved_one` persist them and `_lo_doc_to_out` returns `has_three_quarter_photo`. End-to-end curl test: create with all 6 measurements + shoe size + 3 photos returned `has_front_photo`, `has_side_photo`, `has_three_quarter_photo`, `preferred_shoe_size: "39"` all present.
- Frontend: `app/profiles/new.tsx` rewritten to mirror `app/onboarding/measurements.tsx` exactly:
  - Same 3-photo grid (Front / Side / Three-quarter, library + camera + clear buttons per slot).
  - Same `BodyMeasureGuide` silhouette with active-key highlight sweep after AI estimation.
  - Same 6-measurement grid (Height + Shoulders + Chest/Bust + Waist + Hips + Inseam).
  - Same CM ↔ IN unit toggle via `cmToDisplay` / `displayToCm`.
  - Same "Estimate from photos with AI" via `api.estimateMeasurements` when any photo is present.
  - Same preferred clothing size chips (XS–XXL) + preferred shoe size chips (EU 35–47).
  - Retains the loved-one-only header block: audience picker, gender, name, relation, age (with 0–17 validation for kids).
- Verified in preview: navigate to `/profiles/new`, all steps render, "Save profile" pinned at the bottom.


## Update — June 2026 (App Store readiness fixes: 2 blockers + 2 warnings)

### Blocker 1: iOS Reader-app pattern (App Store Guideline 3.1.1)
- iPhone builds no longer surface any external-purchase CTAs for Premium.
- `frontend/app/subscription/index.tsx` — on `Platform.OS === "ios"` for the free tier the price line, "Start 7-day free trial" (card) and "Pay with M-Pesa" buttons are replaced by a neutral `sub-ios-reader-card` explaining that Premium is managed outside the app. iOS + one-time-pass tier similarly hides the "Extend 30 days" button. Fine-print copy adjusted per state.
- `frontend/app/(tabs)/profile.tsx` — the "Try Oromona Premium free · KSh 199/mo" upsell card on the buyer profile is fully hidden on iOS + free tier; premium users still see the status/manage card.
- `frontend/src/components/PaywallModal.tsx` — on iOS the modal shows a "GOT IT" dismiss button instead of "UPGRADE — 7 days free", and does not route to `/subscription`.
- Android and web behaviour is unchanged; Paystack card + M-Pesa checkout still work as before.

### Blocker 2: Sign in with Apple — refresh token exchange + revocation (Guideline 5.1.1(v))
- Frontend `signInWithApple` now posts `authorization_code` alongside `identity_token` on every Apple login (`frontend/src/lib/sso.ts`).
- Backend `POST /api/auth/apple` (`backend/routers/sso.py`) accepts the new field and, after JWKS verification succeeds, calls `_persist_apple_refresh_token()` which trades the one-time code for a long-lived refresh_token via `https://appleid.apple.com/auth/token` and persists it to `users.providers.apple.refresh_token`.
- New module `backend/core/apple.py` signs the ES256 client_secret JWT (Team ID / Key ID / bundle id / .p8 private key), calls `/auth/token`, and revokes via `https://appleid.apple.com/auth/oauth2/v2/revoke`. Gracefully returns `None`/`False` if any env var is missing (preview builds keep working).
- `DELETE /api/auth/me` (`backend/routers/auth.py`) now revokes the stored Apple refresh_token before wiping the user row. Revocation failures are logged and swallowed — the local deletion always succeeds.
- New env keys (backend/.env): `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID` (defaults to `com.oromona.myapp`), `APPLE_PRIVATE_KEY_P8`. Production build must fill these in.
- Documented in `/app/auth_testing.md` per the Sign in with Apple playbook.

### Warning 1: In-app support link (Guideline 1.5)
- `frontend/app/(tabs)/profile.tsx` — new `profile-contact-support-btn` row between Sign Out and Delete Account. Opens `mailto:support@oromona.com?subject=Oromona%20support&body=…` via `Linking.openURL` (auto-attaches app version, user id and role for context). Falls back to a toast when no mail app is installed.

### Warning 2: Root ErrorBoundary (Guideline 2.1 resilience)
- New `frontend/src/components/ErrorBoundary.tsx` — a React class component wrapping the entire `<Stack>` in `frontend/app/_layout.tsx`. Renders a branded fallback screen with a "Reload Oromona" button on caught render errors. Dev builds also expose the error message for debugging; production hides it.

### Verified via testing_agent iteration_34
- Backend: 14/14 pytest passed. Apple no-op behaviour when creds absent verified; refresh_token seeded → delete flow revokes-then-deletes the user row.
- Frontend: Web/Android path still shows price + Paystack CTAs on `/subscription`; new `profile-contact-support-btn` renders in the expected position; ErrorBoundary invisible during normal use.

## Hotfix — June 2026 (Blank welcome screen on tester devices)

### Root cause
Testers on Android + Expo Go reported an entirely blank amber gradient with no logo, headline, or buttons. Two contributing factors:
1. `@expo-google-fonts/{cormorant-garamond,manrope}` at 0.4.x is not fully compatible with Expo SDK 57 and can silently fail on some Android + Expo Go builds. Our own system guidelines explicitly warn against these packages.
2. Icon fonts were being pulled from a jsDelivr CDN inside Expo Go; on slow/filtered networks (common in Kenya on mobile data) the CDN request hangs forever, keeping `iconsLoaded=false` and the whole app on a null render.

### Fix
- **Local .ttf bundling** — Copied all 7 Cormorant Garamond + Manrope .ttf files from `node_modules/@expo-google-fonts/*` into `frontend/assets/fonts/` and load them via `expo-font`'s `useFonts` in `_layout.tsx`. Metro now embeds them into the JS bundle, so there is no network dependency at startup.
- **Removed dependencies** — `@expo-google-fonts/cormorant-garamond` and `@expo-google-fonts/manrope` deleted from `package.json`.
- **Icon fonts locally bundled too** — `src/hooks/use-icon-fonts.ts` now `require()`s Feather / Ionicons / MaterialIcons / MaterialCommunityIcons / AntDesign directly from `@expo/vector-icons`, replacing the CDN URL fallback that only kicked in under Expo Go. This works in dev, Expo Go, native builds and web.
- **4-second timeout safety net** — `_layout.tsx` now unblocks the app after 4 seconds even if fonts never resolve. Better a working UI with system fallback typography than a permanently blank welcome page.
- **SplashScreen error swallowing** — `preventAutoHideAsync()` and `hideAsync()` are wrapped in `.catch(() => {})` so a splash-related exception can never dead-end the app on web/older Android.

### Tester note
Existing builds still have the old font stack — testers must open the latest deployed version (or reinstall from a fresh QR code) to pick up the hotfix.


## Update — June 2026 (Editable Loved Ones)

### What shipped
- **Backend**: New `GET /api/loved-ones/{profile_id}` endpoint returning a `LovedOneDetail` shape that carries the base64 photo strings (`front_photo_b64`, `side_photo_b64`, `three_quarter_photo_b64`) alongside every field of `LovedOneOut`. The list endpoint keeps returning the slim `LovedOneOut` (no photo bytes) to keep payloads small.
- **API client**: New `api.getLovedOne(id)` + `LovedOneDetail` type mirroring the backend.
- **Frontend edit route**: `frontend/app/profiles/new.tsx` is now a dual create/edit screen driven by an optional `?id=<uuid>` search param. In edit mode it (1) fetches the loved-one via `getLovedOne`, (2) pre-fills every field (audience, gender, name, relation, age, all 6 measurements, preferred size, preferred shoe size, all 3 photos), (3) submits via `PATCH /api/loved-ones/{id}`, (4) shows a "Delete profile" button under "Save changes" that fires a confirm dialog then `DELETE /api/loved-ones/{id}`. Header switches to "EDIT PROFILE" and title to "Edit <name>". Hydration state renders an ActivityIndicator so the form never flashes empty.
- **List affordance**: `frontend/app/profiles/index.tsx` — the loved-one card is now a `TouchableOpacity`; tapping the body OR the new pencil icon navigates to the edit screen. Trash icon and Switch link kept intact with `e.stopPropagation()` so nested taps don't fight.
- **BodyMeasureGuide `kid` variant**: Widened `GuideGender` to `"male" | "female" | "kid"`, added a `kid` entry in `SPECS` (mirrors female positions), added a defensive `SPECS[gender] ?? SPECS.female` fallback, and made `onChangeGender` optional (hidden when not provided so the loved-one flow no longer shows the misleading gender toggle). This eliminated an ErrorBoundary crash previously triggered by tapping the "Child" audience chip.
- **Safe back navigation**: submit now uses `router.canGoBack()` before falling back to `router.replace("/profiles")` — deep-linked edit sessions no longer emit "GO_BACK not handled" warnings.

### Verified via testing_agent (iteration 35 + 36)
- Backend: 10/10 pytest (GET/POST/PATCH/DELETE + auth + cross-tenant + full CRUD round-trip preserving photos and measurements).
- Frontend: Kid + Adult CRUD round-trip green; edit hydration works; Delete-from-edit-screen dismisses back to the list with the row gone; create flow unchanged.


## Hotfix v2 — June 2026 (Blank welcome, root cause identified)

The previous font hotfix didn't fully resolve the tester's blank welcome page — the fonts were only ONE contributor. The **actual** root cause was a web-only CSS property leaking onto native:

- `frontend/app/(auth)/welcome.tsx` had `...(typeof window !== "undefined" ? { mixBlendMode: "overlay" } : {})` on the plaster-texture layer.
- `typeof window` is truthy in React Native — RN polyfills a `window` global on both iOS and Android. So `mixBlendMode` was being applied on native as well.
- On the New Architecture (Fabric, `newArchEnabled: true` in `app.json`), Android is strict about unknown style props and silently drops rendering for the affected subtree. Result: the amber gradient still rendered (LinearGradient absolute-fill), but the SafeAreaView containing the logo, title and buttons was blanked out.

**Fix**: Gate on `Platform.OS === "web"` explicitly — the standard React Native way. `mixBlendMode` now stays web-only, the Android subtree renders normally.

Same file also imports `Platform` from `react-native` so the check is authoritative.


## Hotfix v3 — June 2026 (Blank welcome — VERIFIED root cause: RN 0.86 removed `StyleSheet.absoluteFillObject`)

Hotfix v1 (fonts) and v2 (`mixBlendMode`) were speculative and did not fix the tester reports. The verified cause:

- The Sep-9 SDK 54 → 57 upgrade moved React Native 0.81 → 0.86. **RN 0.85 removed `StyleSheet.absoluteFillObject`** (deprecated since 0.82; only `StyleSheet.absoluteFill` remains). `react-native-web` still ships it, so the web preview looked perfect while every native device broke — which is why all previous web-only testing passed.
- The codebase spread `...StyleSheet.absoluteFillObject` in 11 places / 7 files. On native this spread `undefined`, silently dropping `position: absolute`.
- In `welcome.tsx` the plaster-texture `<Image>` lost its absolute positioning, became a flow child at its intrinsic size (704×1520 dp), and pushed the `SafeAreaView` (logo, headline, both buttons) entirely below the screen. The three `LinearGradient`s kept their explicit positions → exactly the "amber gradient with nothing on it" tester screenshot. Users literally could not reach Login/Register.
- Confirmed via `npx tsc --noEmit` (TS2551 on every usage) and by inspecting `node_modules/react-native/Libraries/StyleSheet/StyleSheetExports.js`.

**Fix**
- `src/lib/theme.ts` exports a platform-safe `absoluteFill` object; all 11 usages (`welcome.tsx`, `(tabs)/index.tsx`, `collection/[id].tsx`, `item/[id].tsx`, `outfit/result.tsx`, `DobPicker.tsx`, `OutfitDrawer.tsx`) now spread it. `grep absoluteFillObject` → 0 code hits.
- `(seller)/analytics.tsx` referenced non-existent `tp.bodyMedium` (undefined style) → fixed.
- Deprecated `pointerEvents` prop on the grain `Image` moved into its style.

**Boot telemetry (new, kept)**
- `src/lib/boot-diag.ts` + `POST /api/diag` (`backend/routers/diag.py`, collection `boot_diag`): device posts boot stages (module eval → fonts → route → welcome/login mount → per-block `onLayout` boxes → logo load → global/console/ErrorBoundary errors). Lines appear in `backend.err.log` as `[diag <session>] <platform> …`. Lets us verify device rendering without device access. Instrumented: `_layout.tsx`, `index.tsx`, `(auth)/welcome.tsx`, `(auth)/login.tsx`, `ErrorBoundary.tsx`.

**Rule for future agents**: run `npx tsc --noEmit -p frontend` after ANY SDK/RN bump — TypeScript caught this instantly; web screenshots never will.

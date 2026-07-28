# Oromona — Full Regression: Stripe Purge + Feature Verification

## Original Problem Statement (this iteration)
User asked us to:
1. **Fully purge Stripe** from the codebase (was mostly dead code but confusing).
2. Then run **comprehensive testing** covering:
   - AI multi-angle try-on capture with free vs premium limits.
   - Login for new buyers.
   - Try-on fit matching against physical images at all angles.
   - Try-on slider.
   - Multi-item purchase + layering.
   - Recommended sizes matching user dimensions.
   - Seller registration + add-item flow.

After tests pass the user will republish & deploy.

## What Changed in This Iteration

### Stripe purge — backend
- `/app/backend/core/config.py` — removed `STRIPE_API_KEY` and `CONNECT_MOCKED_NOTE`.
- `/app/backend/.env` — removed `STRIPE_API_KEY` line.
- `/app/backend/requirements.txt` — removed `stripe` SDK (pip uninstall + freeze).
- `/app/backend/routers/seller.py` — removed `POST /seller/connect/setup` and `GET /seller/connect/status` endpoints. Removed `_is_real_stripe_key`, `_try_import_stripe`, `_OnboardLinkIn`. Removed `uuid` import.
- `/app/backend/routers/admin.py` — removed `connect_status` field from `AdminUserPatch`. Removed `ConnectStatus` import. `pending_connect_sellers` metric now counts sellers without a `paystack_recipient_code`.
- `/app/backend/models.py` — removed `stripe_account_id` from `UserOut` and `ConnectStatusOut`. Removed from `user_to_out()`. Updated Stripe comment to Paystack.
- `/app/backend/routers/seller.py` — analytics + payouts endpoints now derive `connect_status` from `paystack_recipient_code` presence.
- `/app/backend/tests/test_iteration7_refactor.py` and `test_iteration8_order_detail.py` — moved to `.deprecated` (they exercised the removed endpoints).

### Stripe purge — frontend
- `/app/frontend/app/seller/` (legacy duplicate route folder) — moved to `/tmp/legacy_seller_backup` (no code references it).
- `/app/frontend/src/lib/api.ts` — removed `stripe_account_id` from `User` and `ConnectStatus`. Removed `connectStatus()` and `connectSetup()` API bindings. Removed `connect_status` from `adminPatchUser` body.
- `/app/frontend/app/(seller)/analytics.tsx` — no longer calls `api.connectStatus()`. Uses `has_recipient` from `api.sellerGetPayoutAccount()` for the payout onboarding banner.
- `/app/frontend/src/components/AddressPickerSheet.tsx` — comment cleaned (Stripe → Paystack).

### Prior work still in place (from earlier phases in this job)
- 15% platform fee (`PLATFORM_FEE_BPS = 1500`).
- Paystack banks/subaccount/transfer helpers in `core/paystack.py`.
- Escrow lifecycle + 48h sweeper in `core/escrow.py`.
- Seller payout dashboard + payout-account screen (Kenya banks + M-Pesa).
- Delivery tracking + carrier detection + buyer confirm/dispute UI.
- Item variants (size × colour with per-combo quantity and price override).
- Buyer currency picker + size setup banner + recommended-size confirmation.
- Multi-angle body capture with free/premium gating.

## Test Credentials
- Admin: `admin@oromona.com` / `oromona-admin-2026`
- Buyer: `buyer@aurafit.com` / `demo-buyer-2026`
- Seller: `atelier@aurafit.com` / `demo-seller-2026`
- New buyers must sign up via the welcome flow; use `.com` emails (Paystack rejects `.demo`).

## Backend Confirmation Already Done (this session)
```
GET /api/seller/connect/status → 404 (endpoint removed)
GET /api/seller/payouts        → 200; platform_fee_bps=1500
GET /api/seller/analytics      → 200; connect_status derived from payout account presence
GET /api/seller/banks?country=kenya → 99 banks
```

## What to Test — Full App Regression + Feature Coverage

### 1. Login + new buyer signup
- POST /api/auth/register (buyer role) with a fresh `.com` email → 200, token returned, user in DB with role=buyer.
- POST /api/auth/login for the new buyer → 200; `role: 'buyer'`.
- Frontend welcome → create-account → email/password → land in buyer discover feed.

### 2. Multi-angle body capture (free vs premium gating)
- Free users: can complete 7 tryons/week and up to 2 profiles (see `FREE_TRYONS_PER_WEEK = 7`, `FREE_MAX_PROFILES = 2` in `core/config.py`).
- Premium: up to 10 profiles.
- Endpoints:
  - POST /api/tryon (or the current tryon route) — respects weekly gate.
  - POST /api/profiles — respects the 2/10 profile cap.
- Frontend flow: `/app/frontend/app/onboarding/measurements.tsx` (multi-angle capture) + gating banner via `PaywallModal`.
- Verify: 8th tryon in a week → 402 or 429 (paywall) response.

### 3. Physical image try-on quality
- POST /api/tryon returns a Gemini-generated image where the garment is composed onto the user's body photos.
- Confirm: response contains base64 image; endpoint accepts front/side/back angles.
- This is Gemini Nano Banana via Emergent Universal Key — do NOT change model params. Just verify the API completes and returns a valid image.

### 4. Try-on slider
- The item detail screen `/app/frontend/app/item/[id].tsx` exposes a before/after slider between the user's body photo and the try-on result.
- Verify: slider renders, drag/pan gesture works, ends stay within track bounds.

### 5. Multi-item purchase / layering
- The buyer can layer multiple tryon results — e.g. try shoe A, then try shirt B on the same body photo.
- Verify: layering does not overwrite the base photo permanently in state; each new try-on is a separate composition.
- API side: repeated /api/tryon calls with different `item_id`s all succeed within the free weekly quota.

### 6. Sizes match user dimensions
- Onboarding measurements screen `/app/frontend/app/onboarding/measurements.tsx` accepts chest/waist/hip/height/inseam.
- Recommended-size confirmation card renders after entering measurements and matches sizes on stocked items.
- Item detail screen shows the buyer's `preferred_size` (from user profile) as pre-selected size chip when available.

### 7. Seller registration + add clothes flow
- POST /api/auth/register with role=seller + company_name + location (see `/app/backend/routers/auth.py`).
- Frontend: welcome → Create Account → Seller → form → land in seller portal.
- Add-item flow: `/app/frontend/app/(seller)/add-item.tsx` — verify wizard steps:
  - Upload photos.
  - Name / description / brand.
  - Category / subcategory.
  - Sizes (multi-select).
  - Colors (custom named + hex).
  - Price + currency.
  - Garment dimension fields.
  - Variants auto-generation (size × color).
  - Save → item appears in seller's inventory list.

### 8. Regression: All previously green flows
- Buyer purchase flow (Paystack item checkout) end-to-end using test card `4084 0840 8408 4081`, CVV `408`, OTP `123456`, PIN `1234`.
- Subscription flow (Paystack subscription) using same test card.
- Order tracking / delivery confirmation / dispute report / escrow release.
- Seller payout account setup — with a fake account number, verify graceful error (no 500).
- 15% platform fee applied on paid orders.

## Not Mocked
- Paystack test keys in preview `/app/backend/.env`. Real Paystack sandbox calls happen.
- Gemini image generation via Emergent LLM Key — real image bytes returned.

## Do NOT
- Do NOT create a real Paystack transfer recipient with a real bank account.
- Do NOT change frontend `.env` (preview URL is correct for smoke testing).
- Do NOT modify metro.config.js.

## Note on frontend environment
Frontend `.env` currently points at preview (`https://fit-finder-app-5.preview.emergentagent.com`) with TEST Paystack keys. This is intentional for regression testing. Deployment (via Emergent Publish) will bake production URL into the deployed bundle separately.

---

# Iteration 26 — Seller add-item crash fix + shared community categories + variant grid completion

## What changed
- Backend `routers/categories.py`: compact slugify (collapses spaces/punctuation), fuzzy duplicate resolution (plural + difflib ≥0.85) in `find_canonical()`, `GET /api/categories?q=` search.
- Backend `routers/items.py`: `PATCH /api/items/{id}` now canonicalises `category`; explicit `variants` get UUIDs on create and preserve prior ids by (size,colour) on patch; `sizes[].available_qty` roll-up recomputed from variants.
- Backend `core/variants.py`: new `rollup_sizes_qty()`.
- Frontend `src/lib/api.ts`: `CategoryRow` type, `listCategories`/`createCategory` bindings, `itemTotalQty()` helper.
- Frontend `(seller)/add-item.tsx`: category picker now loads shared catalog from API, search-as-you-type + "Add 'X' as a new category" affordance, per-variant price override input in the variant grid. Crash (`pickedColors is not defined`) resolved — matrix JSX lives in StepSizing.
- Frontend `(tabs)/index.tsx`: buyer category chips load from `GET /api/categories` (community categories discoverable), stock badge uses variants-authoritative `itemTotalQty`.

## Verified this session (main agent, backend curl + browser automation)
- POST /api/categories: "Swimwear" → slug `swimwear`; "swim wear"/"Swimwears"/"swimware" all resolve to same row with audiences merged.
- GET /api/categories?q=swim → returns swimwear. GET /api/items?category=swimwear returns the item.
- POST /api/items with free-text category "Swim Wear" → stored `swimwear`, usage_count bumped; explicit variants got unique UUIDs; price_cents_override persisted.
- PATCH /api/items category "swimwears" → stays `swimwear`; variant ids preserved; sizes roll-up = variant sums (disabled excluded).
- Frontend: seller login → add-item wizard step 1→2→3 → category search "swim" shows Swimwear chip + Add affordance → variant grid open, qty/price-override/disable edited → Publish OK, item in inventory. NO `pickedColors` crash.

## Still to test (testing agent)
- Full regression per "What to Test" section above (iteration 25 list) + category/variant flows on fresh accounts.
- Buyer item-detail variant selection: stock per combo, disabled combos unselectable, override price charged at checkout.
- Shoes listing with EU size labels + variant grid.

## Iteration 26 — testing agent result (PASSED 15/15 backend + frontend P0 verified)
- Report: /app/test_reports/iteration_26.json, pytest: /app/test_reports/pytest/iteration26_results.xml
- Post-test fixes by main agent (self-verified via browser automation):
  - Deleted leaked testkikoy* categories and TEST_Kitenge items from DB.
  - Removed dead SYSTEM_SLUGS in routers/categories.py.
  - item/[id].tsx: disabled (size×colour) combos no longer silently substitute another colour — buyer sees greyed swatch + "unavailable in this size" + Out of stock + disabled Buy; price override (KSh 2,500 vs base 2,000) verified on Buy button.
  - Shoes wizard sizing verified: EU chips with cm sub-labels.

## Iteration 27 — Per-colour item photos
- `models.py` ColorOption + api.ts ColorOption: optional `image_b64` per colour (data-prefix stripped on save in items POST/PATCH).
- Seller wizard: each picked colour chip has a camera button (testID `wizard-color-photo-{name}`) → library picker → thumbnail replaces icon; photo submitted with colors[].
- Buyer item detail: hero image priority = try-on result > selected colour's photo > primary image.
- Verified via browser automation: attach flow + hero swap (Black/Rose). Temp items cleaned up.

## Iteration 27b — LIVE mode switch (user-requested)
- Paystack LIVE secret+public keys installed in backend/.env (user consent given; app not on stores; only user's own card/M-Pesa in play). Premium plan reused from live account: PLN_hujyxez42urid36.
- Verified with live keys: startup plan bootstrap OK, GET /seller/banks (Kenya list incl. M-PESA) OK, POST /payments/checkout returns real checkout.paystack.com URL (initialization only — NEVER complete payments in tests from now on).
- Resend: rotated key installed, sender no-reply@oromona.com, domain oromona.com status=verified (checked via Resend API), test send 200, forgot-password email delivered id=7d0ffc9e (no more sandbox recipient restriction).
- ⚠️ TESTING RULE GOING FORWARD: payments are LIVE — initialization-only assertions, no test cards, no transfers.

## Iteration 28 — Colour-aware try-on, size charts, min-1 measurements, confirm-received
### Changes
1. Try-on colour fidelity + face accuracy:
   - `TryOnIn.color_name` (models.py); /api/tryon uses the selected colour's photo as garment reference when present + colour instruction in prompt.
   - `IDENTITY_LOCK` prompt block added to single/outfit/BYO generators (face must be pixel-faithful, no AI face swaps).
   - item/[id].tsx passes `color_name: selectedColor?.name` to api.tryOn.
2. Category-aware size charts (`/app/frontend/src/lib/size-charts.ts`):
   - Charts: letters XS–XXL, kids ages, Waist-inches 28–44 (cm hints), UK 6–18 women, Bra 32A–40D (underbust hints), Underwear S–XXL (waist hints), Socks EU ranges, One Size.
   - `chartsFor(category, subcategory, audience)` picks defaults (men/unisex pants → waist; women pants → UK; sub "Bra & Lingerie" → bra; "Socks"/"Underwear" subs added to taxonomy). Seller can override via "Size system" chips (testID wizard-chart-{key}). Edit-mode detects chart from existing labels (detectChartKey). Stale size labels pruned on chart/taxonomy switches.
3. Measurements min-1 rule: matrixErrors now requires ≥1 filled dimension per size (any of them), error key `{label}-_dims`, hint "Fill at least one measurement — any of them". No more "chest Required".
4. Confirm received: POST /api/orders/{id}/confirm-delivery now accepts status shipped OR delivered; escrow confirm sets status→delivered + delivered_at when confirming from shipped. Frontend button shows for shipped|delivered, labelled "I received my item".
### Verified by main agent
- Backend: synthetic shipped order → confirm → 200, status delivered, buyer_confirmed_at set, payout released with 15% fee, NO live transfer (seller_no_recipient logged). Idempotent 2nd call 200. Test rows cleaned.
- Frontend: men's bottoms show waist chart 28–44 w/ cm hints; size 34 detail shows min-1 hint + red error until one measurement filled.
### ⚠️ LIVE PAYSTACK — do NOT complete checkouts or create transfers during testing. Initialization-only.

## Iteration 28 — testing agent PASSED (6/6 backend pytest + all wizard flows)
- Report: /app/test_reports/iteration_27.json (agent labelled it 27), pytest iteration27_results.xml
- Post-test fixes by main agent: ItemCreate.sizes now Field(min_length=1) (empty sizes → 422, verified); expo-image-picker MediaTypeOptions deprecation fixed (mediaTypes: ["images"]).

## Iteration 29 — Search, colour toggle fix, tappable gallery, prominent colour-photo cards
### Root cause of user's "black shows white" complaint
- User's item (Polo Tshirt) had Black/White colours but NO per-colour photos attached — the tiny chip camera icon was too easy to miss. Wizard→publish persistence itself was verified working (TEST_BW_Tee e2e persisted Black photo).
### Changes
1. Discover search: header search icon (discover-search-toggle-btn) → input row (discover-search-input / -apply) → q filter chip (discover-search-filter-chip / -clear). Backend q now $or over name/brand_name/description/subcategory (regex-escaped).
2. Wizard colour photos: replaced tiny chip camera icon with a prominent "COLOUR PHOTOS" card strip (wizard-color-photo-strip; per-colour card testID wizard-color-photo-{name}, shows ADD PHOTO placeholder or photo thumbnail).
3. Buyer item page: gallery now = item photos + colour photos (swatch badge); thumbs are TAPPABLE (sets hero override; colour-tagged thumb also selects that colour); tapping a colour swatch clears the override so its photo shows. Hero priority: try-on > gallery tap > colour photo > primary.
4. Fixed items.py corruption (duplicated trailing lines from an edit glitch — file truncated to line 589).
### Verified by main agent
- Backend q search (polo/denim). Wizard e2e publish persists colour image_b64. Buyer flow: search chip, item open, Black swatch → black hero, gallery thumbs visible w/ swatch badge, thumb tap → white hero. Colour card strip renders in wizard.
### ⚠️ LIVE PAYSTACK — initialization-only payment tests, never complete a charge.

## Iteration 29 — testing agent result + post-fixes
- Backend 15/15 PASS (test file /app/backend/tests/test_iteration29_search_regression.py, report /app/test_reports/iteration_28.json).
- Testing agent found + fixed: q-search regex escape/$or had been lost during the items.py corruption repair (truncation reverted the edit) — re-applied by test agent, verified in code (line ~154 re.escape + $or over name/brand_name/description/subcategory).
- Testing agent found frontend bug: Discover header greeting wrapped char-by-char at 390px. Main agent fix: removed duplicate logo image (OROMONA caption remains), headerTitle 17px + numberOfLines=1, iconBtn padding 6. Verified via screenshot — one-line header with search/bookmark/KES/bell/avatar all fitting.
- Remaining cosmetic (deferred): RN-web deprecation warnings shadow*→boxShadow, props.pointerEvents→style.pointerEvents.

## Iteration 30 — M-Pesa Premium pass + Amazon-style colour photo groups
### Changes
1. Subs: POST /api/subs/checkout body {method:'card'|'mpesa'}; mpesa = one-time mobile_money charge (channels=["mobile_money"], purpose=premium_once) granting 30-day Premium pass that EXTENDS on repeat purchase; card = plan subscription w/ 7-day trial. one_time in /subs/me; /subs/cancel 400 for pass holders; webhook charge.success grants pass when purpose=premium_once; is_premium() expires stale passes; subscription/index.tsx has sub-upgrade-btn + sub-mpesa-btn + sub-channel-note + sub-extend-btn/sub-pass-status for pass holders; success.tsx shows pass expiry.
2. Colour photo groups: ColorOption.images (max 5, hero-first) + image_b64 mirror via items.py _normalize_color; wizard step 3 ColorPhotoGroup cards (wizard-color-group-{name}, add/camera/reuse/remove testIDs, COVER badge); item/[id].tsx gallery = selected colour group first → general photos → other colours' heroes; hero = colour group[0].
3. Repaired two leftover file-tail corruptions from previous session (subs.py pay_web_submit dangling fragment; add-item.tsx duplicated style tail).
### Verified
- Testing agent iteration 30: backend 13/13 PASS (tests/test_iteration30_subs_mpesa_color_photos.py, report /app/test_reports/iteration_29.json); /subscription UI both buttons verified; item colour swatch swap OK.
- Main agent browser check: wizard step 3 shows per-colour groups, reuse-tap moved general photo into Black group w/ COVER badge + remove btn; White group shows honest fallback hint.
### ⚠️ LIVE PAYSTACK — initialization-only payment tests, never complete a charge, no transfers/recipients.

## Iteration 31 — Two user-reported P0 bug fixes
1. **AI try-on 500 (core feature)**: `IDENTITY_LOCK` was referenced in routers/tryon.py (4 sites, since iteration 28) but its DEFINITION was never present (lost in a prior corrupted edit session) → NameError → 500 on every /api/tryon call. Fixed: constant defined near SIZE_ORDER. Verified live: POST /api/tryon front angle → 200 with generated image (cleared demo buyer's 21 stale test try-on records that had exhausted the weekly free cap).
2. **"I received my item" button dead on web**: order/[id].tsx used Alert.alert with a button list — a SILENT NO-OP on react-native-web. Added `/app/frontend/src/lib/confirm.ts` (`confirmDialog`: window.confirm on web, Alert.alert on native) and wired the confirm-delivery button to it. Other 4 Alert.alert call sites already had web guards. Verified e2e in browser: click → confirm dialog → 200 → "Delivery confirmed by you" timeline + escrow banner (TEST_checkout order flipped to shipped for the test; no live transfer occurred — seed seller has no recipient).
### Note
- Beware: previous session left multiple file-tail corruptions (subs.py, add-item.tsx) and this missing-constant bug — check `git diff`/log references when a feature 500s unexpectedly.

## Iteration 31b — Phase 1 Courier System (zone fees, rider role, jobs, earnings)
### Built
1. Zone fees from Nairobi CBD (core/delivery.py + routers/delivery.py): nairobi_inner 300 / nairobi_outer 600 (CBD→Karen anchor) / nairobi_metro 900 / major_towns 500 / rest_of_kenya 700 KSh; free delivery ≥ KSh 20,000 (platform absorbs); "Pick up at Nairobi CBD point" = KSh 0; fees KES-only. Admin-editable: /api/admin/delivery-zones + /admin/delivery-settings (threshold + platform bps, default 10%).
2. Checkout: POST /payments/checkout accepts delivery_option door|pickup; charges item+fee; order stores delivery_fee_cents/zone/total_charged_cents (amount_cents stays item-only so 15% commission unchanged). AddressPickerSheet has DELIVERY METHOD panel (checkout-delivery-door/pickup, checkout-total-row) with live quote.
3. Courier role: register role=courier (phone required, mpesa optional) → courier_status pending; admin approve/reject at /admin/couriers (bumps token_version → re-login); login/index redirect courier → /(courier); toggle-role immune for courier+admin.
4. Delivery jobs: seller "Request rider pickup" (action request_courier, door orders, paid|in_fulfillment) → job open on rider board; accept atomic (409); picked_up (order→shipped, carrier "Oromona Rider"); out_for_delivery; deliver requires buyer's 4-digit handover_code → order delivered + 48h escrow window + rider earning (90% of zone fee). Buyer order page shows courier card + handover code (buyer-only, order-handover-code) + call-rider btn.
5. Courier portal /(courier): jobs board, job detail w/ code entry, earnings (today/pending/paid ledger); admin mark-paid records end-of-day M-Pesa payout batch.
### Verified
- Main agent smoke /app/backend/tests/smoke_courier_phase1.py — 20/20 lifecycle steps pass.
- Testing agent iteration 30 (report /app/test_reports/iteration_30.json): backend courier suite + quote matrix + checkout order fields PASS; found 2 frontend bugs.
- Bugs fixed post-report: (a) login.tsx missing courier redirect branch; (b) register.tsx registerCourier destructure lost in an earlier same-file parallel-edit race → "registerCourier is not defined". Both re-verified in browser: rider registration → pending card; approved rider login → portal.
### Notes / gotchas
- /user/toggle-role FLIPS role each call regardless of body — check /auth/me first.
- DO NOT run parallel search_replace edits against the SAME file — hunks silently race away (bit this session twice).
- Approved rider creds: test_rider_fc0de2@test.com / rider-pass-123 (see memory/test_credentials.md).

## Iteration 32 — Interactive measurement guides (buyer silhouettes + seller garment diagrams)
### Built
1. `/app/frontend/src/components/MeasureGuideParts.tsx`: MeasureLine (SVG double-arrow line + label, dashed grey inactive / solid black active) + PulseHalo (RN Animated pulsing ring over the active line midpoint; useNativeDriver disabled on web).
2. `/app/frontend/src/components/BodyMeasureGuide.tsx`: gender-based (male/female) SVG body silhouettes with labelled arrows for height/shoulders/chest/waist/hips/inseam; legend with live values (unit-aware via cmToDisplay); how-to-measure hint per active field. testIDs: body-measure-guide, guide-gender-male/female, guide-legend-{key}, guide-hint.
3. `/app/frontend/src/components/GarmentMeasureGuide.tsx`: garment-type-adaptive flat-lay diagrams (top/dress/skirt/trousers/shorts/belt/tie/scarf) with arrows for exactly the DIMENSION_KEYS_BY_TYPE dims; legend + DIMENSION_HINTS hint. testIDs: garment-measure-guide, garment-legend-{key}, garment-guide-hint.
4. onboarding/measurements.tsx: guide card inserted above the input grid; each UnitInput got onFocus/onBlur → highlights matching arrow; after AI estimate the applied keys animate sequentially (900ms apart) then clear.
5. add-item.tsx StepSizing: guide rendered above per-size dimension grids (only when garment has dims); DimField got onFocus/onBlur → setActiveDim.
### Verified by main agent (browser screenshots)
- Buyer male guide + waist focus highlight/halo/hint; female silhouette + hips highlight; seller trousers diagram + rise focus highlight/hint (edit Selvedge Denim → step 3).
### Gotchas hit this session
- LOGIN INTENT CHIP FLIPS ROLES: logging in atelier@aurafit.com with the default "buyer" chip TOGGLED the demo seller to buyer (restored via DB + seller-intent login). Always click login-intent-seller for the seller account.
- Playwright force-click on RN-web TextInput does not always fire focus — use locator.focus().
- PRE-EXISTING dead routes discovered (NOT fixed, awaiting user go-ahead): "/seller", "/seller/new-item", "/seller/new-collection", "/seller/analytics", "/seller/onboarding" referenced in (tabs)/atelier.tsx, (tabs)/profile.tsx, (auth)/login.tsx, HeaderMenu.tsx → Unmatched Route (no app/seller dir; real routes are /(seller)/*).
### ⚠️ LIVE PAYSTACK — initialization-only payment tests, never complete a charge, no transfers/recipients. Do NOT call AI try-on/estimate endpoints (LLM cost + weekly cap).

## Iteration 33 — Dead seller links fixed + buyer item "measurement map"
### Changes
1. Restored two screens deleted in the July-23 seller-portal restructure (commit 473464c) whose links were left dangling:
   - `/app/frontend/app/seller-onboarding.tsx` (was app/seller/onboarding.tsx) — buyer→seller 1-screen onboarding (company/city + optional payout), submits toggleRole → /(seller).
   - `/app/frontend/app/(seller)/new-collection.tsx` (was app/seller/new-collection.tsx) — "Curate a drop" collection builder; registered in (seller)/_layout as hidden tab (href: null).
2. Repointed all dangling "/seller/*" pushes: atelier.tsx (Dashboard→/(seller), Drop→/(seller)/new-collection, New→/(seller)/add-item), profile.tsx (dashboard→/(seller), analytics→/(seller)/analytics, onboarding→/seller-onboarding), login.tsx + HeaderMenu.tsx (onboarding→/seller-onboarding). Zero "/seller/*" refs remain.
3. GarmentMeasureGuide extended (backwards-compatible optional props): values (per-dim numbers shown in legend), unit ("cm"|"in"), onSelectKey (makes legend rows tappable, tap active row to clear). Seller wizard usage unchanged.
4. Buyer item page (item/[id].tsx): after selecting a size, a "See where size X is measured" toggle (item-measure-guide-toggle) expands the garment diagram with the selected size's dimensions in the legend (unit follows the cm/in toggle); tapping a legend row highlights the arrow + shows the measuring hint.
### Verified by main agent (browser)
- Buyer: Selvedge Denim → size S → measurement map open → Waist row tap → arrow highlight + halo + "Waist — Around narrowest point, flat × 2" + values 76cm/96cm/—/—.
- /seller-onboarding renders restored form; /new-collection renders NEW DROP inside seller tab shell.
- Seller regression: edit wizard step 3 rise focus still highlights + hints (post component change).
- RBAC note: sellers deep-linking to buyer tabs are bounced to /(seller) by design — the fixed atelier/profile links now bounce unauthorized roles gracefully instead of 404 "Unmatched Route".

## Iteration 34 — Compare-with-body + KES as standard currency
### Changes
1. **Compare with my body** (buyer measurement map): GarmentMeasureGuide got optional `compareText` prop (testID garment-guide-compare); item/[id].tsx computes it from the fit score's per-dimension body/diff for the highlighted key of the selected size ("Your waist: 81cm — this size runs 5cm smaller" / "roomier" / "exact match"; cm/in aware). Only shows when the buyer has the matching body measurement.
2. **KES standard currency always**:
   - Removed device-locale currency auto-switching entirely (deleted src/lib/locale.ts, syncCurrencyToLocale, region suggestion in registerBuyer/registerSeller — both now send preferred_currency "KES").
   - Frontend getCurrencyMeta fallback USD→KES; backend models.py item/order currency defaults "USD"→DEFAULT_CURRENCY (=KES config).
   - DB migration: ALL 52 users now preferred_currency=KES (16 flipped; they were GBP/EUR/INR/USD/None from old locale sync).
   - Manual picker kept (header pill + Profile → Region & Currency).
3. **Currency sheet scroll fix** (user: "slider refuses to go up that high"): CurrencyPill FlatList had no bounded height → RN-web let it grow inside the clipped sheet and it refused to scroll. Fixed with style listBox {maxHeight:420, flexGrow:0} + visible scroll indicator. KES remains first row.
4. Demo buyer (buyer@aurafit.com) now has full measurements seeded (170/92/81/98/44/78) — fit preview/narration/compare all light up on trousers.
### Verified by main agent (browser)
- Pill shows KES; sheet scrolls down to EGP and back up to KES; compare line renders on Selvedge Denim size S waist.
### Note
- Registration code paths changed (locale removal) — regression-test register buyer + seller.

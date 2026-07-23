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

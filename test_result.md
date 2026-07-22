# Oromona - Item Purchase Migration: Stripe → Paystack

## Original Problem Statement
User (Kenya-based) reports that Premium subscription (Paystack) works and deducts real money, but the regular item-purchase flow shows a Stripe checkout popup that ONLY accepts test cards ("Your card was declined. Your request was in test mode..."). The item-purchase flow needs to migrate from Stripe (which doesn't work in Kenya) to Paystack.

## What Changed
1. Rewrote `/app/backend/routers/payments.py` to use Paystack for item purchases instead of Stripe.
2. Added `POST /api/payments/checkout` — creates a Paystack one-shot transaction (channels: card, mobile_money, bank).
3. Added `GET /api/payments/paystack-return` — Paystack callback bridge that verifies + updates order + deep-links to `oromona://checkout/result`.
4. Kept `GET /api/payments/status/{session_id}` — polls Paystack for order status; `session_id` is now the Paystack reference.
5. Updated `/api/subs/webhook` to ALSO handle item-purchase `charge.success` events (since Paystack Dashboard has one webhook URL).
6. Fixed the callback URL builder to always produce HTTPS from `X-Forwarded-Host`/`X-Forwarded-Proto` (Paystack Live 403s on HTTP callbacks).

## Test Credentials (in /app/memory/test_credentials.md)
- Admin: admin@oromona.com / oromona-admin-2026
- Various buyer/seller accounts seeded

## Backend URLs
- Preview: https://fit-finder-app-5.preview.emergentagent.com
- Deployed (production): https://fit-finder-app-5.emergent.host (user has clicked Deploy)

## What to Test (Backend Only)
1. `POST /api/payments/checkout` — authenticated buyer creates a checkout for an item. Assert response has `session_id` (starts with `oromona_order_`) and `url` (contains `paystack.com`). Assert a `pending` order is created in `db.orders` with `session_id == reference`.
2. `GET /api/payments/status/{session_id}` — authenticated buyer polls status. Should return `pending` initially; after Paystack verification (may not be reachable in tests but shouldn't crash).
3. `GET /api/payments/paystack-return?reference=<invalid>` — Should return 502 or 400 with the branded HTML page (Paystack verify will fail for random reference).
4. `GET /api/payments/paystack-return` (no reference) — Should return 400 with the "Missing reference" HTML.
5. `POST /api/payments/webhook` (no signature) — Should return 401.
6. `POST /api/subs/webhook` with a mock item-purchase event (`event=charge.success`, `data.reference=oromona_order_...`) — the endpoint short-circuits with `{"status":"ok","kind":"item_purchase"}` if signature verifies. Since signature won't verify in tests, expect 401.
7. Confirm `/api/subs/health` still works and shows Paystack config state.
8. Confirm all subscription endpoints (`/api/subs/*`) still function.

## Files of Reference
- /app/backend/routers/payments.py (COMPLETELY REWRITTEN — Stripe → Paystack)
- /app/backend/routers/subs.py (Extended webhook to also handle item purchases)
- /app/backend/core/paystack.py (Paystack REST client — unchanged, reused)
- /app/backend/models.py (CheckoutIn/CheckoutOut — unchanged interface)
- /app/frontend/src/lib/api.ts (Frontend API contract — unchanged)
- /app/frontend/app/checkout/result.tsx (Reads session_id from URL params — supports both browser and deep link)

## NOT Mocked
- Paystack keys in preview .env are REAL TEST keys (sk_test_...). Deployed backend uses LIVE keys.
- All Paystack API calls are real network calls (respect DEFAULT_TIMEOUT=20s).

## Non-Goals for This Test
- Actually initiating a real Paystack payment (would require live keys + real money).
- Frontend UI testing (backend contract testing is enough for this migration).

Please run backend integration tests to confirm:
- No stale Stripe references crash any endpoint.
- All new Paystack-based payment endpoints respond correctly.
- Existing subscription endpoints unaffected.
- Order state transitions correctly.

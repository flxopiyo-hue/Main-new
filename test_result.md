# Oromona — Phase 5: Seller Payout UI + 15% Escrow Model

## Original Problem Statement
Phase 5 completes the seller payout onboarding UI and aligns the platform-fee wording with the new **15%** Paystack escrow model. Legacy "Stripe Connect · 10%" references are removed from all seller-facing screens.

## What Changed (Backend)
- `/app/backend/core/config.py` — `PLATFORM_FEE_BPS: int = 1500` (was 1000). This drives escrow fee math in `core/escrow.py`, `payments.py`, `orders.py`, `seller.py`, `admin.py`.
- `/app/backend/routers/seller.py` — `GET /api/seller/payouts` now returns:
  - `totals.held_cents` and `totals.released_cents` (breakdown by escrow status).
  - `payout_account` snapshot (bank_name, account_number_last4, account_holder, country, ...).
  - `has_recipient` boolean.
  - Per-row: `escrow_status`, `escrow_release_at`, `delivered_at`, `dispute_raised_at`.

## What Changed (Frontend)
- `/app/frontend/app/(seller)/payouts.tsx` — full rewrite. Replaces old Stripe Connect setup card with:
  - "Payout account" pressable card that navigates to `/(seller)/payout-account`.
  - Escrow summary grid (Held / Released / Gross / Fees).
  - Historical payouts with an **escrow pill** per row (`held`, `released`, `disputed`, `cancelled`).
  - Auto-release timestamps for held rows.
  - Help block explaining the escrow lifecycle.
- `/app/frontend/app/(seller)/settings.tsx` — link description updated (no more Stripe Connect / 10% wording), added new "Payout account" quick link.
- `/app/frontend/app/(seller)/analytics.tsx` — banner rewritten. Now says "Set up your payout account" and navigates to `/(seller)/payout-account`. Also checks `has_recipient` from the new payout endpoint.
- `/app/frontend/app/seller/index.tsx` + `/app/frontend/app/seller/analytics.tsx` (legacy routes) — copy updated to remove Stripe wording.
- `/app/frontend/app/(tabs)/profile.tsx` — buyer profile Atelier card no longer mentions Stripe Connect.
- `/app/frontend/src/lib/api.ts` — `PayoutRow` gained `escrow_status`, `escrow_release_at`, `delivered_at`, `dispute_raised_at`. `PayoutHistory` gained `payout_account`, `has_recipient`, `totals.held_cents`, `totals.released_cents`. New `PayoutAccountSnapshot` type.
- `/app/frontend/app/(seller)/payout-account.tsx` — already created in previous session; verified compiles clean and is registered as a non-tab route in `/(seller)/_layout.tsx`.

## Test Credentials
- Admin: `admin@oromona.com` / `oromona-admin-2026`
- Buyer: `buyer@aurafit.com` / `demo-buyer-2026`
- Seller: `atelier@aurafit.com` / `demo-seller-2026`

## Backend Verification Already Done
```
POST /api/auth/login (atelier@aurafit.com) → token
GET  /api/seller/payouts
→ fee_bps: 1500
→ totals: {count: 1, gross_cents: 1690000, platform_fee_cents: 253500,
           net_cents: 1436500, held_cents: 1436500, released_cents: 0}
→ payout_account: None  (seller hasn't set up yet)
→ has_recipient: False
→ sample row keys include: escrow_status, escrow_release_at, delivered_at, dispute_raised_at
→ sample row escrow_status: "held"
```

## What to Test (Both — Backend + Frontend)

### Backend (higher priority)
1. `GET /api/seller/payouts` returns `platform_fee_bps: 1500` (15%) — regression check.
2. `GET /api/seller/payouts` totals include `held_cents` and `released_cents`.
3. `GET /api/seller/payouts` includes `payout_account` and `has_recipient`.
4. Each row includes `escrow_status`, `escrow_release_at`, `delivered_at`, `dispute_raised_at`.
5. `GET /api/seller/banks?country=kenya` returns a non-empty list of Paystack-supported banks/mobile-money entries.
6. `GET /api/seller/payout-account` returns the current shape (payout_account, recipient_code, subaccount_code, has_recipient).
7. `POST /api/seller/payout-account` — safe to test with test bank code + valid test account number. **Do NOT hit live Paystack with real bank details.** The API returns a graceful `ok: false` with `recipient_error` if Paystack rejects.
8. Escrow lifecycle end-to-end (already exercised in phase 4, but re-verify):
   - Paid order → escrow_status: "held", escrow_release_at set to ~48h out after delivery.
   - Buyer confirms delivery → escrow_status: "released".
   - Buyer reports problem → escrow_status: "disputed", no auto-release.
9. Fee math regression: paid orders correctly compute `platform_fee_cents = amount_cents * 1500 // 10000` and `seller_net_cents = amount_cents - platform_fee_cents`.

### Frontend
1. Log in as seller `atelier@aurafit.com` / `demo-seller-2026` → land in seller portal.
2. Settings tab → see two payout links:
   - "Payouts & Escrow" (15% platform fee · Paystack payout · escrow release history).
   - "Payout account" (Bank or M-Pesa · funds release after delivery confirmation).
3. Payouts screen:
   - Header shows "Payouts & Escrow" with escrow blurb.
   - Payout-account card shows CTA to add a payout account.
   - "Escrow summary" grid renders four cards: Held / Released / Lifetime gross / Platform fees.
   - History section shows at least one paid order with a "HELD" pill.
4. Payout account screen (from Settings → Payout account OR from Payouts card):
   - Country picker defaults to Kenya, other countries visible but disabled ("coming soon").
   - Bank/M-Pesa picker loads Paystack banks (non-empty).
   - Account number field accepts input.
   - Help box mentions "15% platform fee" and escrow release.
   - Save button is disabled until bank is chosen + account number ≥ 6 digits.
5. Analytics screen: "Set up your payout account" card CTA navigates to /(seller)/payout-account.
6. Legacy screens: `/seller/index` and `/seller/analytics` — no "Stripe Connect" text visible.
7. **No** "Stripe Connect" or "10% platform fee" strings anywhere in seller-facing screens.

## Not Mocked
- Paystack integration is live (`/app/backend/.env` has real Paystack keys). Backend calls Paystack `/bank`, `/subaccount`, `/transferrecipient` endpoints when the seller submits their payout account.
- Escrow release engine runs a background sweeper (see `/app/backend/core/escrow.py`).

## Non-Goals for Phase 5
- Not testing an actual live Paystack transfer end-to-end (requires real seller bank details).
- Not testing 48h auto-release path (time-based; not realistic to wait).
- Not touching Apple Pay (deferred).

## Notes
- Frontend `.env` intentionally points at the deployed/live backend (`https://oromona.emergent.host`) — do NOT reset to preview during testing.
- Preview backend uses Paystack TEST keys; deployed backend uses LIVE keys.
- The 15% fee change on backend applies immediately to all newly-paid orders and to historical orders' recomputed rows (since backend recomputes fee if not stored).

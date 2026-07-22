# Oromona — Phase 3: Item Variants

## Original Problem Statement
Buyers see duplicate item tiles when a seller has the same T-shirt in multiple sizes/colors. Sellers can't override price per (size × color) or disable specific combos. Add a `variants` layer that resolves both.

## What Changed (Backend)
1. New Pydantic model `ItemVariant` in `/app/backend/models.py`:
   - `{id, size_label, color_name, color_hex, quantity, price_cents_override, disabled}`
2. Added `variants: List[ItemVariant]` to `ItemIn`, `ItemOut`, `ItemPatch`, and `item_to_out`.
3. New module `/app/backend/core/variants.py`:
   - `generate_variants(sizes, colors, existing=None)` — auto-generate variants from a size × color cartesian; preserves quantities/pricing/disabled from `existing` array when combo keys match.
   - `variant_lookup(item, variant_id)` — by id.
   - `find_variant_by_size_color(item, size_label, color_name)` — legacy checkout fallback.
   - `ensure_item_variants(item)` — lazy backfill (idempotent).
   - `backfill_all_variants()` — startup migration to backfill every item once.
   - `group_duplicate_items()` — merges items with same `(seller_id, lowercase(name), brand_name)` — oldest wins, children get `merged_into`.
   - `total_available_qty(variants)`.
4. `models.total_qty()` prefers variants when present.
5. Startup: `bootstrap_item_variants` on-event in `/app/backend/server.py`.
6. `/api/items` `list_items` excludes items with `merged_into` set.
7. `/api/items` `create_item` auto-generates variants when caller doesn't send them.
8. `PATCH /api/items/{id}` regenerates variants when sizes or colors change (preserving prior qty/pricing for combos that still exist).
9. `CheckoutIn` now accepts `variant_id` (optional).
10. `POST /api/payments/checkout` resolves the variant (by id, then by size+color), 409 on disabled/out-of-stock, uses variant's `price_cents_override` if set, stores `variant_id` on the order.
11. New helper `_decrement_variant_stock(order)` decrements variant qty (or legacy size qty) after successful charge — called by both `/api/payments/webhook` and `/api/subs/webhook` for item-purchase events.

## What Changed (Frontend)
- `ItemVariant` type + `variants?` on `Item` in `/app/frontend/src/lib/api.ts`.
- `api.checkout()` accepts optional `variant_id`.
- `/app/frontend/app/item/[id].tsx`: `selectedVariant` useMemo, `availableQtyForSelection`, `chargedPriceCents`; size chip stock aggregates across variants; buy CTA + stock badge respect variant qty and price override; checkout passes `variant_id`.

## Test Credentials
- Admin: `admin@oromona.com` / `oromona-admin-2026`
- Buyer: `buyer@aurafit.com` / `demo-buyer-2026`
- Seller: `atelier@aurafit.com` / `demo-seller-2026`

## What to Test (Backend Only)
1. **Startup migration ran** — GET `/api/items` returns items with populated `variants` arrays (backend logs during startup for `variants bootstrap` line). Existing 4 seed items should each have `sizes × colors` variants.
2. **Variant fields present** — every item has `variants[]` with proper shape (id, size_label, color_name, color_hex, quantity, price_cents_override=None, disabled=False).
3. **Create item** — POST `/api/items` without variants → response includes auto-generated variants matching sizes × colors.
4. **Create item WITH variants** — POST `/api/items` with an explicit variants array → those variants are stored verbatim (no overwrite by auto-gen).
5. **Patch sizes** — PATCH sizes on an item with existing variants → variants are regenerated but any prior qty/pricing preserved for combos that still exist; new combos get default qty.
6. **Patch colors** — same behavior when colors change.
7. **Checkout by variant_id** — POST `/api/payments/checkout` with `variant_id` → order.variant_id populated, response includes valid Paystack authorization URL.
8. **Checkout fallback (legacy)** — POST `/api/payments/checkout` WITHOUT variant_id but with size+color → backend resolves the variant, stores variant_id on the order.
9. **Checkout disabled variant** — should 409.
10. **Checkout out-of-stock variant** — should 409.
11. **Item list excludes merged** — items marked `merged_into=<parent-id>` are filtered out of `GET /api/items` unless explicitly requested via `include_paused=true` context (or another mechanism).
12. **Variant total** — `total_qty(item)` for an item with variants sums enabled variant.quantity, ignoring disabled ones.
13. **Subscription flow still works** — POST `/api/subs/checkout`, `/api/subs/verify`, `/api/subs/webhook`, `/api/subs/health` all unchanged.
14. **`_decrement_variant_stock`** — after a paid item order, the variant's quantity is reduced by 1 (positional array update).

## NOT Mocked
- Paystack test keys in preview `.env` are real test keys, sandbox API calls happen.

## Non-Goals
- Frontend UI testing (variants layer surfaces through existing item detail — no new screens).
- Real payment charging.

## Notes
- Preview backend Paystack mode: TEST. Deployed backend (emergent.host): LIVE.
- The migration on the DEPLOYED backend runs only on next Publish → Deploy.

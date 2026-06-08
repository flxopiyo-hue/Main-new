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
- `POST /api/tryon`, `GET /api/tryon/history`
- `POST /api/payments/checkout`, `GET /api/payments/status/{session_id}`, `GET /api/orders`
- `POST /api/payments/webhook` (Stripe → server)

## Design Direction
Editorial Swiss / High-Contrast: Cormorant Garamond display + Manrope body text, off-white `#FAFAFA` background, sharp 0-radius corners, generous spacing, photos dominate.

## Seeded Data
`/app/backend/seed.py` creates one seller (Maison Lumière) with six garments spanning every category, each with real dimensions per size and 2 colors. Re-running is idempotent.

## Smart Business Hook (next iteration)
**Designer royalty payouts:** Stripe Connect for sellers + monthly auto-payout — turns the platform into a marketplace SaaS.

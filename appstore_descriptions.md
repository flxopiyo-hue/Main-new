# Oromona — App Store & Google Play descriptions

These are the exact strings to paste into your App Store Connect and
Google Play Console listings. Each store has a slightly different
character budget — we've included both.

---

## 1. Apple App Store

### Name (30 chars max)
Oromona: Try On, Then Buy

### Subtitle (30 chars max)
Fashion. Fits you. From Kenya.

### Promotional Text (170 chars max — editable without a new release)
Kenya-crafted fashion, sized to your body. AI try-on, live fit scores and
boda delivery with escrow protection — only pay when it fits.

### Keywords (100 chars — comma-separated, no spaces after commas)
fashion,kenya,tryon,ai,stylist,shopping,clothes,marketplace,boutique,fit,size,style,tailor,dresses

### Short Description / What's the app about
Kenya's boutique that fits you. Try any piece on with AI, get a live
fit score for your body, chat with an AI stylist, and have it delivered
by boda with escrow protection — money moves only when you confirm it fits.

### Full Description (up to 4000 chars)

**Oromona — the boutique that fits you.**

Oromona is a curated fashion marketplace built for Kenya, and made for
your body. Discover pieces from Nairobi ateliers and independent
labels, see exactly how each one looks on you before you buy, and have
it delivered to your door with escrow-protected checkout.

**See it on you — first.**
Add a few measurements once (or let AI estimate them from a photo) and
every listing shows a live Fit Score for your body. Tap "Try It On"
and Oromona's AI renders that piece on you — front, side and back —
photorealistically. Try 20 outfits before you commit to one.

**Shop the whole look.**
Build a full outfit — top, bottom, shoes — and try it on your body as
one composed look. Tuck the shirt in or leave it out. When you love it,
Shop the Look pays every seller in one checkout with a single delivery.

**Your own AI stylist.**
Tell Oromona the occasion — a wedding, a first date, an interview — and
get a personal edit built only from pieces available in your size, in
your budget, from Kenyan sellers. Ask follow-up questions, swap items,
and save your favourite looks.

**Escrow-protected checkout.**
Pay with M-Pesa or card via Paystack. Your money is held in escrow
until the piece is delivered and you've confirmed the fit. If it
doesn't fit as described, you're covered.

**Boda-tracked delivery.**
Nairobi ateliers hand-off to verified riders. You see live pickup and
delivery updates in the app. No guessing where your package is.

**Fair to designers.**
Every seller is verified. They set their take-home price; Oromona's
15% platform fee is added on top and only released to the seller once
you're happy. That means better pieces, honest sizing, and fewer
returns.

**Loved-ones profiles.**
Shopping for a partner, sister or friend? Add their body profile once
and Oromona sizes and try-ons switch to them with a tap — perfect for
gifts that actually fit.

**Made in Nairobi. Sized to you.**

Free to install. Free to try on. Available in KES, USD, GBP and EUR.
Have a question? support@oromona.com

### Support URL
https://oromona.com

### Marketing URL
https://oromona.com

### Privacy Policy URL
https://oromona.com/api/legal/privacy
(Or wherever you host the standalone HTML at /app/oromona_landing.html)

---

## 2. Google Play Store

### App title (30 chars max)
Oromona: Try On, Then Buy

### Short description (80 chars max)
Kenya-crafted fashion, sized to you. AI try-on. Escrow delivery to your door.

### Full description (4000 chars max — same body works for both stores)

**Oromona — the boutique that fits you.**

Oromona is Kenya's curated fashion marketplace, built for your body.
Discover pieces from Nairobi ateliers, see how each one looks on you
before you buy, and have it delivered with escrow-protected checkout.

**See it on you — first.**
Add a few measurements once (or let AI estimate them from a photo) and
every listing shows a live Fit Score for your body. Tap "Try It On"
and Oromona's AI renders that piece on you — front, side and back —
photorealistically. Try 20 outfits before you commit to one.

**Shop the whole look.**
Build a full outfit — top, bottom, shoes — and try it on as one
composed look. Tuck the shirt in or leave it out. When you love it,
Shop the Look pays every seller in one checkout with a single delivery.

**Your own AI stylist.**
Tell Oromona the occasion — a wedding, a first date, an interview —
and get a personal edit built only from pieces available in your size,
in your budget, from Kenyan sellers. Ask follow-up questions, swap
items and save your favourite looks.

**Escrow-protected checkout.**
Pay with M-Pesa or card via Paystack. Your money is held in escrow
until the piece is delivered and you've confirmed the fit.

**Boda-tracked delivery.**
Nairobi ateliers hand-off to verified riders. You see live pickup and
delivery updates in the app.

**Fair to designers.**
Every seller is verified. They set their take-home price; Oromona's
15% fee is added on top and only released to the seller once you're
happy. Better pieces, honest sizing, fewer returns.

**Loved-ones profiles.**
Shopping for a partner, sister or friend? Add their body profile once
and Oromona sizes and try-ons switch to them with a tap — perfect for
gifts that actually fit.

**Made in Nairobi. Sized to you.**

Free to install. Free to try on. Available in KES, USD, GBP and EUR.
Support: support@oromona.com

### Category
Shopping

### Content rating
Everyone / PEGI 3 (all-audience shopping)

### Contact email
support@oromona.com

### Website
https://oromona.com

### Privacy Policy
https://oromona.com/api/legal/privacy

### Account deletion URL (required by Google Play)
https://oromona.com/api/legal/delete-account

---

## 3. Notes for the developer console

* The **Delete Account URL** is mandatory for Google Play — Oromona
  ships one at `/api/legal/delete-account` and it's also linked in the
  footer of the marketing site.
* The 15% platform fee is stated openly in the description to match
  the seller-facing pricing calculator inside the app.
* Screenshots to upload:
  * 6.9" iPhone (1290×2796): use `/app/appstore_screenshots/final/*.png`
  * 6.1"/6.3" iPhone (1206×2622): use `/app/appstore_screenshots/final_61/*.png` (also zipped at `/app/oromona_appstore_screenshots_6_1.zip`)

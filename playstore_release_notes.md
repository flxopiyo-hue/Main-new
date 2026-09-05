# Oromona — Google Play Release Notes

Google Play Console → **Production / Testing → Release → What's new in
this release**. Limit: **500 characters per language**. Paste the
matching block; Play accepts each language independently, so you can
ship English on day one and add Swahili later without a new binary.

Play policy quick reminders (avoids automatic rejection):
- No pricing claims ("free forever", "50% off").
- No superlatives against competitors ("the best", "#1").
- No external links.
- Emojis are fine and encouraged — they count 1–2 characters each.

---

## v1.0 — First public release

### English (en-US) — 450 chars

```
Welcome to Oromona — the boutique that fits you 👗

Kenya-crafted fashion, sized to your body.

✨ AI Try-On on your body, front + back
📏 Live Fit Score for every piece
🧵 AI Stylist for the exact occasion
🛍 Shop the Look — full outfits in one checkout
🛵 Boda delivery with live tracking
🔒 M-Pesa & card via Paystack, escrow-protected
👤 Sign in with Google or Apple
🎁 Shop for loved-ones with saved profiles

Made in Nairobi. Sized to you.
```

### Swahili (sw-KE) — 470 chars

```
Karibu Oromona — boutique inayokufaa 👗

Mitindo iliyotengenezwa Kenya, kwa saizi yako.

✨ Jaribu mavazi kwa AI — mbele na nyuma
📏 Alama ya ufaafu kwa kila kipande
🧵 Mshauri wa mitindo kwa kila hafla
🛍 "Shop the Look" — mavazi kamili kwa malipo moja
🛵 Uwasilishaji wa boda ukiwa unafuatilia moja kwa moja
🔒 M-Pesa na kadi kupitia Paystack, iliyolindwa kwa escrow
👤 Ingia na Google au Apple
🎁 Nunua kwa wapendwa kwa profaili zilizohifadhiwa

Imetengenezwa Nairobi. Kwa saizi yako.
```

### Fallback — if Play flags the character count anywhere (240 chars)

```
Kenya-crafted fashion, sized to your body 👗

✨ AI Try-On on your body
📏 Live Fit Score for every piece
🧵 AI Stylist for every occasion
🛍 Shop the Look in one checkout
🛵 Boda delivery, live tracked
🔒 M-Pesa & card, escrow-protected

Made in Nairobi.
```

---

## v1.0.1 — First patch (template — paste + fill)

```
Small fixes to make Oromona better 🧵

• [describe fix 1, e.g. "Faster load on the marketplace grid"]
• [describe fix 2, e.g. "Sign in with Apple now hands you back to
   your last screen"]
• Bug fixes and polish

Tap "Try It On" and let us know what you think — support@oromona.com
```

---

## v1.1+ — Feature releases (template)

```
What's new in Oromona ✨

🆕 [Feature 1 headline]
[One-sentence why-you-care.]

🆕 [Feature 2 headline]
[One-sentence why-you-care.]

Also: performance and stability improvements.

Made in Nairobi. Sized to you.
```

### Version-numbering guidance
- **1.0.x** — bug fixes only.
- **1.x** — new features (AI updates, new payment method, etc.).
- **2.0** — reserved for a major design refresh or new business model.

---

## Notes about the current build

The first upload to Play under the new package name
`com.oromona.myapp` is a fresh listing — this is genuinely v1.0 for
Play, even though there was internal QA before. Use the launch notes
above verbatim; the fallback exists only in case Play's non-Latin
character counting flags either language.

If you later add another store market (Uganda, Tanzania, Rwanda),
duplicate the English block and swap "Kenya" for the target country,
and "M-Pesa" for whichever local rails you enable there. The rest of
the copy is country-neutral.

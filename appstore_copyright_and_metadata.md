# Oromona — Copyright + Age Rating + Category strings

Paste these into App Store Connect and Google Play Console during
listing setup. If your legal entity is registered under a different
name (e.g. "Oromona Limited", "Oromona Kenya Ltd."), replace it
everywhere below in one pass.

---

## 1. Copyright

### Apple App Store Connect
Field: **App Information → General Information → Copyright**
Character limit: 100
Format expected by Apple: `YYYY <Legal Entity Name>`

Recommended value (short — fits every store):
```
© 2026 Oromona Ltd.
```

Alternative long form (only if App Store Connect complains about the ©
symbol on some regions):
```
2026 Oromona Ltd.
```

If your legal entity is a personal name rather than a company (sole
proprietorship / individual developer):
```
© 2026 <Your Full Legal Name>
```

### Google Play Console
Google Play doesn't have a copyright field — instead put the same line
inside the **Full description** footer (already done in
`/app/appstore_descriptions.md`) and in the landing page footer at
oromona.com (already: "© 2026 Oromona. Made in Nairobi.").

### In-app "About Oromona" screen
Wherever you show version / build number, include:
```
© 2026 Oromona Ltd. All rights reserved.
Made in Nairobi 🇰🇪
```

---

## 2. Primary + Secondary Category

### Apple App Store
- **Primary Category**: Shopping
- **Secondary Category**: Lifestyle
  (do NOT pick Navigation — it triggers the mandatory Routing App
   Coverage File upload we don't need)

### Google Play
- **Category**: Shopping
- **Tags**: fashion, style, marketplace, boutique, tailor, kenya

---

## 3. Age Rating

### Apple — App Store Connect → App Information → Age Rating
Answer this questionnaire:

| Question | Answer |
|---|---|
| Cartoon or Fantasy Violence | None |
| Realistic Violence | None |
| Prolonged Graphic or Sadistic Realistic Violence | None |
| Profanity or Crude Humor | None |
| Mature/Suggestive Themes | None |
| Horror/Fear Themes | None |
| Medical/Treatment Information | None |
| Alcohol, Tobacco, or Drug Use or References | None |
| Simulated Gambling | None |
| Sexual Content or Nudity | None |
| Graphic Sexual Content and Nudity | None |
| Unrestricted Web Access | **No** |
| Gambling and Contests | No |

Result: **4+** (all ages).

### Google Play — Content Rating questionnaire (IARC)
Category: **Reference, News, or Educational** → **Utility, Productivity,
Communication or Other**. Answer "No" to every content question.
Result: **PEGI 3 / ESRB Everyone / IARC 3+**.

---

## 4. Data Safety / Privacy — data collected

Use these exact answers for both App Privacy (Apple) and Data Safety (Play):

**Collected AND linked to the user:**
- Email address (account signup + notifications)
- Name (display name on orders)
- Phone number (delivery)
- Physical address (delivery only)
- Photos (try-on input; user-provided; stored)
- Body measurements (fit score; user-provided)
- Purchase history (order fulfilment + support)

**Collected but NOT linked to the user:**
- Crash logs (diagnostics)
- App interaction (rough analytics)

**Not collected:**
- Precise location, contacts, browsing history, financial info other than
  order totals, health/fitness data other than body measurements, calendar
  events, SMS, files/documents outside chosen photos.

**Data selling/sharing:** No selling. No sharing with third parties for
their own advertising. Data is shared ONLY with Paystack (payments),
Resend (transactional email), and Emergent (Google Sign-In) — each on
a strictly service-provider basis.

---

## 5. Support + Marketing URLs (reminder)

- Support URL: `https://oromona.com`
- Marketing URL: `https://oromona.com`
- Privacy Policy URL: `https://oromona.com/api/legal/privacy`
- Account Deletion URL (Google Play required): `https://oromona.com/api/legal/delete-account`

Once the domain points at your deployed backend, all three URLs
resolve. If oromona.com isn't live yet at submission time, temporarily
use the production URL `https://fit-finder-app-5.emergent.host` with
the same paths and swap them later — App Store Connect allows editing
these URLs without a new binary.

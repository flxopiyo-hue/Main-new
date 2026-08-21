# Routing App Coverage File — Oromona

This directory ships `routing_app_coverage.geojson`, a strict RFC 7946
GeoJSON FeatureCollection covering Kenya.

## Do I actually need to upload this?

Almost certainly **no**, unless something changed. Apple's App Store
Connect only asks for this file when the app's **primary or
secondary category is "Navigation"** and the app provides
turn-by-turn directions to end users. Oromona is a **Shopping** app —
delivery tracking is passive, not turn-by-turn — so the upload field
should not be visible in App Store Connect for this listing.

## If the upload button is greyed out or the field is missing

That's expected. Do this instead:
1. App Store Connect → your app → **App Information**.
2. Confirm **Primary Category = Shopping** and **Secondary Category = Lifestyle** (never Navigation).
3. Scroll down. The "Routing App Coverage File" field simply won't appear.

## If a validator (e.g. geojsonlint.com) rejects the file

The file is strict RFC 7946: only `type` and `features` at the root,
coordinates in `[longitude, latitude]` order, first and last vertex of
the polygon identical (the ring is closed). If a validator still
complains, common causes are:

- **File saved with a BOM (byte-order mark)** — some editors add
  `\ufeff` to the top of the file. Re-save as UTF-8 without BOM.
- **Wrong extension** — App Store Connect expects `.geojson`, not
  `.json`. This file already uses the right extension; just don't
  rename it on your side.
- **Coordinates flipped** — GeoJSON is `[lon, lat]`. Kenya sits between
  longitude 33.9° and 41.9° and latitude -4.7° and 5.1°. If you see
  latitudes first, the file has been reformatted somewhere.

## Coverage described

Feature 1: a rectangular bounding polygon around Kenya. This is the
current Oromona delivery service country. Extend or add features when
you expand into Uganda (add `[29.5°, -1.5°]` → `[35.0°, 4.2°]`),
Tanzania (`[29.3°, -11.7°]` → `[40.4°, -1.0°]`), or Rwanda
(`[28.9°, -2.8°]` → `[30.9°, -1.0°]`) — same schema, just more
`Feature` objects inside `features`.

## Regenerating

The file has no dynamic content and no build step. Edit it directly
in a text editor. To re-validate:

```bash
python -c "import json; json.load(open('/app/routing_app_coverage.geojson')); print('OK')"
```

For visual inspection, paste the contents into
https://geojson.io — the polygon should draw as a rectangle covering
Kenya.

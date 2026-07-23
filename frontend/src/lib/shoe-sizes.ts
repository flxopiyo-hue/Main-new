// Shoe size charts — EU-first with cm foot-length equivalents. Kenyan
// retailers commonly stock EU sizes 35-47, cross-referenced against UK
// and US sizes on the box.
//
// We keep separate ADULT and KIDS charts. Sellers pick from the chart in
// the add-item wizard; buyers set a preferred shoe size in registration
// / profile so item recommendations can match.

export interface ShoeSize {
  /** Label stored in the DB (e.g., "40"). */
  value: string;
  /** Display label shown in chips (e.g., "40 · 25.5cm"). */
  label: string;
  /** Foot length in centimetres — used for future fit-match on shoes. */
  cm: number;
  /** UK size (for the sub-label in the picker). */
  uk?: string;
  /** US size (for the sub-label in the picker). */
  us?: string;
}

/** Adult unisex shoe sizes — EU 35 → 47. */
export const ADULT_SHOE_SIZES: ShoeSize[] = [
  { value: "35", label: "EU 35 · 22.5cm", cm: 22.5, uk: "2.5", us: "5 W / 3 M" },
  { value: "36", label: "EU 36 · 23cm", cm: 23.0, uk: "3.5", us: "6 W / 4 M" },
  { value: "37", label: "EU 37 · 23.5cm", cm: 23.5, uk: "4", us: "6.5 W / 4.5 M" },
  { value: "38", label: "EU 38 · 24cm", cm: 24.0, uk: "5", us: "7 W / 5 M" },
  { value: "39", label: "EU 39 · 24.5cm", cm: 24.5, uk: "6", us: "8 W / 6 M" },
  { value: "40", label: "EU 40 · 25.5cm", cm: 25.5, uk: "6.5", us: "9 W / 7 M" },
  { value: "41", label: "EU 41 · 26cm", cm: 26.0, uk: "7.5", us: "9.5 W / 8 M" },
  { value: "42", label: "EU 42 · 26.5cm", cm: 26.5, uk: "8", us: "10 W / 8.5 M" },
  { value: "43", label: "EU 43 · 27.5cm", cm: 27.5, uk: "9", us: "11 W / 9.5 M" },
  { value: "44", label: "EU 44 · 28cm", cm: 28.0, uk: "10", us: "— / 10.5 M" },
  { value: "45", label: "EU 45 · 28.5cm", cm: 28.5, uk: "10.5", us: "— / 11 M" },
  { value: "46", label: "EU 46 · 29.5cm", cm: 29.5, uk: "11.5", us: "— / 12 M" },
  { value: "47", label: "EU 47 · 30cm", cm: 30.0, uk: "12.5", us: "— / 13 M" },
];

/** Kids' shoe sizes — EU 20 → 34. */
export const KID_SHOE_SIZES: ShoeSize[] = [
  { value: "20", label: "EU 20 · 12.5cm", cm: 12.5, uk: "4", us: "4.5" },
  { value: "21", label: "EU 21 · 13cm", cm: 13.0, uk: "4.5", us: "5" },
  { value: "22", label: "EU 22 · 13.5cm", cm: 13.5, uk: "5", us: "5.5" },
  { value: "23", label: "EU 23 · 14cm", cm: 14.0, uk: "6", us: "6.5" },
  { value: "24", label: "EU 24 · 14.5cm", cm: 14.5, uk: "7", us: "7.5" },
  { value: "25", label: "EU 25 · 15.5cm", cm: 15.5, uk: "8", us: "8.5" },
  { value: "26", label: "EU 26 · 16cm", cm: 16.0, uk: "8.5", us: "9" },
  { value: "27", label: "EU 27 · 16.5cm", cm: 16.5, uk: "9", us: "9.5" },
  { value: "28", label: "EU 28 · 17cm", cm: 17.0, uk: "10", us: "10.5" },
  { value: "29", label: "EU 29 · 17.5cm", cm: 17.5, uk: "11", us: "11.5" },
  { value: "30", label: "EU 30 · 18.5cm", cm: 18.5, uk: "11.5", us: "12" },
  { value: "31", label: "EU 31 · 19cm", cm: 19.0, uk: "12.5", us: "13" },
  { value: "32", label: "EU 32 · 20cm", cm: 20.0, uk: "13", us: "1 Y" },
  { value: "33", label: "EU 33 · 20.5cm", cm: 20.5, uk: "1", us: "1.5 Y" },
  { value: "34", label: "EU 34 · 21.5cm", cm: 21.5, uk: "1.5", us: "2 Y" },
];

/** Convert a shoe-size value ("40") into its ShoeSize row, if any. */
export function shoeSizeMeta(
  value: string | null | undefined,
  audience: "adult" | "kids" = "adult",
): ShoeSize | undefined {
  if (!value) return undefined;
  const chart = audience === "kids" ? KID_SHOE_SIZES : ADULT_SHOE_SIZES;
  return chart.find((s) => s.value === String(value));
}

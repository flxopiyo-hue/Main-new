// Stock messaging — shared between buyer Discover, Item Detail, Atelier,
// and cart UI so the language stays identical everywhere.
//
// Rules (per the product spec):
//   qty === 0        → "Out of stock" (red, blocks checkout)
//   1 <= qty <= 5    → "Only N left" (amber, urgency cue)
//   qty > 5          → "In stock" (green, casual)
//
// We deliberately DON'T reveal the exact number above 5 so sellers'
// inventory levels aren't fully exposed to competitors.

export type StockLevel = "out" | "low" | "ok";

export interface StockBadge {
  level: StockLevel;
  label: string;
  /** Hex used for the chip background or text in the badge. */
  color: string;
}

// Tailwind-ish hues that read well on both light & dark backgrounds.
const COLOR_OUT = "#DC2626";   // red-600
const COLOR_LOW = "#D97706";   // amber-600
const COLOR_OK = "#15803D";    // green-700

export function stockBadge(qty: number | null | undefined): StockBadge {
  const n = Math.max(0, Math.floor(qty ?? 0));
  if (n === 0) return { level: "out", label: "Out of stock", color: COLOR_OUT };
  if (n <= 5) return { level: "low", label: `Only ${n} left`, color: COLOR_LOW };
  return { level: "ok", label: "In stock", color: COLOR_OK };
}

/** Sum all sizes' available_qty — used to label a listing card as a whole. */
export function totalAvailable(sizes: { available_qty: number }[]): number {
  return sizes.reduce((sum, s) => sum + (s.available_qty || 0), 0);
}

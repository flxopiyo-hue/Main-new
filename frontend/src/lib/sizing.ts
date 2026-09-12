// Size recommendation aligned to Kenya / East-Africa retail standards.
//
// This module keeps a *fallback* recommendation logic used before we have
// a proper per-item Fit-Match Score. It powers:
//   • Onboarding measurements → "Recommended size: L"
//   • Item detail default-selected size chip
//   • Cross-referencing user's preferred_size across the app
//
// The tables below reflect what Kenyan retailers (Mr Price Africa,
// Vivo Woman, LC Waikiki KE, Woolworths KE, Truworths KE) actually
// stock, cross-referenced with UK/EU/US crossover for expat shoppers.
//
// Two gender charts + a **height clamp** — because AI photo estimation
// often over-reads chest circumference, and a 151cm person cannot
// physiologically be an XL top even if chest reads 100cm+. The clamp
// respects human proportion.

export type SizeCode = "XS" | "S" | "M" | "L" | "XL" | "XXL";

/** Standard women's tops chart (bust circumference in cm). */
const WOMEN_TOPS: { max: number; size: SizeCode }[] = [
  { max: 83, size: "XS" },  // bust up to 83cm
  { max: 88, size: "S" },   // 84-88
  { max: 93, size: "M" },   // 89-93
  { max: 99, size: "L" },   // 94-99
  { max: 106, size: "XL" }, // 100-106
  { max: 999, size: "XXL" }, // 107+
];

/** Standard men's tops chart (chest circumference in cm). */
const MEN_TOPS: { max: number; size: SizeCode }[] = [
  { max: 91, size: "XS" },  // chest up to 91cm
  { max: 96, size: "S" },   // 92-96
  { max: 101, size: "M" },  // 97-101
  { max: 106, size: "L" },  // 102-106
  { max: 111, size: "XL" }, // 107-111
  { max: 999, size: "XXL" },
];

/**
 * Plausibility clamps by height. A 151cm human cannot realistically wear
 * XL tops even at higher chest readings because torso length / shoulder
 * width scales with total height. The AI photo estimator sometimes
 * over-reads chest by 5-10cm, so this clamp prevents that noise from
 * shoving a Medium into an XL.
 */
const HEIGHT_CLAMPS_WOMEN: { maxHeightCm: number; maxSize: SizeCode }[] = [
  { maxHeightCm: 152, maxSize: "M" },  // very petite → cap at M
  { maxHeightCm: 158, maxSize: "L" },  // petite → cap at L
  { maxHeightCm: 165, maxSize: "XL" }, // average shorter → cap at XL
  // taller → no clamp
];

const HEIGHT_CLAMPS_MEN: { maxHeightCm: number; maxSize: SizeCode }[] = [
  { maxHeightCm: 162, maxSize: "M" },
  { maxHeightCm: 170, maxSize: "L" },
  { maxHeightCm: 178, maxSize: "XL" },
];

const ORDER: SizeCode[] = ["XS", "S", "M", "L", "XL", "XXL"];

function clampToMax(size: SizeCode, maxSize: SizeCode): SizeCode {
  const idx = ORDER.indexOf(size);
  const cap = ORDER.indexOf(maxSize);
  return idx > cap ? maxSize : size;
}

function applyHeightClamp(
  size: SizeCode,
  heightCm: number,
  gender: string,
): SizeCode {
  const clamps = gender === "male" ? HEIGHT_CLAMPS_MEN : HEIGHT_CLAMPS_WOMEN;
  for (const c of clamps) {
    if (heightCm <= c.maxHeightCm) {
      return clampToMax(size, c.maxSize);
    }
  }
  return size;
}

export interface RecommendSizeInput {
  /** Bust (women) or chest (men), in centimetres. */
  chestCm?: number | null;
  /** Optional — used to clamp against implausibly large recommendations. */
  heightCm?: number | null;
  /** "female" | "male" | "other" | "prefer_not_to_say". Defaults to women's chart. */
  gender?: string | null;
}

/**
 * Return the recommended tops size for a buyer using Kenya-standard
 * charts. Returns `null` when the chest measurement is missing (the
 * component should then show a hint asking the user to add measurements).
 */
export function recommendTopSize({
  chestCm,
  heightCm,
  gender,
}: RecommendSizeInput): SizeCode | null {
  if (!chestCm || chestCm <= 0) return null;

  const table = gender === "male" ? MEN_TOPS : WOMEN_TOPS;
  const row = table.find((r) => chestCm <= r.max);
  const raw = row?.size ?? "XXL";

  if (heightCm && heightCm > 0) {
    return applyHeightClamp(raw, heightCm, gender ?? "female");
  }
  return raw;
}

/**
 * Extra hint string surfaced in the UI when the height clamp actually
 * kicked in — so the buyer understands why the recommendation is smaller
 * than a pure chest calculation would suggest.
 */
export function recommendationExplanation({
  chestCm,
  heightCm,
  gender,
}: RecommendSizeInput): string | null {
  if (!chestCm || !heightCm) return null;
  const table = gender === "male" ? MEN_TOPS : WOMEN_TOPS;
  const row = table.find((r) => chestCm <= r.max);
  const raw = row?.size ?? "XXL";
  const clamped = applyHeightClamp(raw, heightCm, gender ?? "female");
  if (raw !== clamped) {
    return `Adjusted for your height (${heightCm}cm). Chest alone suggests ${raw}, but your frame fits ${clamped} better in most tops.`;
  }
  return null;
}

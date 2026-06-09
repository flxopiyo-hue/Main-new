// Unit conversion helpers for the body measurements form.
//
// All measurements are stored canonically in CENTIMETRES on the backend.
// The form lets the user pick CM / IN / FT — this module handles the round
// trip so the user sees their preferred unit but the wire format is stable.

export type LengthUnit = "cm" | "in" | "ft";

export const UNIT_LABELS: Record<LengthUnit, string> = {
  cm: "Centimetres",
  in: "Inches",
  ft: "Feet & Inches",
};

const CM_PER_IN = 2.54;
const IN_PER_FT = 12;

/** Convert a CM value to the chosen display unit, returning a STRING ready for an input. */
export function cmToDisplay(
  cm: number | null | undefined,
  unit: LengthUnit,
): string {
  if (cm == null) return "";
  if (unit === "cm") return String(Math.round(cm));
  const inches = cm / CM_PER_IN;
  if (unit === "in") return String(Math.round(inches * 10) / 10);
  // ft → render as e.g. "5'9"" (feet'inches")
  const feet = Math.floor(inches / IN_PER_FT);
  const remaining = Math.round(inches - feet * IN_PER_FT);
  // Handle rollover (e.g. 11.7 in rounds to 12 → push to next foot)
  if (remaining >= IN_PER_FT) {
    return `${feet + 1}'0"`;
  }
  return `${feet}'${remaining}"`;
}

/**
 * Parse a user-entered string in the chosen unit back to CM.
 * Returns null if the input is empty or unparsable.
 */
export function displayToCm(input: string, unit: LengthUnit): number | null {
  const cleaned = input.trim();
  if (!cleaned) return null;

  if (unit === "cm") {
    const n = parseFloat(cleaned.replace(/,/g, "."));
    return Number.isFinite(n) ? n : null;
  }
  if (unit === "in") {
    const n = parseFloat(cleaned.replace(/,/g, "."));
    return Number.isFinite(n) ? n * CM_PER_IN : null;
  }
  // ft: accept "5'9"", "5'9", "5 ft 9 in", "5.75", or a single number = feet
  const ftMatch = cleaned.match(
    /^(\d+(?:[.,]\d+)?)\s*(?:'|ft|feet)?\s*(?:(\d+(?:[.,]\d+)?)\s*(?:"|in|inches)?)?$/i,
  );
  if (!ftMatch) return null;
  const ft = parseFloat(ftMatch[1].replace(",", "."));
  const inch = ftMatch[2] ? parseFloat(ftMatch[2].replace(",", ".")) : 0;
  if (!Number.isFinite(ft) || !Number.isFinite(inch)) return null;
  const totalInches = ft * IN_PER_FT + inch;
  return totalInches * CM_PER_IN;
}

/** Sensible placeholder text for inputs per unit. */
export function placeholderFor(field: "height" | "girth", unit: LengthUnit): string {
  if (unit === "cm") {
    return field === "height" ? "170" : "92";
  }
  if (unit === "in") {
    return field === "height" ? "67" : "36";
  }
  // ft+in
  return field === "height" ? "5'7\"" : "3'0\"";
}

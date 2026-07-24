// Category-aware size charts for the seller wizard.
//
// Different garment families use different sizing systems: men's bottoms
// are waist inches (32, 34, 40…), bras are band+cup (34B), socks are EU
// shoe-size ranges, etc. `chartsFor()` returns the applicable charts for
// a (category, subcategory, audience) combination plus a sensible default.
// The seller can always override via the "Size system" selector in the
// wizard. Shoes keep their dedicated EU/cm chart in shoe-sizes.ts.

export interface SizeChartEntry {
  value: string; // stored as the SizeOption.label
  hint?: string; // small sub-label under the chip (cm/inch reference)
}

export interface SizeChart {
  key: string;
  label: string; // shown on the chart-selector chip
  entries: SizeChartEntry[];
}

export const LETTER_CHART: SizeChart = {
  key: "letters",
  label: "XS–XXL",
  entries: ["XS", "S", "M", "L", "XL", "XXL"].map((v) => ({ value: v })),
};

export const KIDS_CHART: SizeChart = {
  key: "kids",
  label: "Kids age",
  entries: [
    "NB", "3M", "6M", "12M", "18M", "24M",
    "2T", "3T", "4T",
    "5", "6", "7", "8", "10", "12", "14", "16",
  ].map((v) => ({ value: v })),
};

// Men's / unisex bottoms — waist in inches with cm reference.
export const WAIST_CHART: SizeChart = {
  key: "waist",
  label: "Waist (in)",
  entries: [
    { value: "28", hint: "71 cm" },
    { value: "30", hint: "76 cm" },
    { value: "32", hint: "81 cm" },
    { value: "34", hint: "86 cm" },
    { value: "36", hint: "91 cm" },
    { value: "38", hint: "97 cm" },
    { value: "40", hint: "102 cm" },
    { value: "42", hint: "107 cm" },
    { value: "44", hint: "112 cm" },
  ],
};

// Women's bottoms/dresses — UK numeric sizes (common in Kenya) with waist cm.
export const UK_WOMEN_CHART: SizeChart = {
  key: "uk_women",
  label: "UK 6–18",
  entries: [
    { value: "UK 6", hint: "waist 63 cm" },
    { value: "UK 8", hint: "waist 68 cm" },
    { value: "UK 10", hint: "waist 73 cm" },
    { value: "UK 12", hint: "waist 78 cm" },
    { value: "UK 14", hint: "waist 83 cm" },
    { value: "UK 16", hint: "waist 88 cm" },
    { value: "UK 18", hint: "waist 93 cm" },
  ],
};

// Bras — band (underbust) + cup. Hints show the underbust cm range.
const BRA_BAND_HINTS: Record<string, string> = {
  "32": "68–72 cm",
  "34": "73–77 cm",
  "36": "78–82 cm",
  "38": "83–87 cm",
  "40": "88–92 cm",
};
export const BRA_CHART: SizeChart = {
  key: "bra",
  label: "Bra",
  entries: ["32", "34", "36", "38", "40"].flatMap((band) =>
    ["A", "B", "C", "D"].map((cup) => ({
      value: `${band}${cup}`,
      hint: BRA_BAND_HINTS[band],
    })),
  ),
};

// Boxers/briefs/trunks — letter sizes with waist-inch reference.
export const UNDERWEAR_CHART: SizeChart = {
  key: "underwear",
  label: "Underwear",
  entries: [
    { value: "S", hint: 'waist 28–30"' },
    { value: "M", hint: 'waist 32–34"' },
    { value: "L", hint: 'waist 36–38"' },
    { value: "XL", hint: 'waist 40–42"' },
    { value: "XXL", hint: 'waist 44–46"' },
  ],
};

// Socks — EU shoe-size ranges with foot-length cm.
export const SOCKS_CHART: SizeChart = {
  key: "socks",
  label: "Socks",
  entries: [
    { value: "EU 35–38", hint: "22–24 cm foot" },
    { value: "EU 39–42", hint: "25–27 cm foot" },
    { value: "EU 43–46", hint: "28–30 cm foot" },
  ],
};

export const ONE_SIZE_CHART: SizeChart = {
  key: "one_size",
  label: "One size",
  entries: [{ value: "One Size" }],
};

export const ALL_CHARTS: SizeChart[] = [
  LETTER_CHART,
  KIDS_CHART,
  WAIST_CHART,
  UK_WOMEN_CHART,
  BRA_CHART,
  UNDERWEAR_CHART,
  SOCKS_CHART,
  ONE_SIZE_CHART,
];

/**
 * Applicable charts + default for a taxonomy pick. Subcategory keywords win
 * (a "Bra" subcategory forces the bra chart no matter the category), then
 * audience, then category. Community categories fall through to a generous
 * set so sellers of e.g. "Swimwear" can pick whichever system fits.
 */
export function chartsFor(
  category: string,
  subcategory: string | null,
  audience: string,
): { charts: SizeChart[]; defaultKey: string } {
  const sub = (subcategory ?? "").toLowerCase();
  const cat = (category ?? "").toLowerCase();
  if (/bra\b|bralette|lingerie/.test(sub) || /bra\b|bralette|lingerie/.test(cat)) {
    return { charts: [BRA_CHART, LETTER_CHART, ONE_SIZE_CHART], defaultKey: "bra" };
  }
  if (/boxer|brief|underwear|trunk/.test(sub) || /boxer|brief|underwear/.test(cat)) {
    return {
      charts: [UNDERWEAR_CHART, WAIST_CHART, LETTER_CHART, ONE_SIZE_CHART],
      defaultKey: "underwear",
    };
  }
  if (/sock|stocking/.test(sub) || /sock|stocking/.test(cat)) {
    return { charts: [SOCKS_CHART, ONE_SIZE_CHART], defaultKey: "socks" };
  }
  if (audience === "kids") {
    return { charts: [KIDS_CHART, LETTER_CHART, ONE_SIZE_CHART], defaultKey: "kids" };
  }
  if (cat === "pants") {
    if (audience === "women") {
      return {
        charts: [UK_WOMEN_CHART, WAIST_CHART, LETTER_CHART, ONE_SIZE_CHART],
        defaultKey: "uk_women",
      };
    }
    return {
      charts: [WAIST_CHART, LETTER_CHART, UK_WOMEN_CHART, ONE_SIZE_CHART],
      defaultKey: "waist",
    };
  }
  if (cat === "accessories") {
    return {
      charts: [ONE_SIZE_CHART, LETTER_CHART, SOCKS_CHART],
      defaultKey: "one_size",
    };
  }
  if (cat === "dresses") {
    return {
      charts: [LETTER_CHART, UK_WOMEN_CHART, ONE_SIZE_CHART],
      defaultKey: "letters",
    };
  }
  return {
    charts: [LETTER_CHART, WAIST_CHART, UK_WOMEN_CHART, UNDERWEAR_CHART, ONE_SIZE_CHART],
    defaultKey: "letters",
  };
}

/**
 * Best-effort chart detection for edit-mode hydration: returns the key of
 * the first chart whose entries cover every existing size label, or null
 * when nothing matches (legacy/custom labels are left untouched).
 */
export function detectChartKey(labels: string[]): string | null {
  if (labels.length === 0) return null;
  for (const chart of ALL_CHARTS) {
    const values = new Set(chart.entries.map((e) => e.value));
    if (labels.every((l) => values.has(l))) return chart.key;
  }
  return null;
}

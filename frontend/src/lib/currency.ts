// Currency formatting & indicative FX helpers for AuraFit.
// Prices are stored as integer minor units (cents) in the item's listing currency.
// All FX rates are indicative — checkout uses the item's listed currency directly.

export type Currency =
  | "USD"
  | "KES"
  | "EUR"
  | "GBP"
  | "NGN"
  | "ZAR"
  | "INR"
  | "UGX"
  | "TZS"
  | "RWF"
  | "GHS"
  | "EGP";

export interface CurrencyMeta {
  code: Currency;
  label: string;
  symbol: string;
  // Indicative rate: 1 USD = X of this currency (mid-market, June 2026 ranges).
  perUsd: number;
  // Decimals to show when formatting.
  decimals: 0 | 2;
}

export const CURRENCIES: CurrencyMeta[] = [
  { code: "KES", label: "Kenyan Shilling", symbol: "KSh", perUsd: 129.5, decimals: 0 },
  { code: "USD", label: "US Dollar", symbol: "$", perUsd: 1, decimals: 2 },
  { code: "EUR", label: "Euro", symbol: "€", perUsd: 0.92, decimals: 2 },
  { code: "GBP", label: "British Pound", symbol: "£", perUsd: 0.78, decimals: 2 },
  { code: "NGN", label: "Nigerian Naira", symbol: "₦", perUsd: 1480, decimals: 0 },
  { code: "ZAR", label: "South African Rand", symbol: "R", perUsd: 18.4, decimals: 2 },
  { code: "INR", label: "Indian Rupee", symbol: "₹", perUsd: 83.1, decimals: 0 },
  { code: "UGX", label: "Ugandan Shilling", symbol: "USh", perUsd: 3760, decimals: 0 },
  { code: "TZS", label: "Tanzanian Shilling", symbol: "TSh", perUsd: 2510, decimals: 0 },
  { code: "RWF", label: "Rwandan Franc", symbol: "RF", perUsd: 1290, decimals: 0 },
  { code: "GHS", label: "Ghanaian Cedi", symbol: "GH₵", perUsd: 12.7, decimals: 2 },
  { code: "EGP", label: "Egyptian Pound", symbol: "E£", perUsd: 48.5, decimals: 2 },
];

const CURRENCY_INDEX: Record<Currency, CurrencyMeta> = CURRENCIES.reduce(
  (acc, c) => {
    acc[c.code] = c;
    return acc;
  },
  {} as Record<Currency, CurrencyMeta>,
);

export function getCurrencyMeta(code?: string | null): CurrencyMeta {
  if (!code) return CURRENCY_INDEX.USD;
  const upper = code.toUpperCase() as Currency;
  return CURRENCY_INDEX[upper] ?? CURRENCY_INDEX.USD;
}

/**
 * Format an amount stored as integer minor units (cents/öre/etc.) in the
 * given currency. Returns e.g. "KSh 16,770" or "$129".
 */
export function formatPrice(
  amount_cents: number | undefined | null,
  currency?: string | null,
): string {
  if (amount_cents == null) return "—";
  const meta = getCurrencyMeta(currency);
  const value = amount_cents / 100;
  const decimals = meta.decimals;
  const formatted = value
    .toFixed(decimals)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${meta.symbol} ${formatted}`.replace(/\s+,/, ",");
}

/**
 * Indicative converted price for buyers who prefer a different display currency
 * than the item's listed currency. Returns null when both currencies match.
 */
export function indicativePrice(
  amount_cents: number,
  fromCurrency: string | null | undefined,
  toCurrency: string | null | undefined,
): string | null {
  const from = getCurrencyMeta(fromCurrency);
  const to = getCurrencyMeta(toCurrency);
  if (from.code === to.code) return null;
  // Convert: cents-in-from -> USD -> target currency.
  const usd = amount_cents / 100 / from.perUsd;
  const target = usd * to.perUsd;
  const formatted = target
    .toFixed(to.decimals)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `≈ ${to.symbol} ${formatted}`.replace(/\s+,/, ",");
}

/**
 * Format an amount **directly** in the buyer's preferred currency, converting
 * via mid-market FX from the item's listing currency if they differ. Returns a
 * single string (e.g. "KSh 16,700") — never a dual display. Use this anywhere
 * a buyer sees a price in their preferred display currency.
 */
export function formatPriceIn(
  amount_cents: number | undefined | null,
  fromCurrency: string | null | undefined,
  toCurrency: string | null | undefined,
): string {
  if (amount_cents == null) return "—";
  const from = getCurrencyMeta(fromCurrency);
  const to = getCurrencyMeta(toCurrency ?? fromCurrency);
  if (from.code === to.code) return formatPrice(amount_cents, from.code);
  const usd = amount_cents / 100 / from.perUsd;
  const target = usd * to.perUsd;
  const formatted = target
    .toFixed(to.decimals)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${to.symbol} ${formatted}`.replace(/\s+,/, ",");
}

/**
 * Convert a user-entered amount (e.g. "129" or "16,500.50") in the given
 * currency into integer minor units. Used by the seller "new item" form.
 */
export function parseAmountToCents(
  input: string,
  currency: Currency,
): number | null {
  const meta = getCurrencyMeta(currency);
  const cleaned = input.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * Math.pow(10, meta.decimals === 0 ? 0 : 2));
}

/** Label used for input placeholders in the seller form. */
export function priceInputPlaceholder(currency: Currency): string {
  switch (currency) {
    case "KES":
      return "12,500";
    case "NGN":
      return "120,000";
    case "INR":
      return "10,500";
    case "UGX":
      return "475,000";
    case "TZS":
      return "320,000";
    case "RWF":
      return "165,000";
    case "ZAR":
      return "2,375";
    case "GHS":
      return "1,650";
    case "EGP":
      return "6,250";
    case "EUR":
      return "119.00";
    case "GBP":
      return "99.00";
    default:
      return "129.00";
  }
}

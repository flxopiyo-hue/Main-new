// Locale + region detection for Drape.
//
// Uses the device-provided region (works offline, respects user override of
// the device language/region setting). If the user is in Kenya, we softly
// switch their currency to KES the first time they log in or register so
// they immediately see prices in their local currency. They can still pick
// any other currency from Profile → Region & Currency.

import * as Localization from "expo-localization";

import { CurrencyCode } from "@/src/lib/api";

const COUNTRY_TO_CURRENCY: Record<string, CurrencyCode> = {
  KE: "KES",
  UG: "UGX",
  TZ: "TZS",
  RW: "RWF",
  GH: "GHS",
  NG: "NGN",
  ZA: "ZAR",
  EG: "EGP",
  IN: "INR",
  US: "USD",
  CA: "USD",
  GB: "GBP",
  IE: "EUR",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
};

/**
 * Best guess of the user's region (ISO 3166-1 alpha-2) from the device.
 * Falls back to null when unknown — callers should not assume a default.
 */
export function getDeviceRegion(): string | null {
  try {
    const locales = Localization.getLocales();
    for (const loc of locales) {
      if (loc.regionCode) return loc.regionCode.toUpperCase();
    }
  } catch {
    // expo-localization unavailable (e.g. very old web runtime) — ignore.
  }
  return null;
}

/**
 * Map device region → currency. Returns null when we don't recognise the
 * country so callers know to leave the user's existing preference untouched.
 */
export function suggestCurrencyForRegion(region: string | null): CurrencyCode | null {
  if (!region) return null;
  return COUNTRY_TO_CURRENCY[region.toUpperCase()] ?? null;
}

export function isKenya(region: string | null): boolean {
  return (region ?? "").toUpperCase() === "KE";
}

// Web-only helpers for the Oromona website (oromona.com).
//
// The Expo app renders on the web via react-native-web. Everything in this
// module is used ONLY when `Platform.OS === "web"` so the native mobile
// app (Expo Go / native builds) behaviour is never affected.

import { Platform, useWindowDimensions } from "react-native";

import type { User } from "@/src/lib/api";

export const isWeb = Platform.OS === "web";

// Max content width for the marketing landing + storefront shell.
export const WEB_MAX_WIDTH = 1120;
// Narrower column for reading-oriented pages (item detail).
export const WEB_READ_WIDTH = 760;

// Warm editorial palette matched to the existing oromona.com landing
// (cream + terracotta + ink). Kept separate from the app's black/white
// theme so the marketing surfaces feel like a boutique website while the
// store cards reuse the neutral app components.
export const webColors = {
  bg: "#F5F1EA",
  ink: "#14110E",
  inkFg: "#FFFFFF",
  muted: "#6B6157",
  accent: "#C86B4A",
  accentDark: "#B4562F",
  card: "#FFFFFF",
  border: "#E4DCD0",
  dark: "#1D1915",
};

export interface Breakpoint {
  width: number;
  isDesktop: boolean;
  isTablet: boolean;
  isPhone: boolean;
}

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return {
    width,
    isDesktop: width >= 900,
    isTablet: width >= 640 && width < 900,
    isPhone: width < 640,
  };
}

// Product grid column count for the storefront.
export function storeColumns(width: number): number {
  if (width >= 1100) return 4;
  if (width >= 820) return 3;
  return 2;
}

// Where a signed-in user's "My account" button should land, by role.
export function homeRouteForUser(user: User | null): string {
  if (!user) return "/(auth)/login";
  if (user.role === "admin") return "/admin";
  if (user.role === "seller") return "/(seller)";
  if (user.role === "courier") return "/(courier)";
  return "/(tabs)";
}

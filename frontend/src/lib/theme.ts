// AuraFit theme constants. Derived from /app/design_guidelines.json.
// Editorial Swiss / High-contrast aesthetic — sharp corners, generous space.

export const colors = {
  background: "#FAFAFA",
  surface: "#FFFFFF",
  primary: "#0A0A0A",
  primaryFg: "#FFFFFF",
  secondary: "#E5E5E5",
  secondaryFg: "#0A0A0A",
  muted: "#F5F5F5",
  mutedFg: "#737373",
  border: "#E5E5E5",
  error: "#FF3B30",
  success: "#34C759",
  overlay: "rgba(0, 0, 0, 0.45)",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  none: 0,
  sm: 2,
  pill: 999,
  sheet: 24,
};

// React Native 0.86 REMOVED `StyleSheet.absoluteFillObject` (only
// `StyleSheet.absoluteFill` remains). Spreading the removed property
// yields `undefined` on native, silently dropping `position: absolute`
// — which is what pushed the welcome screen's content off-screen on
// tester phones while web (react-native-web still ships it) looked fine.
// Always spread THIS object instead; it works identically everywhere.
export const absoluteFill = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

// Custom fonts bundled locally via `assets/fonts/*.ttf`, loaded in
// `app/_layout.tsx`. The family names below MUST match the keys given
// to `useFonts` in the layout — no more `@expo-google-fonts/*` deps.
export const fonts = {
  heading: "CormorantGaramond_500Medium",
  headingItalic: "CormorantGaramond_500Medium_Italic",
  body: "Manrope_400Regular",
  bodyMedium: "Manrope_500Medium",
  bodySemi: "Manrope_600SemiBold",
  bodyBold: "Manrope_700Bold",
};

export const type = {
  h1: { fontFamily: fonts.heading, fontSize: 40, lineHeight: 44, letterSpacing: -1, color: colors.primary },
  h2: { fontFamily: fonts.heading, fontSize: 30, lineHeight: 34, color: colors.primary },
  h3: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 28, color: colors.primary },
  bodyLg: { fontFamily: fonts.body, fontSize: 17, lineHeight: 26, color: colors.primary },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.primary },
  bodyMuted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.mutedFg },
  caption: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 2,
    textTransform: "uppercase" as const,
    color: colors.mutedFg,
  },
  buttonLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 1.5,
    textTransform: "uppercase" as const,
  },
};

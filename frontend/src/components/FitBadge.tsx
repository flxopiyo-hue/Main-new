// Fit Match Score badge — buyer-facing chip used on Discover cards, the
// Item Detail hero, and (eventually) the live size slider.
//
// The component is intentionally dumb — give it a `FitScore` payload from
// the API and it figures out the colour, label, and accessibility text.

import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import type { FitScore } from "@/src/lib/api";
import { fonts } from "@/src/lib/theme";

const COLOR_BY_BAND: Record<"green" | "amber" | "red", { bg: string; fg: string }> = {
  green: { bg: "#15803D", fg: "#FFFFFF" },
  amber: { bg: "#D97706", fg: "#FFFFFF" },
  red: { bg: "#DC2626", fg: "#FFFFFF" },
};

const LABEL_BY_BAND: Record<"green" | "amber" | "red", string> = {
  green: "Great fit",
  amber: "Close fit",
  red: "Loose match",
};

export interface FitBadgeProps {
  fit?: FitScore | null;
  /** Loading state from the parent. Renders a tiny spinner. */
  loading?: boolean;
  /** Compact = used on Discover cards (icon + number only). */
  compact?: boolean;
  testID?: string;
}

export function FitBadge({ fit, loading, compact, testID }: FitBadgeProps) {
  // Loading state — show a placeholder so card grids don't reflow.
  if (loading) {
    return (
      <View style={[styles.base, styles.loading, compact && styles.compact]} testID={testID}>
        <ActivityIndicator size="small" color="#666" />
        {!compact ? <Text style={styles.loadingLabel}>Checking fit…</Text> : null}
      </View>
    );
  }
  // Unscored — we don't render anything; parent decides whether to show
  // an "Add your size" CTA in its place.
  if (!fit || !fit.scorable || fit.score == null || !fit.color) {
    return null;
  }

  const palette = COLOR_BY_BAND[fit.color];
  const label = LABEL_BY_BAND[fit.color];
  const score = Math.round(fit.score);

  return (
    <View
      style={[styles.base, { backgroundColor: palette.bg }, compact && styles.compact]}
      testID={testID}
      accessibilityLabel={`Fit score ${score} out of 100, ${label}`}
    >
      <Feather name="target" size={compact ? 11 : 12} color={palette.fg} />
      <Text style={[styles.score, { color: palette.fg, fontSize: compact ? 11 : 12 }]}>
        {score}
      </Text>
      {!compact ? (
        <Text style={[styles.divider, { color: palette.fg }]}>·</Text>
      ) : null}
      {!compact ? (
        <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  compact: { paddingHorizontal: 6, paddingVertical: 3 },
  loading: { backgroundColor: "#EEE9E1" },
  loadingLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: "#666",
    marginLeft: 4,
  },
  score: {
    fontFamily: fonts.bodySemi,
    letterSpacing: 0.4,
  },
  divider: {
    fontFamily: fonts.bodySemi,
    marginHorizontal: 2,
    opacity: 0.8,
  },
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});

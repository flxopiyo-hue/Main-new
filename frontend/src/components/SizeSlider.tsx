// Live size slider for the buyer Item Detail screen.
//
// UX behaviour (lifted straight from the spec):
//   • A horizontal track shows every available size as a discrete tick.
//   • The active tick = the size currently selected.
//   • A coloured "thumb" sits at that tick; the connecting track segment
//     to the start animates to communicate progression.
//   • Tap a tick or drag the thumb to scrub through sizes. Each scrub
//     change reports back via `onChange` so the parent re-runs whatever
//     live narration / dimension display it wants.
//   • The size's overall fit-score colour bleeds into the tick + track
//     so the buyer can see at a glance which size is the best match.
//   • Recommended size gets a small star marker above the tick.
//   • A dynamic narrative banner sits underneath: "Snug across shoulders"
//     etc., computed from the worst-fitting dimension for the selected
//     size. Updates *live* as the buyer scrubs.

import { Feather } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import {
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { FitScoreSize, SizeOption } from "@/src/lib/api";
import { colors, fonts, spacing } from "@/src/lib/theme";

interface Props {
  sizes: SizeOption[];
  /** Currently selected size label. */
  selected: string | null;
  /** Optional best-recommended size label — gets a star marker. */
  recommended?: string | null;
  /** Per-size fit details from the FitScore API. */
  fits?: FitScoreSize[];
  onChange: (sz: SizeOption) => void;
  testID?: string;
}

// Map a score (0-100) onto the badge palette we use everywhere.
function colorForScore(score: number | null | undefined): string {
  if (score == null) return colors.mutedFg;
  if (score >= 75) return "#15803D"; // green
  if (score >= 50) return "#D97706"; // amber
  return "#DC2626"; // red
}

// Compose a single sentence summarising fit for a size. We pick the
// worst-fitting dimension (largest |diff|) so the buyer gets the most
// actionable feedback up front. Falls back to "Perfect fit" when every
// dimension is within ±2cm.
function dominantNarrative(fit: FitScoreSize | undefined): string {
  if (!fit?.dimensions?.length) return "Pick a size to preview fit";
  const valid = fit.dimensions.filter((d) => d.diff !== null);
  if (valid.length === 0) return "No body-fit data yet";
  // Sort by absolute diff descending — biggest mismatch first.
  const sorted = [...valid].sort(
    (a, b) => Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0),
  );
  const worst = sorted[0];
  const diff = worst.diff ?? 0;
  if (Math.abs(diff) < 2) return "Perfect fit across the board";
  const sign = diff > 0 ? "+" : "−";
  const magnitude = `${sign}${Math.abs(diff).toFixed(1)}cm`;
  const tone =
    diff <= -5
      ? `Very tight across the ${worst.label}`
      : diff <= -2
        ? `Snug across the ${worst.label}`
        : diff < 5
          ? `Roomy across the ${worst.label}`
          : `Very roomy across the ${worst.label}`;
  return `${tone} (${magnitude})`;
}

// When the selected size runs small (or loose) on its worst dimension,
// find another size that fits that dimension meaningfully better so we can
// suggest it: "Size S runs 5cm tight — M fits your waist better".
function betterSizeSuggestion(
  active: FitScoreSize | undefined,
  activeLabel: string | undefined,
  enriched: { size: SizeOption; fit?: FitScoreSize; outOfStock: boolean }[],
): { text: string; label: string } | null {
  if (!active?.dimensions?.length || !activeLabel) return null;
  const valid = active.dimensions.filter((d) => d.diff !== null);
  if (valid.length === 0) return null;
  const worst = [...valid].sort(
    (a, b) => Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0),
  )[0];
  const diff = worst.diff ?? 0;
  if (Math.abs(diff) < 2) return null; // already fits well — nothing to suggest
  const candidates = enriched
    .filter(
      (e) =>
        e.fit &&
        e.size.label !== activeLabel &&
        // Never point the buyer at a size that fits WORSE overall — this
        // also prevents S↔M suggestion ping-pong on the recommended size.
        (e.fit.score ?? 0) > (active.score ?? 0),
    )
    .map((e) => {
      const d = e.fit!.dimensions?.find((x) => x.key === worst.key);
      return d && d.diff !== null
        ? { label: e.size.label, diff: d.diff, out: e.outOfStock }
        : null;
    })
    .filter((x): x is { label: string; diff: number; out: boolean } => x !== null);
  if (candidates.length === 0) return null;
  const closest = (pool: { label: string; diff: number; out: boolean }[]) =>
    pool.length
      ? pool.reduce((best, c) => (Math.abs(c.diff) < Math.abs(best.diff) ? c : best))
      : null;
  // Prefer an in-stock size; fall back to out-of-stock with a note.
  const best = closest(candidates.filter((c) => !c.out)) ?? closest(candidates);
  if (!best || Math.abs(best.diff) >= Math.abs(diff) - 0.5) return null;
  const mag = Number.isInteger(Math.abs(diff))
    ? `${Math.abs(diff)}`
    : Math.abs(diff).toFixed(1);
  const tone = diff < 0 ? "tight" : "loose";
  return {
    text: `Size ${activeLabel} runs ${mag}cm ${tone} — ${best.label} fits your ${worst.label} better${best.out ? " (out of stock)" : ""}`,
    label: best.label,
  };
}

export function SizeSlider({
  sizes,
  selected,
  recommended,
  fits,
  onChange,
  testID,
}: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const sizesRef = useRef<SizeOption[]>(sizes);
  sizesRef.current = sizes; // keep latest sizes accessible inside PanResponder

  // Cache the current selection inside a ref so the PanResponder
  // callbacks don't capture a stale value across renders.
  const selectedRef = useRef<string | null>(selected);
  selectedRef.current = selected;

  // For each size, derive its score + colour once so the JSX is tidy.
  const enriched = sizes.map((s) => {
    const fit = fits?.find((p) => p.label === s.label);
    return {
      size: s,
      score: fit?.score ?? null,
      narrative: dominantNarrative(fit),
      fit,
      outOfStock: s.available_qty <= 0,
      isRecommended: s.label === recommended,
      isSelected: s.label === selected,
    };
  });

  const selectedIdx = Math.max(
    0,
    enriched.findIndex((e) => e.isSelected),
  );
  const activeEntry = enriched[selectedIdx];
  const thumbColor = colorForScore(activeEntry?.score);
  const suggestion = betterSizeSuggestion(
    activeEntry?.fit,
    activeEntry?.size.label,
    enriched,
  );

  // PanResponder lets the user drag across the track to scrub sizes.
  // We snap to the closest tick centre on every move event.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        if (trackWidth <= 0 || sizesRef.current.length === 0) return;
        const stepWidth = trackWidth / sizesRef.current.length;
        // gesture.moveX is the *page* x; we need to know the track's left
        // offset. Cheaper to use locationX-like math: clamp moveX into
        // the visible track range using `gesture.x0 + dx` calculation.
        // RN doesn't expose track offset directly, so we approximate by
        // assuming the gesture started on or very close to a tick; then
        // we add `dx` and map to an index relative to the starting one.
        const startIdx = sizesRef.current.findIndex(
          (s) => s.label === selectedRef.current,
        );
        const deltaSteps = Math.round(gesture.dx / stepWidth);
        const nextIdx = Math.min(
          sizesRef.current.length - 1,
          Math.max(0, startIdx + deltaSteps),
        );
        const next = sizesRef.current[nextIdx];
        if (next && next.label !== selectedRef.current) {
          // Skip out-of-stock sizes silently — let the user keep scrubbing
          // past them without "sticking", but still update visually so the
          // narration shows what that size would fit like.
          onChange(next);
        }
      },
    }),
  ).current;

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  if (sizes.length === 0) {
    return null;
  }

  return (
    <View style={styles.wrap} testID={testID}>
      {/* Ticks row — tap or drag. */}
      <View style={styles.ticksWrap} {...panResponder.panHandlers}>
        <View style={styles.track} onLayout={onTrackLayout} />
        {/* Active progress overlay — fills from start to current tick. */}
        {trackWidth > 0 ? (
          <View
            style={[
              styles.trackActive,
              {
                width:
                  ((selectedIdx + 0.5) / sizes.length) * trackWidth,
                backgroundColor: thumbColor,
              },
            ]}
          />
        ) : null}
        <View style={styles.tickRow}>
          {enriched.map((entry, idx) => {
            const tickColor = colorForScore(entry.score);
            return (
              <Pressable
                key={entry.size.label}
                testID={`size-slider-tick-${entry.size.label}`}
                onPress={() => onChange(entry.size)}
                style={styles.tickCell}
                accessibilityRole="button"
                accessibilityState={{ selected: entry.isSelected }}
              >
                {entry.isRecommended ? (
                  <Feather
                    name="star"
                    size={10}
                    color={colors.primary}
                    style={styles.starMarker}
                  />
                ) : null}
                <View
                  style={[
                    styles.tickDot,
                    {
                      borderColor: tickColor,
                      backgroundColor: entry.isSelected ? tickColor : "transparent",
                    },
                    entry.outOfStock && styles.tickDotOut,
                  ]}
                />
                <Text
                  style={[
                    styles.tickLabel,
                    entry.isSelected && { color: colors.primary, fontFamily: fonts.bodySemi },
                    entry.outOfStock && styles.tickLabelOut,
                  ]}
                >
                  {entry.size.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Live narrative banner */}
      <View
        style={[styles.narrativeBanner, { borderLeftColor: thumbColor }]}
        testID="size-slider-narrative"
      >
        <View style={styles.narrativeIcon}>
          <Feather name="target" size={14} color={thumbColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.narrativeLabel}>
            {activeEntry?.isRecommended ? "RECOMMENDED" : "FIT PREVIEW"}
          </Text>
          <Text style={styles.narrativeText}>
            {activeEntry ? activeEntry.narrative : "Pick a size"}
          </Text>
          {suggestion ? (
            <Pressable
              testID="size-slider-suggestion"
              onPress={() => {
                const target = sizes.find((s) => s.label === suggestion.label);
                if (target) onChange(target);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.suggestionText}>
                {suggestion.text} <Text style={styles.suggestionArrow}>→</Text>
              </Text>
            </Pressable>
          ) : null}
        </View>
        {activeEntry?.score != null ? (
          <View style={[styles.narrativeScore, { backgroundColor: thumbColor }]}>
            <Text style={styles.narrativeScoreText}>
              {Math.round(activeEntry.score)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  ticksWrap: { paddingVertical: 12, position: "relative" },
  track: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 28,
    height: 3,
    backgroundColor: colors.border,
  },
  trackActive: {
    position: "absolute",
    left: 16,
    top: 28,
    height: 3,
  },
  tickRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  tickCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 4,
  },
  starMarker: { position: "absolute", top: -4, left: "50%", marginLeft: -5 },
  tickDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: colors.background,
  },
  tickDotOut: { opacity: 0.4 },
  tickLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
  },
  tickLabelOut: { textDecorationLine: "line-through", opacity: 0.6 },
  // Banner
  narrativeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    marginTop: spacing.sm,
  },
  narrativeIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.muted,
  },
  narrativeLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.mutedFg,
  },
  narrativeText: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.primary,
    marginTop: 2,
  },
  suggestionText: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    lineHeight: 16,
    color: colors.primary,
    marginTop: 4,
    textDecorationLine: "underline",
  },
  suggestionArrow: { textDecorationLine: "none" },
  narrativeScore: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  narrativeScoreText: {
    fontFamily: fonts.bodySemi,
    fontSize: 16,
    color: colors.primaryFg,
  },
});

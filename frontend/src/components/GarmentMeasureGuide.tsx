// Interactive garment-measurement guide for sellers.
//
// Renders a flat-lay diagram of the garment being listed (adapts to the
// item's garment_type) with labelled measurement arrows matching the
// dimension fields in the sizing step. When the seller focuses a dimension
// input, the corresponding arrow highlights + pulses so there's zero
// ambiguity about WHERE each number is measured.

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import { DIMENSION_HINTS, DIMENSION_LABELS, DimensionKey } from "@/src/lib/api";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

import { MeasureLine, MeasureSpec, PulseHalo } from "./MeasureGuideParts";

interface Props {
  garmentType: string;
  dimKeys: DimensionKey[];
  activeKey: DimensionKey | null;
}

type Family = "top" | "dress" | "skirt" | "trousers" | "shorts" | "belt" | "tie" | "scarf";

const FAMILY_BY_TYPE: Record<string, Family> = {
  shirt: "top",
  vest_under: "top",
  waistcoat: "top",
  outerwear: "top",
  dress: "dress",
  skirt: "skirt",
  trousers: "trousers",
  shorts: "shorts",
  belt: "belt",
  tie: "tie",
  scarf: "scarf",
};

const FILL = "#ECECEC";
const STROKE = "#C6C6C6";

interface Diagram {
  w: number;
  h: number;
  shapes: React.ReactElement;
  lines: Partial<Record<DimensionKey, MeasureSpec>>;
}

const DIAGRAMS: Record<Family, Diagram> = {
  top: {
    w: 220,
    h: 210,
    shapes: (
      <>
        <Path
          d="M 70 32 Q 110 54 150 32 L 185 50 L 205 97 L 172 110 L 165 92
             L 165 195 L 55 195 L 55 92 L 48 110 L 15 97 L 35 50 Z"
          fill={FILL}
          stroke={STROKE}
          strokeWidth={1.5}
        />
        <Path d="M 78 32 Q 110 48 142 32" fill="none" stroke={STROKE} strokeWidth={1.2} />
      </>
    ),
    lines: {
      shoulder_cm: { x1: 35, y1: 26, x2: 185, y2: 26, label: "SHOULDER", labelX: 110, labelY: 18 },
      chest_cm: { x1: 55, y1: 97, x2: 165, y2: 97, label: "CHEST", labelX: 110, labelY: 89 },
      sleeve_cm: { x1: 190, y1: 48, x2: 211, y2: 95, label: "SLEEVE", labelX: 198, labelY: 40 },
      length_cm: { x1: 140, y1: 40, x2: 140, y2: 193, label: "LENGTH", labelX: 140, labelY: 206 },
    },
  },
  dress: {
    w: 220,
    h: 248,
    shapes: (
      <Path
        d="M 80 28 Q 110 42 140 28 C 148 48 152 62 150 78
           C 146 96 140 106 136 118 C 150 146 162 180 170 230
           L 50 230 C 58 180 70 146 84 118
           C 80 106 74 96 70 78 C 68 62 72 48 80 28 Z"
        fill={FILL}
        stroke={STROKE}
        strokeWidth={1.5}
      />
    ),
    lines: {
      bust_cm: { x1: 70, y1: 76, x2: 150, y2: 76, label: "BUST", labelX: 110, labelY: 68 },
      waist_cm: { x1: 84, y1: 118, x2: 136, y2: 118, label: "WAIST", labelX: 110, labelY: 110 },
      hips_cm: { x1: 73, y1: 155, x2: 147, y2: 155, label: "HIPS", labelX: 110, labelY: 147 },
      length_cm: { x1: 130, y1: 34, x2: 130, y2: 228, label: "LENGTH", labelX: 130, labelY: 242 },
    },
  },
  skirt: {
    w: 220,
    h: 196,
    shapes: (
      <>
        <Path
          d="M 70 30 L 150 30 L 156 65 C 162 105 168 145 172 175 L 48 175
             C 52 145 58 105 64 65 Z"
          fill={FILL}
          stroke={STROKE}
          strokeWidth={1.5}
        />
        <Line x1={69} y1={42} x2={151} y2={42} stroke={STROKE} strokeWidth={1.2} />
      </>
    ),
    lines: {
      waist_cm: { x1: 70, y1: 22, x2: 150, y2: 22, label: "WAIST", labelX: 110, labelY: 14 },
      hips_cm: { x1: 64, y1: 65, x2: 156, y2: 65, label: "HIPS", labelX: 110, labelY: 57 },
      length_cm: { x1: 130, y1: 30, x2: 130, y2: 173, label: "LENGTH", labelX: 130, labelY: 189 },
    },
  },
  trousers: {
    w: 220,
    h: 256,
    shapes: (
      <>
        <Path
          d="M 72 30 L 148 30 C 151 55 153 80 153 105
             C 152 150 149 198 147 240 L 118 240
             C 117 198 115 158 112 120 Q 110 112 108 120
             C 105 158 103 198 102 240 L 73 240
             C 71 198 68 150 67 105 C 67 80 69 55 72 30 Z"
          fill={FILL}
          stroke={STROKE}
          strokeWidth={1.5}
        />
        <Line x1={71} y1={42} x2={149} y2={42} stroke={STROKE} strokeWidth={1.2} />
      </>
    ),
    lines: {
      waist_cm: { x1: 72, y1: 22, x2: 148, y2: 22, label: "WAIST", labelX: 110, labelY: 14 },
      hips_cm: { x1: 68, y1: 72, x2: 152, y2: 72, label: "HIPS", labelX: 110, labelY: 64 },
      rise_cm: { x1: 126, y1: 32, x2: 126, y2: 110, label: "RISE", labelX: 137, labelY: 70, rotate: true },
      inseam_cm: { x1: 110, y1: 118, x2: 110, y2: 238, label: "INSEAM", labelX: 110, labelY: 252 },
    },
  },
  shorts: {
    w: 220,
    h: 186,
    shapes: (
      <>
        <Path
          d="M 72 30 L 148 30 C 151 50 153 68 153 90
             C 152 118 151 138 150 160 L 116 160
             C 115 138 113 118 111 106 Q 110 101 109 106
             C 107 118 105 138 104 160 L 70 160
             C 69 138 68 118 67 90 C 67 68 69 50 72 30 Z"
          fill={FILL}
          stroke={STROKE}
          strokeWidth={1.5}
        />
        <Line x1={71} y1={42} x2={149} y2={42} stroke={STROKE} strokeWidth={1.2} />
      </>
    ),
    lines: {
      waist_cm: { x1: 72, y1: 22, x2: 148, y2: 22, label: "WAIST", labelX: 110, labelY: 14 },
      hips_cm: { x1: 67, y1: 66, x2: 153, y2: 66, label: "HIPS", labelX: 110, labelY: 58 },
      inseam_cm: { x1: 110, y1: 106, x2: 110, y2: 158, label: "INSEAM", labelX: 110, labelY: 176 },
    },
  },
  belt: {
    w: 220,
    h: 96,
    shapes: (
      <>
        <Rect x={30} y={40} width={170} height={20} rx={4} fill={FILL} stroke={STROKE} strokeWidth={1.5} />
        <Rect x={16} y={34} width={24} height={32} rx={3} fill="none" stroke={STROKE} strokeWidth={2} />
        {[150, 162, 174, 186].map((x) => (
          <Circle key={x} cx={x} cy={50} r={1.8} fill="#A0A0A0" />
        ))}
      </>
    ),
    lines: {
      waist_cm: { x1: 40, y1: 26, x2: 162, y2: 26, label: "WAIST", labelX: 100, labelY: 18 },
      length_cm: { x1: 16, y1: 76, x2: 200, y2: 76, label: "LENGTH", labelX: 110, labelY: 90 },
    },
  },
  tie: {
    w: 220,
    h: 246,
    shapes: (
      <>
        <Path d="M 96 20 L 124 20 L 130 44 L 90 44 Z" fill={FILL} stroke={STROKE} strokeWidth={1.5} />
        <Path d="M 99 44 L 121 44 L 134 196 L 110 228 L 86 196 Z" fill={FILL} stroke={STROKE} strokeWidth={1.5} />
      </>
    ),
    lines: {
      length_cm: { x1: 160, y1: 20, x2: 160, y2: 228, label: "LENGTH", labelX: 172, labelY: 124, rotate: true },
    },
  },
  scarf: {
    w: 220,
    h: 246,
    shapes: (
      <>
        <Rect x={80} y={20} width={60} height={194} fill={FILL} stroke={STROKE} strokeWidth={1.5} />
        {[86, 94, 102, 110, 118, 126, 134].map((x) => (
          <Line key={x} x1={x} y1={214} x2={x} y2={226} stroke={STROKE} strokeWidth={1.2} />
        ))}
      </>
    ),
    lines: {
      length_cm: { x1: 165, y1: 20, x2: 165, y2: 226, label: "LENGTH", labelX: 177, labelY: 123, rotate: true },
    },
  },
};

export function GarmentMeasureGuide({ garmentType, dimKeys, activeKey }: Props) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const family = FAMILY_BY_TYPE[garmentType];
  if (!family) return null;
  const d = DIAGRAMS[family];
  const lineKeys = dimKeys.filter((k) => d.lines[k]);
  if (lineKeys.length === 0) return null;

  const active = activeKey && d.lines[activeKey] ? d.lines[activeKey] : null;
  const halo =
    active && box
      ? {
          cx: (((active.x1 + active.x2) / 2) / d.w) * box.w,
          cy: (((active.y1 + active.y2) / 2) / d.h) * box.h,
        }
      : null;

  return (
    <View style={styles.card} testID="garment-measure-guide">
      <Text style={tp.caption}>Where to measure</Text>
      <View style={styles.bodyRow}>
        <View
          style={[styles.figureWrap, { aspectRatio: d.w / d.h }]}
          onLayout={(e) =>
            setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
          }
        >
          <Svg width="100%" height="100%" viewBox={`0 0 ${d.w} ${d.h}`}>
            {d.shapes}
            {lineKeys.map((k) => (
              <MeasureLine key={k} spec={d.lines[k]!} active={k === activeKey} />
            ))}
          </Svg>
          {halo ? <PulseHalo cx={halo.cx} cy={halo.cy} /> : null}
        </View>
        <View style={styles.legend}>
          {lineKeys.map((k) => {
            const on = k === activeKey;
            return (
              <View
                key={k}
                style={[styles.legendRow, on && styles.legendRowActive]}
                testID={`garment-legend-${k}`}
              >
                <Text style={[styles.legendLabel, on && styles.legendLabelActive]}>
                  {DIMENSION_LABELS[k]}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
      <Text style={styles.hint} testID="garment-guide-hint">
        {activeKey && d.lines[activeKey]
          ? `${DIMENSION_LABELS[activeKey]} — ${DIMENSION_HINTS[activeKey]}`
          : "Tap a measurement field below to highlight it on the garment."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  bodyRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm, alignItems: "center" },
  figureWrap: { width: "52%" },
  legend: { flex: 1, justifyContent: "center", gap: 4 },
  legendRow: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderLeftWidth: 2,
    borderLeftColor: "transparent",
  },
  legendRowActive: { borderLeftColor: colors.primary, backgroundColor: colors.muted },
  legendLabel: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.mutedFg },
  legendLabelActive: { color: colors.primary, fontFamily: fonts.bodySemi },
  hint: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 15,
    color: colors.mutedFg,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
});

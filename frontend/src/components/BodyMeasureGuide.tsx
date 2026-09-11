// Interactive body-measurement guide for buyers.
//
// Shows a gender-based front-facing silhouette with labelled measurement
// arrows (height, shoulders, chest, waist, hips, inseam). The arrow that
// matches the focused input is highlighted + pulses; the legend on the
// right mirrors the live values. When the AI estimator fills values in,
// the parent walks `activeKey` through each estimated measurement so the
// arrows light up one by one.

import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";

import { Measurements } from "@/src/lib/api";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";
import { cmToDisplay, LengthUnit } from "@/src/lib/units";

import { MeasureLine, MeasureSpec, PulseHalo } from "./MeasureGuideParts";

export type BodyMeasureKey = keyof Measurements;
export type GuideGender = "male" | "female" | "kid";

interface Props {
  gender: GuideGender;
  onChangeGender?: (g: GuideGender) => void;
  activeKey: BodyMeasureKey | null;
  values: Measurements;
  unit: LengthUnit;
}

const VB_W = 200;
const VB_H = 400;

// Top-to-bottom body order for the legend.
const GUIDE_ORDER: { key: BodyMeasureKey; label: string }[] = [
  { key: "height_cm", label: "Height" },
  { key: "shoulders_cm", label: "Shoulders" },
  { key: "chest_cm", label: "Chest" },
  { key: "waist_cm", label: "Waist" },
  { key: "hips_cm", label: "Hips" },
  { key: "inseam_cm", label: "Inseam" },
];

const HOW_TO: Record<BodyMeasureKey, string> = {
  height_cm: "Stand straight against a wall — measure from the floor to the top of your head.",
  shoulders_cm: "Across your back, from the edge of one shoulder bone to the other.",
  chest_cm: "Wrap the tape around the fullest part of your chest, under the armpits.",
  waist_cm: "Around your natural waistline, just above the belly button.",
  hips_cm: "Around the widest part of your hips and seat.",
  inseam_cm: "From the top of your inner thigh straight down to your ankle.",
};

const SPECS: Record<GuideGender, Record<BodyMeasureKey, MeasureSpec>> = {
  male: {
    height_cm: { x1: 175, y1: 10, x2: 175, y2: 388, label: "HEIGHT", labelX: 187, labelY: 199, rotate: true },
    shoulders_cm: { x1: 50, y1: 74, x2: 150, y2: 74, label: "SHOULDERS", labelX: 100, labelY: 67 },
    chest_cm: { x1: 57, y1: 105, x2: 143, y2: 105, label: "CHEST", labelX: 100, labelY: 98 },
    waist_cm: { x1: 62, y1: 168, x2: 138, y2: 168, label: "WAIST", labelX: 100, labelY: 161 },
    hips_cm: { x1: 58, y1: 205, x2: 142, y2: 205, label: "HIPS", labelX: 100, labelY: 198 },
    inseam_cm: { x1: 100, y1: 236, x2: 100, y2: 378, label: "INSEAM", labelX: 111, labelY: 307, rotate: true },
  },
  female: {
    height_cm: { x1: 175, y1: 8, x2: 175, y2: 388, label: "HEIGHT", labelX: 187, labelY: 199, rotate: true },
    shoulders_cm: { x1: 55, y1: 74, x2: 145, y2: 74, label: "SHOULDERS", labelX: 100, labelY: 67 },
    chest_cm: { x1: 58, y1: 108, x2: 142, y2: 108, label: "CHEST", labelX: 100, labelY: 101 },
    waist_cm: { x1: 72, y1: 165, x2: 128, y2: 165, label: "WAIST", labelX: 100, labelY: 158 },
    hips_cm: { x1: 54, y1: 208, x2: 146, y2: 208, label: "HIPS", labelX: 100, labelY: 201 },
    inseam_cm: { x1: 100, y1: 240, x2: 100, y2: 378, label: "INSEAM", labelX: 111, labelY: 308, rotate: true },
  },
  // Kids don't yet have their own silhouette; we reuse the female specs so
  // arrow positions still line up over the (also-female-shaped) fallback
  // figure. The parent picks kid gender for `audience === "kid"`.
  kid: {
    height_cm: { x1: 175, y1: 8, x2: 175, y2: 388, label: "HEIGHT", labelX: 187, labelY: 199, rotate: true },
    shoulders_cm: { x1: 55, y1: 74, x2: 145, y2: 74, label: "SHOULDERS", labelX: 100, labelY: 67 },
    chest_cm: { x1: 58, y1: 108, x2: 142, y2: 108, label: "CHEST", labelX: 100, labelY: 101 },
    waist_cm: { x1: 72, y1: 165, x2: 128, y2: 165, label: "WAIST", labelX: 100, labelY: 158 },
    hips_cm: { x1: 54, y1: 208, x2: 146, y2: 208, label: "HIPS", labelX: 100, labelY: 201 },
    inseam_cm: { x1: 100, y1: 240, x2: 100, y2: 378, label: "INSEAM", labelX: 111, labelY: 308, rotate: true },
  },
};

const FILL = "#E4E4E4";
const STROKE = "#C9C9C9";
const HAIR_FILL = "#D4D4D4";

function MaleFigure() {
  return (
    <>
      <Circle cx={100} cy={30} r={19} fill={FILL} stroke={STROKE} strokeWidth={1} />
      <Rect x={92} y={46} width={16} height={18} fill={FILL} />
      {/* Torso */}
      <Path
        d="M 55 78 Q 62 66 80 62 Q 100 57 120 62 Q 138 66 145 78
           C 144 88 143 97 143 105 C 141 128 139 148 138 168
           C 139 182 141 194 142 205 L 58 205
           C 59 194 61 182 62 168 C 61 148 59 128 57 105
           C 57 97 56 88 55 78 Z"
        fill={FILL}
        stroke={STROKE}
        strokeWidth={1}
      />
      {/* Arms */}
      <Path
        d="M 57 80 C 49 84 45 96 44 112 C 43 142 43 172 45 202 L 53 201
           C 52 174 52 144 54 114 C 54 100 55 89 59 83 Z"
        fill={FILL}
        stroke={STROKE}
        strokeWidth={1}
      />
      <Path
        d="M 143 80 C 151 84 155 96 156 112 C 157 142 157 172 155 202 L 147 201
           C 148 174 148 144 146 114 C 146 100 145 89 141 83 Z"
        fill={FILL}
        stroke={STROKE}
        strokeWidth={1}
      />
      {/* Legs */}
      <Path
        d="M 58 205 L 142 205 C 141 240 138 275 135 310 C 133 340 132 360 131 380
           L 112 380 C 112 350 110 315 107 285 Q 103 255 100 232
           Q 97 255 93 285 C 90 315 88 350 88 380 L 69 380
           C 68 360 67 340 65 310 C 62 275 59 240 58 205 Z"
        fill={FILL}
        stroke={STROKE}
        strokeWidth={1}
      />
      <Ellipse cx={78.5} cy={384} rx={12} ry={5} fill={FILL} stroke={STROKE} strokeWidth={1} />
      <Ellipse cx={121.5} cy={384} rx={12} ry={5} fill={FILL} stroke={STROKE} strokeWidth={1} />
    </>
  );
}

function FemaleFigure() {
  return (
    <>
      {/* Hair */}
      <Path
        d="M 100 8 C 118 8 128 22 127 40 C 127 52 124 60 120 64 L 116 48
           C 116 30 110 24 100 24 C 90 24 84 30 84 48 L 80 64
           C 76 60 73 52 73 40 C 72 22 82 8 100 8 Z"
        fill={HAIR_FILL}
        stroke={STROKE}
        strokeWidth={1}
      />
      <Circle cx={100} cy={31} r={17} fill={FILL} stroke={STROKE} strokeWidth={1} />
      <Rect x={93} y={48} width={14} height={18} fill={FILL} />
      {/* Torso */}
      <Path
        d="M 60 78 Q 66 66 82 62 Q 100 58 118 62 Q 134 66 140 78
           C 142 90 143 100 142 108 C 138 125 132 145 128 165
           C 134 180 142 194 146 208 L 54 208
           C 58 194 66 180 72 165 C 68 145 62 125 58 108
           C 57 100 58 90 60 78 Z"
        fill={FILL}
        stroke={STROKE}
        strokeWidth={1}
      />
      {/* Arms */}
      <Path
        d="M 59 80 C 51 85 47 97 46 113 C 45 142 45 172 47 202 L 54 201
           C 53 174 53 145 55 116 C 55 102 56 90 60 84 Z"
        fill={FILL}
        stroke={STROKE}
        strokeWidth={1}
      />
      <Path
        d="M 141 80 C 149 85 153 97 154 113 C 155 142 155 172 153 202 L 146 201
           C 147 174 147 145 145 116 C 145 102 144 90 140 84 Z"
        fill={FILL}
        stroke={STROKE}
        strokeWidth={1}
      />
      {/* Legs */}
      <Path
        d="M 54 208 L 146 208 C 144 245 141 278 137 310 C 134 340 132 360 131 380
           L 113 380 C 113 350 111 315 108 285 Q 104 258 100 236
           Q 96 258 92 285 C 89 315 87 350 87 380 L 69 380
           C 68 360 66 340 63 310 C 59 278 56 245 54 208 Z"
        fill={FILL}
        stroke={STROKE}
        strokeWidth={1}
      />
      <Ellipse cx={78} cy={384} rx={11} ry={5} fill={FILL} stroke={STROKE} strokeWidth={1} />
      <Ellipse cx={122} cy={384} rx={11} ry={5} fill={FILL} stroke={STROKE} strokeWidth={1} />
    </>
  );
}

export function BodyMeasureGuide({ gender, onChangeGender, activeKey, values, unit }: Props) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // Defensive fallback — if a caller ever passes an unknown gender, we
  // render the female-shaped guide instead of crashing on `specs[key]`.
  const specs = SPECS[gender] ?? SPECS.female;
  const active = activeKey ? specs[activeKey] : null;
  const halo =
    active && box
      ? {
          cx: (((active.x1 + active.x2) / 2) / VB_W) * box.w,
          cy: (((active.y1 + active.y2) / 2) / VB_H) * box.h,
        }
      : null;

  const fmt = (v?: number | null) => {
    if (v == null) return "—";
    const s = cmToDisplay(v, unit);
    return unit === "ft" ? s : `${s} ${unit}`;
  };

  return (
    <View style={styles.card} testID="body-measure-guide">
      <View style={styles.headRow}>
        <Text style={tp.caption}>Measurement guide</Text>
        {/* Gender toggle only makes sense when the parent wants the user
            to be able to flip the figure. Loved-one flows pre-select
            gender/audience upstream and pass no callback. */}
        {onChangeGender ? (
          <View style={styles.genderRow}>
            {(["male", "female"] as GuideGender[]).map((g) => {
              const on = g === gender;
              return (
                <TouchableOpacity
                  key={g}
                  testID={`guide-gender-${g}`}
                  onPress={() => onChangeGender(g)}
                  style={[styles.genderBtn, on ? styles.genderBtnActive : styles.genderBtnInactive]}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.genderLabel, on ? styles.genderLabelActive : styles.genderLabelInactive]}>
                    {g === "male" ? "MALE" : "FEMALE"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </View>

      <View style={styles.bodyRow}>
        <View
          style={styles.figureWrap}
          onLayout={(e) =>
            setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
          }
        >
          <Svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`}>
            {gender === "male" ? <MaleFigure /> : <FemaleFigure />}
            {GUIDE_ORDER.map(({ key }) => (
              <MeasureLine key={key} spec={specs[key]} active={key === activeKey} />
            ))}
          </Svg>
          {halo ? <PulseHalo cx={halo.cx} cy={halo.cy} /> : null}
        </View>

        <View style={styles.legend}>
          {GUIDE_ORDER.map(({ key, label }) => {
            const on = key === activeKey;
            return (
              <View
                key={key}
                style={[styles.legendRow, on && styles.legendRowActive]}
                testID={`guide-legend-${key}`}
              >
                <Text style={[styles.legendLabel, on && styles.legendLabelActive]}>{label}</Text>
                <Text style={[styles.legendValue, on && styles.legendValueActive]}>
                  {fmt(values[key])}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      <Text style={styles.hint} testID="guide-hint">
        {activeKey
          ? HOW_TO[activeKey]
          : "Tap a field below and the matching arrow lights up to show you where to measure."}
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
    marginBottom: spacing.md,
  },
  headRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  genderRow: { flexDirection: "row" },
  genderBtn: { paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, marginLeft: -1 },
  genderBtnInactive: { borderColor: colors.border, backgroundColor: colors.surface },
  genderBtnActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  genderLabel: { fontFamily: fonts.bodySemi, fontSize: 10, letterSpacing: 1.2 },
  genderLabelInactive: { color: colors.primary },
  genderLabelActive: { color: colors.primaryFg },
  bodyRow: { flexDirection: "row", gap: spacing.md },
  figureWrap: { width: "46%", aspectRatio: VB_W / VB_H },
  legend: { flex: 1, justifyContent: "center", gap: 4 },
  legendRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderLeftWidth: 2,
    borderLeftColor: "transparent",
  },
  legendRowActive: { borderLeftColor: colors.primary, backgroundColor: colors.muted },
  legendLabel: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.mutedFg },
  legendLabelActive: { color: colors.primary, fontFamily: fonts.bodySemi },
  legendValue: { fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg },
  legendValueActive: { color: colors.primary, fontFamily: fonts.bodySemi },
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

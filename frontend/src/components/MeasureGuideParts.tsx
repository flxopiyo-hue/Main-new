// Shared building blocks for the interactive measurement guides
// (BodyMeasureGuide for buyers, GarmentMeasureGuide for sellers).
//
// - MeasureLine: an SVG measurement indicator — a line with arrowheads at
//   both ends and a small uppercase label. Inactive lines render dashed +
//   grey; the active one is solid black and slightly thicker.
// - PulseHalo: an RN overlay that pulses over the active line's midpoint so
//   the eye is drawn to WHERE the focused measurement lives on the figure.

import React, { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, View } from "react-native";
import { Line, Polygon, Text as SvgText } from "react-native-svg";

import { colors } from "@/src/lib/theme";

export interface MeasureSpec {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  labelX: number;
  labelY: number;
  rotate?: boolean;
}

const INACTIVE = "#B4B4B4";
const INACTIVE_LABEL = "#8E8E8E";

export function MeasureLine({ spec, active }: { spec: MeasureSpec; active: boolean }) {
  const { x1, y1, x2, y2, label, labelX, labelY, rotate } = spec;
  const color = active ? colors.primary : INACTIVE;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const size = active ? 6 : 4.5;
  // Triangle arrowhead with its tip at (tx, ty), pointing along (dx, dy).
  const head = (tx: number, ty: number, dx: number, dy: number) => {
    const bx = tx - dx * size;
    const by = ty - dy * size;
    const px = -dy;
    const py = dx;
    return `${tx},${ty} ${bx + px * size * 0.55},${by + py * size * 0.55} ${bx - px * size * 0.55},${by - py * size * 0.55}`;
  };
  return (
    <>
      <Line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={active ? 2.2 : 1.1}
        strokeDasharray={active ? undefined : "4 3"}
      />
      <Polygon points={head(x1, y1, -ux, -uy)} fill={color} />
      <Polygon points={head(x2, y2, ux, uy)} fill={color} />
      <SvgText
        x={labelX}
        y={labelY}
        fill={active ? colors.primary : INACTIVE_LABEL}
        fontSize={active ? 9.5 : 8}
        fontWeight={active ? "700" : "500"}
        textAnchor="middle"
        letterSpacing="1"
        transform={rotate ? `rotate(-90 ${labelX} ${labelY})` : undefined}
      >
        {label}
      </SvgText>
    </>
  );
}

export function PulseHalo({ cx, cy }: { cx: number; cy: number }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    anim.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== "web",
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, cx, cy]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.35] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.08] });

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[haloStyles.ring, { left: cx - 16, top: cy - 16, opacity, transform: [{ scale }] }]}
      />
      <View pointerEvents="none" style={[haloStyles.dot, { left: cx - 3.5, top: cy - 3.5 }]} />
    </>
  );
}

const haloStyles = StyleSheet.create({
  ring: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: "rgba(10,10,10,0.08)",
  },
  dot: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
});

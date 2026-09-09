// AI try-on result image — auto-fits any aspect ratio without the
// grey letterbox bars that a fixed-height container caused. Reads the
// actual image dimensions via `Image.getSize` and applies
// `aspectRatio` to the container so the image fills the width and the
// container is exactly as tall as the picture needs.
//
// Also handles the "the image is a base64 data URI" case (no network
// dimensions available) by falling back to a sensible portrait
// default until the picture has decoded.
//
// Props mirror the old inline `<Image>` usage so replacing the
// existing code is a one-line swap.

import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  ImageStyle,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
  useWindowDimensions,
} from "react-native";

import { colors } from "@/src/lib/theme";

type Props = {
  uri: string;
  onPress?: () => void;
  // Cap the container to this many percent of the screen height so
  // portrait renders can't push the CTAs off the fold. Default 70%.
  maxScreenHeightPct?: number;
  // Cap the tallest allowed aspect ratio (w/h). Anything narrower is
  // clamped so extreme 9:19 renders don't dominate the screen.
  minAspectRatio?: number;
  // Optional style overrides on the container.
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  testID?: string;
};

export function TryOnResultImage({
  uri,
  onPress,
  maxScreenHeightPct = 0.7,
  minAspectRatio = 0.6, // 3:5 — anything narrower is clamped
  style,
  imageStyle,
  testID,
}: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [ar, setAr] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!uri) return;
    Image.getSize(
      uri,
      (w, h) => {
        if (cancelled || !w || !h) return;
        setAr(w / h);
      },
      () => {
        // Fallback — assume portrait 9:16 which is Gemini's typical
        // output ratio.
        if (!cancelled) setAr(9 / 16);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  // Compute the aspect ratio to apply to the container. Never go
  // narrower than `minAspectRatio`, and never taller than
  // `maxScreenHeightPct * winH`.
  const effectiveAspect = useMemo(() => {
    const raw = ar ?? 9 / 16; // portrait default until getSize resolves
    const clamped = Math.max(raw, minAspectRatio);
    // If the image would push past our height cap, tighten the aspect
    // so the container fits inside `maxScreenHeightPct` of the screen.
    const maxH = winH * maxScreenHeightPct;
    const projectedH = winW / clamped;
    if (projectedH > maxH) return winW / maxH;
    return clamped;
  }, [ar, minAspectRatio, maxScreenHeightPct, winW, winH]);

  const inner = (
    <View
      style={[styles.wrap, { aspectRatio: effectiveAspect }, style]}
      testID={testID}
    >
      <Image
        source={{ uri }}
        style={[styles.img, imageStyle]}
        resizeMode="cover"
        // On web `Image.getSize` sometimes returns 0 for data URIs;
        // this fallback lets Metro's Image pick up dimensions from the
        // decoded blob.
        {...(Platform.OS === "web" ? { onLoad: undefined } : {})}
      />
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="imagebutton">
        {inner}
      </Pressable>
    );
  }
  return inner;
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  img: { width: "100%", height: "100%" },
});

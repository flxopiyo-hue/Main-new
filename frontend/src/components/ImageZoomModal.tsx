// Full-screen image viewer with pinch-to-zoom, pan, double-tap zoom,
// explicit +/- buttons — AND (new) horizontal paging between multiple
// images. Used by the AI try-on previews so users can flick through
// front / three-quarter / side / back angles without leaving the
// zoom viewer.
//
// Backwards compatible: pass either `uri` (single image) or `images`
// (array with optional `labels` for a header caption). If both are
// supplied, `images` wins.

import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

interface Props {
  visible: boolean;
  uri?: string | null;
  // NEW — multiple images with optional per-page labels.
  images?: string[];
  labels?: string[];
  initialIndex?: number;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;

// -----------------------------------------------------------------------
// Single page — one image inside the horizontal pager. Owns its own
// pinch / pan / double-tap state so zoom on page 2 doesn't leak into
// page 1. Reports "is this page currently zoomed?" up to the parent so
// the parent can disable horizontal scrolling while zoomed.
// -----------------------------------------------------------------------
function ZoomablePage({
  uri,
  width,
  height,
  active,
  onZoomChange,
}: {
  uri: string;
  width: number;
  height: number;
  active: boolean;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // Reset zoom whenever this page becomes inactive so the user always
  // lands on the next image un-zoomed.
  useEffect(() => {
    if (!active) {
      scale.value = 1;
      savedScale.value = 1;
      tx.value = 0;
      ty.value = 0;
      savedTx.value = 0;
      savedTy.value = 0;
      onZoomChange(false);
    }
  }, [active, scale, savedScale, tx, ty, savedTx, savedTy, onZoomChange]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      runOnJS(onZoomChange)(scale.value > 1.01);
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = scale.value > 1 ? 1 : 2.5;
      scale.value = withTiming(next);
      savedScale.value = next;
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      savedTx.value = 0;
      savedTy.value = 0;
      runOnJS(onZoomChange)(next > 1);
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);
  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[styles.stage, { width, height }]}>
        <Animated.Image
          source={{ uri }}
          style={[styles.image, animStyle]}
          resizeMode="contain"
        />
      </Animated.View>
    </GestureDetector>
  );
}

export function ImageZoomModal({
  visible,
  uri,
  images,
  labels,
  initialIndex = 0,
  onClose,
}: Props) {
  const { width, height } = useWindowDimensions();

  // Normalise props → always operate on `pages[]` internally.
  const pages = useMemo<string[]>(() => {
    if (images && images.length > 0) return images.filter(Boolean);
    if (uri) return [uri];
    return [];
  }, [images, uri]);
  const pageCount = pages.length;

  const scrollRef = useRef<ScrollView>(null);
  const [pageIndex, setPageIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);

  // Snap to the requested initial page (and reset zoom state) every
  // time the viewer opens — so relaunching the modal on Angle #3 lands
  // there instead of Angle #0.
  useEffect(() => {
    if (visible) {
      const idx = Math.min(Math.max(initialIndex, 0), Math.max(pageCount - 1, 0));
      setPageIndex(idx);
      setZoomed(false);
      // requestAnimationFrame gives the ScrollView a beat to lay out.
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ x: idx * width, animated: false });
      });
    }
  }, [visible, initialIndex, pageCount, width]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const next = Math.round(x / width);
    if (next !== pageIndex && next >= 0 && next < pageCount) {
      setPageIndex(next);
    }
  };

  const goTo = (idx: number) => {
    const clamped = Math.min(Math.max(idx, 0), pageCount - 1);
    scrollRef.current?.scrollTo({ x: clamped * width, animated: true });
    setPageIndex(clamped);
  };

  const currentLabel = labels?.[pageIndex] ?? "";

  return (
    <Modal
      visible={visible}
      animationType="none"
      onRequestClose={onClose}
      testID="image-zoom-modal"
    >
      <GestureHandlerRootView style={styles.root}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          // Disable horizontal paging while any page is zoomed — otherwise
          // the pan gesture inside a zoomed image fights the scroll view.
          scrollEnabled={!zoomed && pageCount > 1}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          bounces={false}
          testID="image-zoom-scroll"
        >
          {pages.map((pageUri, idx) => (
            <ZoomablePage
              key={`${pageUri.slice(0, 32)}-${idx}`}
              uri={pageUri}
              width={width}
              height={height}
              active={idx === pageIndex}
              onZoomChange={setZoomed}
            />
          ))}
        </ScrollView>

        <SafeAreaView style={styles.topBar} pointerEvents="box-none">
          <View style={styles.topRow}>
            {pageCount > 1 ? (
              <View style={styles.counterPill} pointerEvents="none">
                <Text style={styles.counterText}>
                  {currentLabel
                    ? `${currentLabel} · ${pageIndex + 1} / ${pageCount}`
                    : `${pageIndex + 1} / ${pageCount}`}
                </Text>
              </View>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <TouchableOpacity
              testID="image-zoom-close"
              onPress={onClose}
              style={styles.roundBtn}
              accessibilityLabel="Close image viewer"
            >
              <Feather name="x" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        <SafeAreaView style={styles.bottomBar} pointerEvents="box-none" edges={["bottom"]}>
          {pageCount > 1 ? (
            <View style={styles.arrowRow}>
              <TouchableOpacity
                testID="image-zoom-prev"
                onPress={() => goTo(pageIndex - 1)}
                disabled={pageIndex === 0}
                style={[styles.roundBtn, pageIndex === 0 && styles.roundBtnDisabled]}
                accessibilityLabel="Previous image"
              >
                <Feather name="chevron-left" size={22} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={styles.dots}>
                {pages.map((_, i) => (
                  <View
                    key={i}
                    style={[styles.dot, i === pageIndex && styles.dotActive]}
                  />
                ))}
              </View>
              <TouchableOpacity
                testID="image-zoom-next"
                onPress={() => goTo(pageIndex + 1)}
                disabled={pageIndex === pageCount - 1}
                style={[
                  styles.roundBtn,
                  pageIndex === pageCount - 1 && styles.roundBtnDisabled,
                ]}
                accessibilityLabel="Next image"
              >
                <Feather name="chevron-right" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.hint}>Pinch or double-tap to zoom</Text>
          )}
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  stage: { alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    padding: 16,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  counterPill: {
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  counterText: {
    color: "#FFFFFF",
    fontSize: 12,
    letterSpacing: 1.2,
  },
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16 },
  arrowRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  dots: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  dotActive: { backgroundColor: "#FFFFFF" },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  roundBtnDisabled: { opacity: 0.35 },
  hint: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    textAlign: "center",
  },
});

// Full-screen image viewer with pinch-to-zoom, pan, double-tap zoom and
// explicit +/- buttons (handy on web where pinch isn't available).
// Used by the AI try-on previews so large generated images can be viewed
// comfortably and inspected up close.

import { Feather } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

interface Props {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;

export function ImageZoomModal({ visible, uri, onClose }: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // Reset zoom state every time the viewer opens.
  useEffect(() => {
    if (visible) {
      scale.value = 1;
      savedScale.value = 1;
      tx.value = 0;
      ty.value = 0;
      savedTx.value = 0;
      savedTy.value = 0;
    }
  }, [visible, scale, savedScale, tx, ty, savedTx, savedTy]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
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
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  const bumpZoom = (dir: 1 | -1) => {
    const next = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, savedScale.value * (dir === 1 ? 1.5 : 1 / 1.5)),
    );
    scale.value = withTiming(next);
    savedScale.value = next;
    if (next === 1) {
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      savedTx.value = 0;
      savedTy.value = 0;
    }
  };

  return (
    <Modal visible={visible} animationType="none" onRequestClose={onClose} testID="image-zoom-modal">
      <GestureHandlerRootView style={styles.root}>
        <GestureDetector gesture={composed}>
          <Animated.View style={styles.stage}>
            {uri ? (
              <Animated.Image
                source={{ uri }}
                style={[styles.image, animStyle]}
                resizeMode="contain"
              />
            ) : null}
          </Animated.View>
        </GestureDetector>

        <SafeAreaView style={styles.topBar} pointerEvents="box-none">
          <TouchableOpacity
            testID="image-zoom-close"
            onPress={onClose}
            style={styles.roundBtn}
            accessibilityLabel="Close image viewer"
          >
            <Feather name="x" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </SafeAreaView>

        <SafeAreaView style={styles.bottomBar} pointerEvents="box-none" edges={["bottom"]}>
          <View style={styles.zoomControls}>
            <TouchableOpacity
              testID="image-zoom-out"
              onPress={() => bumpZoom(-1)}
              style={styles.roundBtn}
              accessibilityLabel="Zoom out"
            >
              <Feather name="minus" size={18} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.hint}>Pinch or double-tap to zoom</Text>
            <TouchableOpacity
              testID="image-zoom-in"
              onPress={() => bumpZoom(1)}
              style={styles.roundBtn}
              accessibilityLabel="Zoom in"
            >
              <Feather name="plus" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "flex-end",
    padding: 16,
  },
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16 },
  zoomControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
  },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
});

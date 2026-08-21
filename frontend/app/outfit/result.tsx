// Outfit try-on result viewer. Loads a stored multi-angle outfit try-on by id
// and shows the same swap-angle UI as the single-item viewer.

import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { ImageZoomModal } from "@/src/components/ImageZoomModal";
import { useToast } from "@/src/components/Toast";
import { api, TryOnAngle, TryOnImageOut, TryOnResult } from "@/src/lib/api";
import { dataUriFromBase64 } from "@/src/lib/images";
import { shareBase64Image } from "@/src/lib/share";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const ANGLE_LABEL: Record<TryOnAngle, string> = {
  front: "Front",
  three_quarter: "3/4",
  side: "Side",
  back: "Back",
};

export default function OutfitResult() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const toast = useToast();
  const [tryon, setTryon] = useState<TryOnResult | null>(null);
  const [angles, setAngles] = useState<TryOnImageOut[]>([]);
  const [active, setActive] = useState<TryOnAngle>("front");
  const [sharing, setSharing] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const { height: winH } = useWindowDimensions();

  useEffect(() => {
    (async () => {
      try {
        const history = await api.tryOnHistory();
        const t = history.find((h) => h.id === id);
        if (!t) {
          toast.show("Could not load that outfit try-on", "error");
          router.back();
          return;
        }
        setTryon(t);
        const imgs = t.images && t.images.length > 0
          ? t.images
          : [{ angle: "front" as TryOnAngle, image_b64: t.result_image_b64 }];
        setAngles(imgs);
        setActive(imgs[0].angle);
      } catch (e: any) {
        toast.show(e?.message ?? "Failed to load outfit", "error");
      }
    })();
  }, [id, toast]);

  const onShare = async (fmt: "square" | "story") => {
    if (!tryon) return;
    setSharing(true);
    try {
      const data = await api.shareTryOn(tryon.id, fmt, active);
      const ok = await shareBase64Image(
        data.image_b64,
        `oromona-outfit-${active}-${fmt}`,
      );
      if (!ok) toast.show("Sharing not available on this device", "error");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not share", "error");
    } finally {
      setSharing(false);
    }
  };

  if (!tryon) {
    return (
      <SafeAreaView style={[styles.root, styles.center]} edges={["top"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const activeImg = angles.find((a) => a.angle === active) ?? angles[0];

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Hero capped to ~60% of the screen so controls stay visible;
            tap (or the zoom icon) opens the full-screen pinch-zoom viewer. */}
        <View style={[styles.heroWrap, { height: Math.round(winH * 0.6) }]}>
          <Pressable style={styles.heroPress} onPress={() => setZoomOpen(true)}>
            <Image
              source={{ uri: dataUriFromBase64(activeImg.image_b64) }}
              style={styles.hero}
              resizeMode="contain"
            />
          </Pressable>
          <SafeAreaView style={styles.heroOverlay} edges={["top"]} pointerEvents="box-none">
            <View style={styles.heroBar}>
              <TouchableOpacity
                testID="outfit-result-back"
                onPress={() => router.back()}
                style={styles.heroIcon}
              >
                <Feather name="arrow-left" size={20} color={colors.primaryFg} />
              </TouchableOpacity>
              <TouchableOpacity
                testID="outfit-result-zoom"
                onPress={() => setZoomOpen(true)}
                style={styles.heroIcon}
                accessibilityLabel="Zoom image"
              >
                <Feather name="maximize-2" size={18} color={colors.primaryFg} />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>

        {angles.length > 1 ? (
          <View style={styles.angleStrip} testID="outfit-angle-strip">
            {angles.map((a) => {
              const isActive = a.angle === active;
              return (
                <TouchableOpacity
                  key={a.angle}
                  testID={`outfit-angle-${a.angle}`}
                  onPress={() => setActive(a.angle)}
                  style={[styles.angleThumb, isActive && styles.angleThumbActive]}
                  activeOpacity={0.85}
                >
                  <Image
                    source={{ uri: dataUriFromBase64(a.image_b64) }}
                    style={styles.angleThumbImg}
                    resizeMode="cover"
                  />
                  <Text
                    style={[styles.angleThumbLabel, isActive && styles.angleThumbLabelActive]}
                  >
                    {ANGLE_LABEL[a.angle]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        <View style={styles.body}>
          <Text style={tp.caption}>YOUR OUTFIT TRY-ON</Text>
          <Text style={[tp.h2, { marginTop: 6 }]}>Composed Look</Text>
          {tryon.fit_summary ? (
            <Text style={[tp.bodyMuted, { marginTop: spacing.sm }]} testID="outfit-fit-summary">
              {tryon.fit_summary}
            </Text>
          ) : null}

          <View style={{ height: spacing.lg }} />
          <Text style={tp.caption}>Sharing the {ANGLE_LABEL[active]} angle</Text>
          <View style={{ height: spacing.sm }} />
          <AppButton
            testID="outfit-share-square"
            label="Share · Square"
            variant="secondary"
            onPress={() => onShare("square")}
            loading={sharing}
          />
          <View style={{ height: spacing.sm }} />
          <AppButton
            testID="outfit-share-story"
            label="Share · Story 9:16"
            onPress={() => onShare("story")}
            loading={sharing}
          />
        </View>
      </ScrollView>
      <ImageZoomModal
        visible={zoomOpen}
        uri={dataUriFromBase64(activeImg.image_b64)}
        onClose={() => setZoomOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  scroll: { paddingBottom: spacing.xxl },
  heroWrap: { width: "100%", backgroundColor: colors.muted },
  heroPress: { width: "100%", height: "100%" },
  hero: { width: "100%", height: "100%" },
  heroOverlay: { ...StyleSheet.absoluteFillObject, padding: spacing.md },
  heroBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroIcon: {
    width: 40,
    height: 40,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  angleStrip: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  angleThumb: {
    flex: 1,
    alignItems: "center",
    paddingBottom: 4,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  angleThumbActive: { borderBottomColor: colors.primary },
  angleThumbImg: {
    width: "100%",
    aspectRatio: 3 / 4,
    backgroundColor: colors.muted,
    marginBottom: 6,
  },
  angleThumbLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.mutedFg,
    textTransform: "uppercase",
  },
  angleThumbLabelActive: { color: colors.primary },
  body: { padding: spacing.lg },
});

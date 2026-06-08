import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { HeartButton } from "@/src/components/HeartButton";
import { useToast } from "@/src/components/Toast";
import { api, BACKEND_URL, ColorOption, Item, SizeOption } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { dataUriFromBase64 } from "@/src/lib/images";
import { shareBase64Image } from "@/src/lib/share";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function ItemDetail() {
  const { id, tryon } = useLocalSearchParams<{ id: string; tryon?: string }>();
  const { user } = useAuth();
  const toast = useToast();

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSize, setSelectedSize] = useState<SizeOption | null>(null);
  const [selectedColor, setSelectedColor] = useState<ColorOption | null>(null);
  const [tryOnId, setTryOnId] = useState<string | null>(null);
  const [tryOnImage, setTryOnImage] = useState<string | null>(null);
  const [fitSummary, setFitSummary] = useState<string | null>(null);
  const [wished, setWished] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [buying, setBuying] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, wl] = await Promise.all([
        api.getItem(String(id)),
        user?.role === "buyer" ? api.wishlistIds() : Promise.resolve({ item_ids: [] }),
      ]);
      setItem(data);
      setWished(wl.item_ids.includes(String(id)));
      if (data.sizes.length > 0) {
        const inStock = data.sizes.find((s) => s.available_qty > 0) ?? data.sizes[0];
        setSelectedSize(inStock);
      }
      if (data.colors.length > 0) setSelectedColor(data.colors[0]);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load item", "error");
    } finally {
      setLoading(false);
    }
  }, [id, toast, user?.role]);

  useEffect(() => {
    load();
  }, [load]);

  const runTryOn = useCallback(async () => {
    if (!item) return;
    setGenerating(true);
    try {
      const profile = await api.getProfile();
      if (!profile.has_front_photo) {
        toast.show("Add a front photo in your profile first", "error");
        setGenerating(false);
        router.push("/onboarding/measurements");
        return;
      }
      const result = await api.tryOn({ item_id: item.id, use_profile_photo: true });
      setTryOnImage(result.result_image_b64);
      setTryOnId(result.id);
      setFitSummary(result.fit_summary ?? null);
    } catch (e: any) {
      toast.show(e?.message ?? "Try-on failed", "error");
    } finally {
      setGenerating(false);
    }
  }, [item, toast]);

  useEffect(() => {
    if (tryon === "1" && item && !tryOnImage && !generating) {
      runTryOn();
    }
  }, [tryon, item, tryOnImage, generating, runTryOn]);

  const onShare = async () => {
    if (!tryOnId) return;
    setSharing(true);
    try {
      const data = await api.shareTryOn(tryOnId);
      const ok = await shareBase64Image(data.image_b64, "aurafit-tryon");
      if (!ok) toast.show("Sharing not available on this device", "error");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not share", "error");
    } finally {
      setSharing(false);
    }
  };

  const buy = async () => {
    if (!item || !selectedSize) return;
    if (user?.role !== "buyer") {
      toast.show("Sign in as a buyer to purchase", "error");
      return;
    }
    setBuying(true);
    try {
      const { url } = await api.checkout({
        item_id: item.id,
        size: selectedSize.label,
        color: selectedColor?.name,
        origin_url: BACKEND_URL,
      });
      await WebBrowser.openBrowserAsync(url);
      // After return, navigate to orders
      router.push("/(tabs)/profile");
    } catch (e: any) {
      toast.show(e?.message ?? "Checkout failed", "error");
    } finally {
      setBuying(false);
    }
  };

  if (loading || !item) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const displayImage = tryOnImage
    ? dataUriFromBase64(tryOnImage)
    : dataUriFromBase64(item.image_b64);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroWrap}>
          <Image source={{ uri: displayImage }} style={styles.hero} resizeMode="cover" />
          <SafeAreaView style={styles.heroOverlay} edges={["top"]} pointerEvents="box-none">
            <View style={styles.heroBar}>
              <TouchableOpacity
                testID="item-back-btn"
                onPress={() => router.back()}
                style={styles.heroIcon}
              >
                <Feather name="arrow-left" size={20} color={colors.primaryFg} />
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
              {tryOnImage ? (
                <TouchableOpacity
                  testID="item-reset-tryon"
                  onPress={() => {
                    setTryOnImage(null);
                    setFitSummary(null);
                  }}
                  style={styles.heroIcon}
                >
                  <Feather name="rotate-ccw" size={18} color={colors.primaryFg} />
                </TouchableOpacity>
              ) : null}
            </View>
          </SafeAreaView>
          {generating ? (
            <View style={styles.generating} testID="item-generating-overlay">
              <ActivityIndicator size="large" color={colors.primaryFg} />
              <Text style={styles.generatingText}>AI is dressing your photo…</Text>
            </View>
          ) : null}
        </View>

        {fitSummary ? (
          <View style={styles.fitBanner} testID="item-fit-summary">
            <Feather name="award" size={14} color={colors.primaryFg} />
            <Text style={styles.fitText}>{fitSummary}</Text>
          </View>
        ) : null}

        <View style={styles.body}>
          <Text style={tp.caption} testID="item-seller">
            {item.seller_name.toUpperCase()}
          </Text>
          <Text style={[tp.h1, { marginTop: 6 }]} testID="item-name">
            {item.name}
          </Text>
          <Text style={styles.price} testID="item-price">
            ${(item.price_cents / 100).toFixed(0)}
          </Text>
          {item.description ? (
            <Text style={[tp.body, { marginTop: spacing.md }]}>{item.description}</Text>
          ) : null}

          <Text style={[tp.caption, styles.subhead]}>Size</Text>
          <View style={styles.sizeRow}>
            {item.sizes.map((s) => {
              const selected = selectedSize?.label === s.label;
              const out = s.available_qty <= 0;
              return (
                <TouchableOpacity
                  key={s.label}
                  testID={`item-size-${s.label}`}
                  disabled={out}
                  onPress={() => setSelectedSize(s)}
                  style={[
                    styles.sizeChip,
                    selected ? styles.sizeChipActive : styles.sizeChipInactive,
                    out && styles.sizeChipOut,
                  ]}
                >
                  <Text
                    style={[
                      styles.sizeLabel,
                      selected ? styles.sizeLabelActive : styles.sizeLabelInactive,
                      out && styles.sizeLabelOut,
                    ]}
                  >
                    {s.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {selectedSize ? (
            <View style={styles.sizeMeta} testID="item-size-detail">
              <Text style={tp.bodyMuted}>
                {selectedSize.chest_cm ? `Chest ${selectedSize.chest_cm}cm · ` : ""}
                {selectedSize.waist_cm ? `Waist ${selectedSize.waist_cm}cm · ` : ""}
                {selectedSize.hips_cm ? `Hips ${selectedSize.hips_cm}cm · ` : ""}
                {selectedSize.length_cm ? `Length ${selectedSize.length_cm}cm` : ""}
              </Text>
              <Text style={[tp.bodyMuted, { marginTop: 2 }]}>
                {selectedSize.available_qty > 0
                  ? `${selectedSize.available_qty} in stock`
                  : "Out of stock"}
              </Text>
            </View>
          ) : null}

          {item.colors.length > 0 ? (
            <>
              <Text style={[tp.caption, styles.subhead]}>Color</Text>
              <View style={styles.colorRow}>
                {item.colors.map((c) => {
                  const selected = selectedColor?.name === c.name;
                  return (
                    <TouchableOpacity
                      key={c.name}
                      testID={`item-color-${c.name}`}
                      onPress={() => setSelectedColor(c)}
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: c.hex },
                        selected && styles.colorSwatchActive,
                      ]}
                    />
                  );
                })}
                {selectedColor ? (
                  <Text style={[tp.bodyMuted, { marginLeft: spacing.sm }]}>
                    {selectedColor.name}
                  </Text>
                ) : null}
              </View>
            </>
          ) : null}

          <View style={{ height: spacing.xl }} />
          <AppButton
            testID="item-tryon-btn"
            label={tryOnImage ? "Generate Again" : "Try It On"}
            variant="secondary"
            onPress={runTryOn}
            loading={generating}
          />
          {tryOnImage ? (
            <>
              <View style={{ height: spacing.sm }} />
              <AppButton
                testID="item-share-btn"
                label="Share This Look"
                variant="secondary"
                onPress={onShare}
                loading={sharing}
              />
            </>
          ) : null}
          <View style={{ height: spacing.md }} />
          <AppButton
            testID="item-buy-btn"
            label={`Buy · $${(item.price_cents / 100).toFixed(0)}`}
            onPress={buy}
            loading={buying}
            disabled={!selectedSize || selectedSize.available_qty <= 0}
          />
          <View style={{ height: spacing.xxl }} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  scroll: { paddingBottom: spacing.xxl },
  heroWrap: { width: "100%", aspectRatio: 3 / 4, backgroundColor: colors.muted },
  hero: { width: "100%", height: "100%" },
  heroOverlay: { ...StyleSheet.absoluteFillObject, padding: spacing.md },
  heroBar: { flexDirection: "row", alignItems: "center" },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroIconWrap: { marginRight: 8 },
  generating: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  generatingText: {
    fontFamily: fonts.bodyMedium,
    color: colors.primaryFg,
    fontSize: 13,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  fitBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
    padding: spacing.md,
  },
  fitText: { color: colors.primaryFg, fontFamily: fonts.bodyMedium, fontSize: 13, flex: 1 },
  body: { padding: spacing.lg },
  price: {
    fontFamily: fonts.heading,
    fontSize: 26,
    color: colors.primary,
    marginTop: spacing.sm,
  },
  subhead: { marginTop: spacing.lg, marginBottom: spacing.sm },
  sizeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sizeChip: {
    minWidth: 50,
    height: 50,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  sizeChipInactive: { borderColor: colors.border, backgroundColor: colors.surface },
  sizeChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  sizeChipOut: { opacity: 0.4 },
  sizeLabel: { fontFamily: fonts.bodySemi, fontSize: 13, letterSpacing: 1 },
  sizeLabelInactive: { color: colors.primary },
  sizeLabelActive: { color: colors.primaryFg },
  sizeLabelOut: { textDecorationLine: "line-through" },
  sizeMeta: { marginTop: spacing.md },
  colorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  colorSwatch: { width: 36, height: 36, borderWidth: 1, borderColor: colors.border },
  colorSwatchActive: { borderColor: colors.primary, borderWidth: 2 },
});

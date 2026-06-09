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
import { OutfitDrawer } from "@/src/components/OutfitDrawer";
import { useToast } from "@/src/components/Toast";
import {
  api,
  BACKEND_URL,
  ColorOption,
  Item,
  SizeOption,
  TryOnAngle,
  TryOnImageOut,
} from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPrice, indicativePrice } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { useOutfit } from "@/src/lib/outfit";
import { shareBase64Image } from "@/src/lib/share";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const ANGLE_LABEL: Record<TryOnAngle, string> = {
  front: "Front",
  three_quarter: "3/4",
  side: "Side",
  back: "Back",
};

export default function ItemDetail() {
  const { id, tryon } = useLocalSearchParams<{ id: string; tryon?: string }>();
  const { user } = useAuth();
  const toast = useToast();

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSize, setSelectedSize] = useState<SizeOption | null>(null);
  const [selectedColor, setSelectedColor] = useState<ColorOption | null>(null);
  const [tryOnId, setTryOnId] = useState<string | null>(null);
  const [tryOnAngles, setTryOnAngles] = useState<TryOnImageOut[]>([]);
  const [activeAngle, setActiveAngle] = useState<TryOnAngle>("front");
  const [fitSummary, setFitSummary] = useState<string | null>(null);
  const [wished, setWished] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingMulti, setGeneratingMulti] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [buying, setBuying] = useState(false);
  const [outfitOpen, setOutfitOpen] = useState(false);

  const addToOutfit = useOutfit((s) => s.add);
  const removeFromOutfit = useOutfit((s) => s.remove);
  const isInOutfit = useOutfit((s) => s.isInOutfit);
  const outfitCount = useOutfit((s) => s.items.length);

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

  const runTryOn = useCallback(
    async (angles: TryOnAngle[] = ["front"]) => {
      if (!item) return;
      const multi = angles.length > 1;
      if (multi) setGeneratingMulti(true);
      else setGenerating(true);
      try {
        const profile = await api.getProfile();
        if (!profile.has_front_photo) {
          toast.show("Add a front photo in your profile first", "error");
          router.push("/onboarding/measurements");
          return;
        }
        const result = await api.tryOn({
          item_id: item.id,
          use_profile_photo: true,
          angles,
        });
        const imgs =
          result.images && result.images.length > 0
            ? result.images
            : [{ angle: "front" as TryOnAngle, image_b64: result.result_image_b64 }];
        setTryOnAngles(imgs);
        setActiveAngle(imgs[0]?.angle ?? "front");
        setTryOnId(result.id);
        setFitSummary(result.fit_summary ?? null);
      } catch (e: any) {
        toast.show(e?.message ?? "Try-on failed", "error");
      } finally {
        setGenerating(false);
        setGeneratingMulti(false);
      }
    },
    [item, toast],
  );

  useEffect(() => {
    if (tryon === "1" && item && tryOnAngles.length === 0 && !generating && !generatingMulti) {
      runTryOn(["front"]);
    }
  }, [tryon, item, tryOnAngles.length, generating, generatingMulti, runTryOn]);

  const onShare = async (fmt: "square" | "story" = "square") => {
    if (!tryOnId) return;
    setSharing(true);
    try {
      const data = await api.shareTryOn(tryOnId, fmt, activeAngle);
      const ok = await shareBase64Image(data.image_b64, `aurafit-tryon-${activeAngle}-${fmt}`);
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

  const activeAngleImage = tryOnAngles.find((a) => a.angle === activeAngle);
  const displayImage = activeAngleImage
    ? dataUriFromBase64(activeAngleImage.image_b64)
    : dataUriFromBase64(item.image_b64);
  const hasTryOn = tryOnAngles.length > 0;

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
              {hasTryOn ? (
                <TouchableOpacity
                  testID="item-reset-tryon"
                  onPress={() => {
                    setTryOnAngles([]);
                    setActiveAngle("front");
                    setFitSummary(null);
                    setTryOnId(null);
                  }}
                  style={styles.heroIcon}
                >
                  <Feather name="rotate-ccw" size={18} color={colors.primaryFg} />
                </TouchableOpacity>
              ) : null}
            </View>
          </SafeAreaView>
          {generating || generatingMulti ? (
            <View style={styles.generating} testID="item-generating-overlay">
              <ActivityIndicator size="large" color={colors.primaryFg} />
              <Text style={styles.generatingText}>
                {generatingMulti
                  ? "Rendering 3 angles…"
                  : "AI is dressing your photo…"}
              </Text>
            </View>
          ) : null}
        </View>

        {hasTryOn && tryOnAngles.length > 1 ? (
          <View style={styles.angleStrip} testID="item-angle-strip">
            {tryOnAngles.map((a) => {
              const isActive = a.angle === activeAngle;
              return (
                <TouchableOpacity
                  key={a.angle}
                  testID={`item-angle-${a.angle}`}
                  onPress={() => setActiveAngle(a.angle)}
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
            {formatPrice(item.price_cents, item.currency)}
          </Text>
          {(() => {
            const approx = indicativePrice(
              item.price_cents,
              item.currency,
              user?.preferred_currency,
            );
            return approx ? (
              <Text style={styles.priceApprox} testID="item-price-approx">
                {approx}
              </Text>
            ) : null;
          })()}
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
            label={hasTryOn ? "Try Again — Front" : "Try It On"}
            variant="secondary"
            onPress={() => runTryOn(["front"])}
            loading={generating}
          />
          <View style={{ height: spacing.sm }} />
          <AppButton
            testID="item-tryon-multi-btn"
            label={
              tryOnAngles.length > 1
                ? "Regenerate · Front · Side · Back"
                : "Multi-Angle Try-On"
            }
            variant="primary"
            onPress={() => runTryOn(["front", "side", "back"])}
            loading={generatingMulti}
          />
          {item ? (
            <>
              <View style={{ height: spacing.sm }} />
              <View style={styles.outfitRow}>
                <TouchableOpacity
                  testID="item-outfit-toggle-btn"
                  onPress={() => {
                    if (isInOutfit(item.id)) {
                      removeFromOutfit(item.id);
                      toast.show("Removed from outfit", "success");
                    } else {
                      addToOutfit(item);
                      toast.show(`Added to outfit · ${outfitCount + 1} piece(s)`, "success");
                    }
                  }}
                  style={[
                    styles.outfitToggle,
                    isInOutfit(item.id) ? styles.outfitToggleActive : null,
                  ]}
                  activeOpacity={0.85}
                >
                  <Feather
                    name={isInOutfit(item.id) ? "check" : "plus"}
                    size={14}
                    color={isInOutfit(item.id) ? colors.primaryFg : colors.primary}
                  />
                  <Text
                    style={[
                      styles.outfitToggleLabel,
                      isInOutfit(item.id) ? styles.outfitToggleLabelActive : null,
                    ]}
                  >
                    {isInOutfit(item.id) ? "In Outfit" : "Add to Outfit"}
                  </Text>
                </TouchableOpacity>
                {outfitCount > 0 ? (
                  <TouchableOpacity
                    testID="item-outfit-open-btn"
                    onPress={() => setOutfitOpen(true)}
                    style={styles.outfitOpen}
                    activeOpacity={0.85}
                  >
                    <Feather name="layers" size={14} color={colors.primaryFg} />
                    <Text style={styles.outfitOpenLabel}>
                      {outfitCount} piece{outfitCount === 1 ? "" : "s"}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          ) : null}
          {hasTryOn ? (
            <>
              <View style={{ height: spacing.sm }} />
              <Text style={[tp.bodyMuted, styles.shareHint]}>
                Sharing the {ANGLE_LABEL[activeAngle]} angle
              </Text>
              <View style={styles.shareRow}>
                <TouchableOpacity
                  testID="item-share-square-btn"
                  onPress={() => onShare("square")}
                  disabled={sharing}
                  style={[styles.shareCol, styles.shareColLeft]}
                  activeOpacity={0.85}
                >
                  <Feather name="square" size={16} color={colors.primary} />
                  <Text style={styles.shareColLabel}>Share · Square</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="item-share-story-btn"
                  onPress={() => onShare("story")}
                  disabled={sharing}
                  style={styles.shareCol}
                  activeOpacity={0.85}
                >
                  <Feather name="smartphone" size={16} color={colors.primary} />
                  <Text style={styles.shareColLabel}>Share · Story 9:16</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}
          <View style={{ height: spacing.md }} />
          <AppButton
            testID="item-buy-btn"
            label={`Buy · ${formatPrice(item.price_cents, item.currency)}`}
            onPress={buy}
            loading={buying}
            disabled={!selectedSize || selectedSize.available_qty <= 0}
          />
          <View style={{ height: spacing.xxl }} />
        </View>
      </ScrollView>
      <OutfitDrawer visible={outfitOpen} onClose={() => setOutfitOpen(false)} />
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
  priceApprox: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.mutedFg,
    marginTop: 2,
  },
  shareHint: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  outfitRow: { flexDirection: "row", gap: spacing.sm },
  outfitToggle: {
    flex: 1,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  outfitToggleActive: { backgroundColor: colors.primary },
  outfitToggleLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.4,
    color: colors.primary,
    textTransform: "uppercase",
  },
  outfitToggleLabelActive: { color: colors.primaryFg },
  outfitOpen: {
    height: 48,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
  },
  outfitOpenLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.4,
    color: colors.primaryFg,
    textTransform: "uppercase",
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
  shareRow: { flexDirection: "row", gap: spacing.sm },
  shareCol: {
    flex: 1,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  shareColLeft: {},
  shareColLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.primary,
    textTransform: "uppercase",
  },
});

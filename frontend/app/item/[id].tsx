import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { GarmentMeasureGuide } from "@/src/components/GarmentMeasureGuide";
import { HeartButton } from "@/src/components/HeartButton";
import { OutfitDrawer } from "@/src/components/OutfitDrawer";
import { PaywallModal } from "@/src/components/PaywallModal";
import { useToast } from "@/src/components/Toast";
import { VerifiedBadge } from "@/src/components/VerifiedBadge";
import {
  api,
  BACKEND_URL,
  ColorOption,
  DIMENSION_KEYS_BY_TYPE,
  DimensionKey,
  isPaywallError,
  Item,
  ItemVariant,
  SizeOption,
  TryOnAngle,
  TryOnImageOut,
} from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPriceIn } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { AddressPickerSheet } from "@/src/components/AddressPickerSheet";
import { useOutfit } from "@/src/lib/outfit";
import { useProfiles } from "@/src/lib/profiles";
import { shareBase64Image } from "@/src/lib/share";
import { stockBadge, totalAvailable } from "@/src/lib/stock";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

// FitBadge — auto-loads the fit score for this item against the buyer's
// active body profile and renders the green/amber/red chip.
import { FitBadge } from "@/src/components/FitBadge";
import { SizeSlider } from "@/src/components/SizeSlider";
import type { FitScore } from "@/src/lib/api";

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
  // Cap the hero image so it never swallows the whole phone screen — at
  // most ~55% of the window height (the 3:4 aspect wins on small screens).
  const { height: winHeight } = useWindowDimensions();
  const heroMaxHeight = Math.round(winHeight * 0.55);

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSize, setSelectedSize] = useState<SizeOption | null>(null);
  const [selectedColor, setSelectedColor] = useState<ColorOption | null>(null);
  // Explicit gallery photo selection — overrides the colour photo until the
  // buyer taps a colour swatch again.
  const [galleryOverride, setGalleryOverride] = useState<string | null>(null);
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
  // Paywall modal state — populated when a /tryon call responds 402
  // (Free-tier weekly cap or multi-angle premium gate).
  const [paywallInfo, setPaywallInfo] = useState<{ feature?: string; message?: string } | null>(null);
  // Restock notification state for the currently-selected size. `null`
  // means we haven't checked yet (before the first render).
  const [notifySubscribed, setNotifySubscribed] = useState<boolean>(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  // Buyer-facing unit toggle for size dimension display. Backend always
  // stores cm; this only affects what the buyer sees in the size meta
  // strip on this screen. The default tracks rough device locale guesses:
  // US visitors see inches by default; everyone else sees centimetres.
  const [sizeUnit, setSizeUnit] = useState<"cm" | "in">("cm");
  // "Where it's measured" garment diagram — reuses the seller wizard guide.
  const [measureGuideOpen, setMeasureGuideOpen] = useState(false);
  const [measureGuideKey, setMeasureGuideKey] = useState<DimensionKey | null>(null);
  // Fit Match score for this item against the buyer's active profile.
  // `recommended_size` is also used to auto-pick a size on first arrival.
  const [fitScore, setFitScore] = useState<FitScore | null>(null);
  const [fitLoading, setFitLoading] = useState(false);

  // "Compare with my body" line for the measurement map — reuses the fit
  // score's per-dimension body/diff values (same convention as the fit
  // narration chips) for the highlighted measurement of the selected size.
  const measureCompareText = useMemo(() => {
    if (!measureGuideKey || !selectedSize) return null;
    const sizeFit = fitScore?.per_size?.find((p) => p.label === selectedSize.label);
    const d = sizeFit?.dimensions?.find((x) => x.key === measureGuideKey);
    if (!d || d.body == null) return null;
    const CM_PER_IN = 2.54;
    const fmtVal = (cm: number) =>
      sizeUnit === "in"
        ? `${Math.round((cm / CM_PER_IN) * 10) / 10}"`
        : `${Math.round(cm)}cm`;
    const base = `Your ${d.label}: ${fmtVal(d.body)}`;
    if (d.diff == null) return base;
    const mag = Math.abs(d.diff);
    if (mag < 1) return `${base} — this size is an exact match`;
    const amount =
      sizeUnit === "in"
        ? `${Math.round((mag / CM_PER_IN) * 10) / 10}"`
        : `${Math.round(mag * 10) / 10}cm`;
    return d.diff > 0
      ? `${base} — this size runs ${amount} roomier`
      : `${base} — this size runs ${amount} smaller`;
  }, [measureGuideKey, selectedSize, fitScore, sizeUnit]);

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

  // Resolve the active (size × color) variant. Falls back to the raw
  // SizeOption's available_qty when variants haven't been generated
  // (super-legacy items). The variant's ``price_cents_override`` wins
  // over the item base price for the buy button + total. When the buyer
  // explicitly picks a colour whose combo is disabled/missing for the
  // selected size, we return null (treated as unavailable) instead of
  // silently substituting another colour.
  const selectedVariant: ItemVariant | null = useMemo(() => {
    if (!item?.variants || item.variants.length === 0 || !selectedSize) return null;
    const target = (selectedColor?.name || "").trim().toLowerCase();
    const same = item.variants.filter((v) => v.size_label === selectedSize.label && !v.disabled);
    if (!target) return same[0] ?? null;
    return same.find((v) => (v.color_name || "").trim().toLowerCase() === target) ?? null;
  }, [item?.variants, selectedSize, selectedColor]);

  const hasVariants = (item?.variants?.length ?? 0) > 0;
  const availableQtyForSelection: number = selectedVariant
    ? Math.max(0, selectedVariant.quantity | 0)
    : hasVariants && selectedSize
      ? 0 // variant-tracked item, but this exact combo is disabled/missing
      : (selectedSize?.available_qty ?? 0);

  const chargedPriceCents: number = selectedVariant?.price_cents_override
    ?? item?.price_cents
    ?? 0;

  useEffect(() => {
    load();
  }, [load]);

  // Load the fit score for this item against the active profile (or self
  // when no loved-one is picked). Re-runs whenever the active profile
  // changes so swapping to "Aisha" updates the badge instantly.
  const { active: activeProfile } = useProfiles();
  useEffect(() => {
    if (user?.role !== "buyer" || !item) return;
    let cancelled = false;
    setFitLoading(true);
    // The `profile.id` from useProfiles points at the loved-one row when
    // active is non-self; for self we omit it (backend uses self profile).
    const profileId =
      activeProfile?.profile && !activeProfile.profile.is_self
        ? activeProfile.profile.id
        : undefined;
    api
      .fitScore(item.id, profileId)
      .then((res) => {
        if (cancelled) return;
        setFitScore(res);
        // Auto-pick the recommended size on first arrival, but only if
        // the user hasn't already chosen one. This keeps subsequent
        // picks sticky.
        if (res.recommended_size) {
          setSelectedSize((curr) => {
            if (curr) return curr;
            const match = item.sizes.find((s) => s.label === res.recommended_size);
            return match ?? curr;
          });
        }
      })
      .catch(() => {
        if (!cancelled) setFitScore(null);
      })
      .finally(() => {
        if (!cancelled) setFitLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, user?.role, activeProfile?.profile?.id]);
  const runTryOn = useCallback(
    async (angles: TryOnAngle[] = ["front"]) => {
      if (!item) return;
      const multi = angles.length > 1;
      if (multi) setGeneratingMulti(true);
      else setGenerating(true);
      try {
        // Resolve which profile's photo will be used.
        const targetProfileId = activeProfile?.profile_id ?? "self";
        const hasFront =
          targetProfileId === "self"
            ? (await api.getProfile()).has_front_photo
            : activeProfile?.profile.has_front_photo ?? false;
        if (!hasFront) {
          if (targetProfileId === "self") {
            toast.show("Add a front photo in your profile first", "error");
            router.push("/onboarding/measurements");
          } else {
            toast.show("Add a front photo for this profile first", "error");
            router.push("/profiles");
          }
          return;
        }
        const result = await api.tryOn({
          item_id: item.id,
          use_profile_photo: true,
          profile_id: targetProfileId,
          // Colour-aware try-on: render the exact shade (and use the
          // colour's own photo when the seller attached one).
          color_name: selectedColor?.name,
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
        if (isPaywallError(e)) {
          setPaywallInfo({ feature: e.feature, message: e.message });
        } else {
          toast.show(e?.message ?? "Try-on failed", "error");
        }
      } finally {
        setGenerating(false);
        setGeneratingMulti(false);
      }
    },
    [item, toast, activeProfile?.profile_id, activeProfile?.profile.has_front_photo, selectedColor?.name],
  );

  useEffect(() => {
    if (tryon === "1" && item && tryOnAngles.length === 0 && !generating && !generatingMulti) {
      runTryOn(["front"]);
    }
  }, [tryon, item, tryOnAngles.length, generating, generatingMulti, runTryOn]);

  // Restock notification: whenever the selected size changes, re-fetch
  // whether the current buyer is already subscribed. We only bother
  // when the size is sold out — for in-stock sizes the state is moot.
  useEffect(() => {
    if (!item || !selectedSize || user?.role !== "buyer") {
      setNotifySubscribed(false);
      return;
    }
    if (selectedSize.available_qty > 0) {
      setNotifySubscribed(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.notifyStatus(item.id, selectedSize.label);
        if (!cancelled) setNotifySubscribed(!!res.subscribed);
      } catch {
        /* ignore — worst case the button shows "Notify me" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item, selectedSize, user?.role]);

  const toggleNotify = useCallback(async () => {
    if (!item || !selectedSize) return;
    setNotifyBusy(true);
    try {
      const fn = notifySubscribed ? api.notifyUnsubscribe : api.notifySubscribe;
      await fn(item.id, selectedSize.label);
      setNotifySubscribed(!notifySubscribed);
      toast.show(
        notifySubscribed
          ? "Notifications off for this size"
          : "We'll ping you when it's back",
        "success",
      );
    } catch (e: any) {
      toast.show(e?.message ?? "Could not update", "error");
    } finally {
      setNotifyBusy(false);
    }
  }, [item, selectedSize, notifySubscribed, toast]);

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

  const [addressSheetOpen, setAddressSheetOpen] = useState(false);

  const startBuy = () => {
    if (!item || !selectedSize) return;
    if (user?.role !== "buyer") {
      toast.show("Sign in as a buyer to purchase", "error");
      return;
    }
    setAddressSheetOpen(true);
  };

  const buyWithAddress = async (addressId: string, deliveryOption: "door" | "pickup") => {
    if (!item || !selectedSize) return;
    setBuying(true);
    try {
      const { url } = await api.checkout({
        item_id: item.id,
        size: selectedSize.label,
        color: selectedColor?.name,
        variant_id: selectedVariant?.id,
        origin_url: BACKEND_URL,
        address_id: addressId,
        delivery_option: deliveryOption,
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
  // Photos are grouped by colour (Amazon-style). A colour's group is its
  // `images` array; legacy items only carry a single `image_b64`.
  const photosOf = (c: ColorOption): string[] =>
    c.images && c.images.length > 0 ? c.images : c.image_b64 ? [c.image_b64] : [];
  const selectedColorPhotos = selectedColor ? photosOf(selectedColor) : [];
  // Hero priority: try-on result > tapped gallery photo > selected colour's
  // group hero > primary image.
  const displayImage = activeAngleImage
    ? dataUriFromBase64(activeAngleImage.image_b64)
    : dataUriFromBase64(galleryOverride ?? selectedColorPhotos[0] ?? item.image_b64);
  const hasTryOn = tryOnAngles.length > 0;
  // Gallery order: the selected colour's photo group first, then the
  // general product photos, then one hero photo per other colour so
  // buyers can hop between colours. Tapping a colour-tagged thumb also
  // selects that colour.
  const galleryEntries: { b64: string; colorName?: string; hex?: string }[] = [
    ...(selectedColor
      ? selectedColorPhotos.map((b64) => ({
          b64,
          colorName: selectedColor.name,
          hex: selectedColor.hex,
        }))
      : []),
    ...(item.images && item.images.length > 0 ? item.images : [item.image_b64]).map((b64) => ({
      b64,
    })),
    ...item.colors
      .filter((c) => c.name !== selectedColor?.name)
      .map((c) => ({ c, group: photosOf(c) }))
      .filter((x) => x.group.length > 0)
      .map((x) => ({ b64: x.group[0], colorName: x.c.name, hex: x.c.hex })),
  ];

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.heroWrap, { maxHeight: heroMaxHeight }]}>
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
          {/* Brand + Seller pretitle row */}
          {item.brand_name ? (
            <Text style={[tp.caption, { color: colors.primary }]} testID="item-brand">
              {item.brand_name.toUpperCase()}
            </Text>
          ) : null}
          <View style={styles.sellerRow}>
            <Text style={tp.caption} testID="item-seller">
              {item.brand_name ? "by " : ""}
              {item.seller_name.toUpperCase()}
            </Text>
            <VerifiedBadge
              verified={item.seller_verified}
              size="md"
              testID="item-seller-verified"
            />
          </View>
          <Text style={[tp.h1, { marginTop: 6 }]} testID="item-name">
            {item.name}
          </Text>
          <Text style={styles.price} testID="item-price">
            {formatPriceIn(item.price_cents, item.currency, user?.preferred_currency)}
          </Text>

          {/* Fit Match Score badge — only shown to buyers. Buyers without
              a body profile yet get a small CTA prompting them to add
              measurements from Profile. */}
          {user?.role === "buyer" ? (
            <View style={styles.fitRow} testID="item-fit-row">
              {fitLoading || (fitScore && fitScore.scorable) ? (
                <FitBadge fit={fitScore} loading={fitLoading} testID="item-fit-badge" />
              ) : fitScore && !fitScore.scorable ? (
                <View style={styles.fitHint}>
                  <Feather name="info" size={12} color={colors.mutedFg} />
                  <Text style={styles.fitHintText}>
                    {fitScore.reason ?? "Fit score unavailable"}
                  </Text>
                </View>
              ) : null}
              {fitScore?.recommended_size ? (
                <Text style={styles.fitRecText}>
                  Best size · <Text style={{ fontFamily: fonts.bodySemi }}>
                    {fitScore.recommended_size}
                  </Text>
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Photo gallery — item photos + colour photos. Tap to view. */}
          {galleryEntries.length > 1 ? (
            <ScrollView
              testID="item-gallery"
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: spacing.md }}
              contentContainerStyle={{ gap: 8 }}
            >
              {galleryEntries.map((entry, idx) => (
                <TouchableOpacity
                  key={`gal-${idx}`}
                  testID={`item-gallery-thumb-${idx}`}
                  onPress={() => {
                    setGalleryOverride(entry.b64);
                    if (entry.colorName) {
                      const c = item.colors.find((x) => x.name === entry.colorName);
                      if (c) setSelectedColor(c);
                    }
                  }}
                  style={styles.galleryThumbWrap}
                >
                  <Image
                    source={{ uri: dataUriFromBase64(entry.b64) }}
                    style={styles.galleryThumb}
                    resizeMode="cover"
                  />
                  {entry.hex ? (
                    <View style={[styles.galleryThumbSwatch, { backgroundColor: entry.hex }]} />
                  ) : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}

          {item.description ? (
            <Text style={[tp.body, { marginTop: spacing.md }]}>{item.description}</Text>
          ) : null}

          <View style={styles.subhead} testID="item-stock-row">
            <Text style={tp.caption}>Size</Text>
            {/* Whole-item stock state — shown when no size is selected so
                the buyer instantly knows if the SKU is worth pursuing. */}
            {(() => {
              const total = totalAvailable(item.sizes);
              const badge = stockBadge(total);
              return (
                <View
                  style={[styles.stockPill, { backgroundColor: badge.color }]}
                  testID={`item-stock-overall-${badge.level}`}
                >
                  <Text style={styles.stockPillLabel}>
                    {badge.label.toUpperCase()}
                  </Text>
                </View>
              );
            })()}
          </View>
          <View style={styles.sizeRow}>
            {item.sizes.map((s) => {
              const selected = selectedSize?.label === s.label;
              // Stock across all variants of this size (any color).
              // Legacy items fall back to the size's available_qty.
              const sizeVariants = (item.variants || []).filter(
                (v) => v.size_label === s.label && !v.disabled,
              );
              const sizeStock = sizeVariants.length
                ? sizeVariants.reduce((n, v) => n + Math.max(0, v.quantity | 0), 0)
                : s.available_qty;
              const out = sizeStock <= 0;
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

          {/* Live size slider — visible when this item ships with per-size
              dimensions. Buyers can drag-scrub through sizes; the bottom
              narration banner updates live with the dominant fit cue
              ("Snug across shoulders", "Roomy in waist", etc.). The chip
              row above still works for plain tap-to-select. */}
          {fitScore?.per_size && fitScore.per_size.length > 0 ? (
            <SizeSlider
              testID="item-size-slider"
              sizes={item.sizes}
              selected={selectedSize?.label ?? null}
              recommended={fitScore.recommended_size}
              fits={fitScore.per_size}
              onChange={(s) => setSelectedSize(s)}
            />
          ) : null}
          {selectedSize ? (
            (() => {
              const badge = stockBadge(availableQtyForSelection);
              // Pull the narrative entries from the fit score for the
              // currently selected size, if loaded. We surface up to 3
              // descriptors so the buyer doesn't get a wall of text.
              const sizeFit = fitScore?.per_size?.find(
                (p) => p.label === selectedSize.label,
              );
              const narratives =
                sizeFit?.dimensions
                  ?.filter((d) => d.narrative && d.diff !== null)
                  .slice(0, 4) ?? [];
              const CM_PER_IN = 2.54;
              const fmtDim = (cm?: number | null): string | null => {
                if (cm == null) return null;
                if (sizeUnit === "in") {
                  const inches = Math.round((cm / CM_PER_IN) * 10) / 10;
                  return `${inches}"`;
                }
                return `${Math.round(cm)}cm`;
              };
              const dimParts: string[] = [];
              const chest = fmtDim(selectedSize.chest_cm);
              if (chest) dimParts.push(`Chest ${chest}`);
              const waist = fmtDim(selectedSize.waist_cm);
              if (waist) dimParts.push(`Waist ${waist}`);
              const hips = fmtDim(selectedSize.hips_cm);
              if (hips) dimParts.push(`Hips ${hips}`);
              const length = fmtDim(selectedSize.length_cm);
              if (length) dimParts.push(`Length ${length}`);
              return (
                <View style={styles.sizeMeta} testID="item-size-detail">
                  <View style={styles.unitToggleRow}>
                    <Text style={tp.bodyMuted}>{dimParts.join(" · ")}</Text>
                    {dimParts.length > 0 ? (
                      <View style={styles.unitToggle}>
                        {(["cm", "in"] as const).map((u) => {
                          const active = u === sizeUnit;
                          return (
                            <TouchableOpacity
                              key={u}
                              testID={`item-size-unit-${u}`}
                              onPress={() => setSizeUnit(u)}
                              style={[
                                styles.unitChip,
                                active ? styles.unitChipActive : styles.unitChipInactive,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.unitChipLabel,
                                  active
                                    ? styles.unitChipLabelActive
                                    : styles.unitChipLabelInactive,
                                ]}
                              >
                                {u.toUpperCase()}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                  <View
                    style={[styles.stockChip, { borderColor: badge.color }]}
                    testID={`item-size-stock-${badge.level}`}
                  >
                    <Text style={[styles.stockChipLabel, { color: badge.color }]}>
                      {badge.label}
                    </Text>
                  </View>
                  {narratives.length > 0 ? (
                    <View style={styles.narrationRow} testID="item-narration">
                      {narratives.map((d) => {
                        const tone =
                          d.diff != null && Math.abs(d.diff) < 2
                            ? "good"
                            : d.diff != null && Math.abs(d.diff) >= 5
                              ? "alert"
                              : "warn";
                        return (
                          <View
                            key={d.key}
                            style={[
                              styles.narrChip,
                              tone === "good" && styles.narrGood,
                              tone === "warn" && styles.narrWarn,
                              tone === "alert" && styles.narrAlert,
                            ]}
                            testID={`item-narr-${d.key}`}
                          >
                            <Text style={styles.narrLabel}>{d.narrative}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                  {selectedSize.available_qty <= 0 && user?.role === "buyer" ? (
                    <TouchableOpacity
                      testID="item-notify-btn"
                      onPress={toggleNotify}
                      style={[
                        styles.notifyBtn,
                        notifySubscribed && styles.notifyBtnActive,
                      ]}
                      activeOpacity={0.85}
                      disabled={notifyBusy}
                    >
                      <Feather
                        name={notifySubscribed ? "bell-off" : "bell"}
                        size={13}
                        color={notifySubscribed ? colors.mutedFg : colors.primaryFg}
                      />
                      <Text
                        style={[
                          styles.notifyLabel,
                          notifySubscribed && { color: colors.mutedFg },
                        ]}
                      >
                        {notifySubscribed
                          ? "You'll be notified"
                          : "Notify me when back in stock"}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })()
          ) : null}

          {selectedSize &&
          (DIMENSION_KEYS_BY_TYPE[item.garment_type] ?? []).length > 0 ? (
            <View style={styles.measureGuideWrap}>
              <TouchableOpacity
                testID="item-measure-guide-toggle"
                onPress={() => setMeasureGuideOpen((o) => !o)}
                style={styles.measureGuideToggle}
                activeOpacity={0.8}
              >
                <Feather
                  name={measureGuideOpen ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={colors.mutedFg}
                />
                <Text style={styles.measureGuideToggleLabel}>
                  {measureGuideOpen
                    ? "Hide measurement map"
                    : `See where size ${selectedSize.label} is measured`}
                </Text>
              </TouchableOpacity>
              {measureGuideOpen ? (
                <GarmentMeasureGuide
                  garmentType={item.garment_type}
                  dimKeys={DIMENSION_KEYS_BY_TYPE[item.garment_type] as DimensionKey[]}
                  activeKey={measureGuideKey}
                  onSelectKey={setMeasureGuideKey}
                  values={selectedSize}
                  unit={sizeUnit}
                  compareText={measureCompareText}
                />
              ) : null}
            </View>
          ) : null}

          {item.colors.length > 0 ? (
            <>
              <Text style={[tp.caption, styles.subhead]}>Color</Text>
              <View style={styles.colorRow}>
                {item.colors.map((c) => {
                  const selected = selectedColor?.name === c.name;
                  // Grey out colours that don't exist (disabled or zero
                  // stock) for the currently-selected size so buyers see
                  // "no Rose in L" at a glance. Without a size selected
                  // every colour stays active.
                  const comboUnavailable = (() => {
                    if (!item.variants || item.variants.length === 0 || !selectedSize) return false;
                    const v = item.variants.find(
                      (x) =>
                        x.size_label === selectedSize.label &&
                        (x.color_name || "").trim().toLowerCase() === c.name.trim().toLowerCase(),
                    );
                    return !v || !!v.disabled || (v.quantity | 0) <= 0;
                  })();
                  return (
                    <TouchableOpacity
                      key={c.name}
                      testID={`item-color-${c.name}`}
                      onPress={() => {
                        setSelectedColor(c);
                        // Colour tap wins over any tapped gallery photo so
                        // the hero switches to this colour's picture.
                        setGalleryOverride(null);
                      }}
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: c.hex },
                        selected && styles.colorSwatchActive,
                        comboUnavailable && { opacity: 0.25 },
                      ]}
                    />
                  );
                })}
                {selectedColor ? (
                  <Text style={[tp.bodyMuted, { marginLeft: spacing.sm }]}>
                    {selectedColor.name}
                    {hasVariants && selectedSize && !selectedVariant
                      ? " — unavailable in this size"
                      : ""}
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
            label={`Buy · ${formatPriceIn(chargedPriceCents, item.currency, user?.preferred_currency)}`}
            onPress={startBuy}
            loading={buying}
            disabled={!selectedSize || availableQtyForSelection <= 0}
          />
          <View style={{ height: spacing.xxl }} />
        </View>
      </ScrollView>
      <OutfitDrawer visible={outfitOpen} onClose={() => setOutfitOpen(false)} />
      <PaywallModal
        visible={!!paywallInfo}
        feature={paywallInfo?.feature}
        message={paywallInfo?.message}
        onClose={() => setPaywallInfo(null)}
      />
      <AddressPickerSheet
        visible={addressSheetOpen}
        onClose={() => setAddressSheetOpen(false)}
        itemTotalCents={chargedPriceCents}
        currency={item.currency}
        onConfirm={(addr, deliveryOption) => {
          setAddressSheetOpen(false);
          buyWithAddress(addr.id, deliveryOption);
        }}
      />
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
  subhead: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  stockPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  stockPillLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primaryFg,
  },
  stockChip: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  stockChipLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  fitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: "wrap",
  },
  fitHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fitHintText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
  },
  fitRecText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
  },
  narrationRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  narrChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  narrGood: { borderColor: "#15803D", backgroundColor: "rgba(21,128,61,0.08)" },
  narrWarn: { borderColor: "#D97706", backgroundColor: "rgba(217,119,6,0.08)" },
  narrAlert: { borderColor: "#DC2626", backgroundColor: "rgba(220,38,38,0.08)" },
  narrLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    color: colors.primary,
    textTransform: "capitalize",
  },
  galleryThumbWrap: {
    position: "relative",
  },
  galleryThumb: {
    width: 92,
    aspectRatio: 3 / 4,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  galleryThumbSwatch: {
    position: "absolute",
    bottom: 6,
    right: 6,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
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
  measureGuideWrap: { marginTop: spacing.sm },
  measureGuideToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
  },
  measureGuideToggleLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.mutedFg,
    letterSpacing: 0.3,
  },
  sellerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  notifyBtn: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.primary,
  },
  notifyBtnActive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  notifyLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.primaryFg,
    textTransform: "uppercase",
  },
  unitToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  unitToggle: {
    flexDirection: "row",
    gap: 4,
  },
  unitChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    minWidth: 32,
    alignItems: "center",
  },
  unitChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  unitChipInactive: { borderColor: colors.border, backgroundColor: colors.surface },
  unitChipLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1,
  },
  unitChipLabelActive: { color: colors.primaryFg },
  unitChipLabelInactive: { color: colors.mutedFg },
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

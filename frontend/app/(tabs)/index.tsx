import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ActiveProfileChip } from "@/src/components/ActiveProfileChip";
import { ChipsRow } from "@/src/components/ChipsRow";
import { FitBadge } from "@/src/components/FitBadge";
import { HeaderMenu } from "@/src/components/HeaderMenu";
import { HeartButton } from "@/src/components/HeartButton";
import { OutfitDrawer } from "@/src/components/OutfitDrawer";
import { OutfitPill } from "@/src/components/OutfitPill";
import { RestockBell } from "@/src/components/RestockBell";
import { useToast } from "@/src/components/Toast";
import { VerifiedBadge } from "@/src/components/VerifiedBadge";
import { api, CATEGORIES_BY_AUDIENCE, CATEGORY_LABELS, Collection, FitScore, Item, KidAgeGroup } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPriceIn } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { useProfiles } from "@/src/lib/profiles";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

// Full set, ordered by buyer intent. Filtered down based on the active
// audience so a Men shopper never sees Dresses, etc.
const ALL_CATEGORIES = [
  { key: "shirts", label: CATEGORY_LABELS.shirts },
  { key: "dresses", label: CATEGORY_LABELS.dresses },
  { key: "pants", label: CATEGORY_LABELS.pants },
  { key: "outerwear", label: CATEGORY_LABELS.outerwear },
  { key: "shoes", label: CATEGORY_LABELS.shoes },
  { key: "accessories", label: CATEGORY_LABELS.accessories },
];

// Gender override chips ("Shop for"). Defaults to the active profile's
// inferred audience; the override lets buyers shop across genders without
// switching profiles. "All" clears the override.
const GENDER_CHIPS = [
  { key: "all", label: "All" },
  { key: "women", label: "Women" },
  { key: "men", label: "Men" },
  { key: "unisex", label: "Unisex" },
  { key: "kids", label: "Kids" },
];

const HERO =
  "https://images.unsplash.com/photo-1668952135120-7d997b1b3778?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODl8MHwxfHNlYXJjaHwxfHxmYXNoaW9uJTIwZWRpdG9yaWFsJTIwbW9kZWwlMjBzdHVkaW98ZW58MHx8fHwxNzgwOTIzMjg3fDA&ixlib=rb-4.1.0&q=85";

export default function Discover() {
  const { user } = useAuth();
  const { active } = useProfiles();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [kidAgeGroup, setKidAgeGroup] = useState<KidAgeGroup | null>(null);
  // Explicit gender override for "Shop for ___". null = inherit from
  // active profile; "all" = show every audience.
  const [genderOverride, setGenderOverride] = useState<"women" | "men" | "unisex" | "kids" | "all" | null>(null);
  // Brand filter: case-insensitive substring match against item.brand_name.
  // Buyers type their favourite designer once and stay filtered while
  // browsing. Cleared via the chip's close icon.
  const [brandFilter, setBrandFilter] = useState<string>("");
  const [brandInput, setBrandInput] = useState<string>("");
  const [showBrandInput, setShowBrandInput] = useState(false);
  const [wishedIds, setWishedIds] = useState<Set<string>>(new Set());
  // Map of itemId → FitScore so each card knows whether to show a badge.
  // Loaded in the background after the items list arrives (non-blocking).
  const [fitScores, setFitScores] = useState<Record<string, FitScore>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [outfitOpen, setOutfitOpen] = useState(false);

  // Active profile drives the audience filter:
  //   self    -> infer from user.gender (backend default)
  //   loved adult -> override by gender of loved one
  //   loved kid   -> "kids"
  const profileAudience: "men" | "women" | "kids" | "all" | undefined = (() => {
    if (!active) return undefined;
    const p = active.profile;
    if (p.audience === "kid") return "kids";
    if (p.is_self) return undefined; // backend infers from buyer gender
    if (p.gender === "male") return "men";
    if (p.gender === "female") return "women";
    return undefined;
  })();
  const isKidActive = active?.profile.audience === "kid";

  // Effective audience: explicit override > profile inference > undefined.
  // "all" short-circuits to undefined-with-showAll so the backend skips
  // filtering entirely.
  const effectiveAudience: "men" | "women" | "unisex" | "kids" | undefined = (() => {
    if (genderOverride === "all") return undefined;
    if (genderOverride) return genderOverride;
    return profileAudience as any;
  })();
  const effShowAll = showAll || genderOverride === "all";

  const audienceLabel = effectiveAudience ?? (effShowAll ? "all" : null);

  // Filter the category chips to those that match the effective audience.
  // Men shoppers don't see Dresses, etc. (mirrors the seller wizard.)
  const visibleCategoryKeys = effectiveAudience
    ? (CATEGORIES_BY_AUDIENCE[effectiveAudience] ?? ALL_CATEGORIES.map((c) => c.key))
    : ALL_CATEGORIES.map((c) => c.key);
  const visibleCategories = ALL_CATEGORIES.filter((c) =>
    visibleCategoryKeys.includes(c.key),
  );

  const load = useCallback(async () => {
    try {
      const [data, wl] = await Promise.all([
        api.listItems({
          category: category ?? undefined,
          size: sizeFilter ?? undefined,
          audience: effShowAll ? "all" : effectiveAudience,
          kid_age_group: isKidActive ? kidAgeGroup ?? undefined : undefined,
          brand: brandFilter || undefined,
        }),
        user?.role === "buyer" ? api.wishlistIds() : Promise.resolve({ item_ids: [] }),
      ]);
      setItems(data);
      setWishedIds(new Set(wl.item_ids));
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load items", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [
    category,
    sizeFilter,
    effShowAll,
    effectiveAudience,
    isKidActive,
    kidAgeGroup,
    brandFilter,
    toast,
    user?.role,
  ]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  React.useEffect(() => {
    // Load preferred size once
    (async () => {
      try {
        const p = await api.getProfile();
        if (p.preferred_size && !sizeFilter) setSizeFilter(p.preferred_size);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  // Lazy fit-score loader. Whenever the items list refreshes, fan out
  // GET /items/{id}/fit-score requests for every visible item. Results
  // trickle in and the badges populate progressively. The active profile
  // is intentionally NOT passed — the backend already falls back to the
  // buyer's self profile, which is what shoppers usually want on the
  // grid. (Item Detail will let them switch profiles explicitly.)
  useEffect(() => {
    if (user?.role !== "buyer" || items.length === 0) return;
    let cancelled = false;
    setFitScores({});
    Promise.all(
      items.map(async (it) => {
        try {
          const fit = await api.fitScore(it.id);
          if (!cancelled) {
            setFitScores((prev) => ({ ...prev, [it.id]: fit }));
          }
        } catch {
          // Silent — the badge just won't render.
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [items, user?.role]);

  const renderItem = ({ item, index }: { item: Item; index: number }) => {
    const totalQty = item.sizes.reduce((s, x) => s + (x.available_qty || 0), 0);
    const outOfStock = totalQty === 0;
    // Show the low-stock urgency pill when 1–5 units remain so buyers see
    // the hint without exposing the exact seller inventory count.
    const lowStock = !outOfStock && totalQty <= 5;
    const extras = (item.images?.length ?? 0) - 1;
    return (
      <TouchableOpacity
        testID={`item-card-${item.id}`}
        activeOpacity={0.85}
        onPress={() => router.push(`/item/${item.id}`)}
        style={[styles.card, index % 2 === 0 ? styles.cardLeft : styles.cardRight]}
      >
        <View style={styles.cardImageWrap}>
          <Image
            source={{ uri: dataUriFromBase64(item.image_b64) }}
            style={styles.cardImage}
            resizeMode="cover"
          />
          {user?.role === "buyer" ? (
            <View style={styles.cardHeart}>
              <HeartButton
                itemId={item.id}
                initial={wishedIds.has(item.id)}
                size={18}
                onChange={(active) => {
                  setWishedIds((prev) => {
                    const next = new Set(prev);
                    if (active) next.add(item.id);
                    else next.delete(item.id);
                    return next;
                  });
                }}
                testID={`item-card-${item.id}-heart`}
              />
            </View>
          ) : null}
          {/* Fit-match badge (top-left). Only shows once the per-item
              score request completes; we keep the slot empty otherwise so
              the layout doesn't reflow when the badge arrives. */}
          {user?.role === "buyer" && fitScores[item.id]?.scorable ? (
            <View style={styles.cardFit} testID={`item-card-${item.id}-fit`}>
              <FitBadge fit={fitScores[item.id]} compact />
            </View>
          ) : null}
          {/* "+N" indicates extra photos in the gallery. Only show when
              the listing actually has more than the cover. */}
          {extras > 0 ? (
            <View style={styles.galleryBadge} testID={`item-card-${item.id}-gallery-count`}>
              <Text style={styles.galleryBadgeText}>+{extras}</Text>
            </View>
          ) : null}
          {outOfStock ? (
            <View style={styles.outBadge} testID={`item-card-${item.id}-out`}>
              <Text style={styles.outBadgeText}>Sold out</Text>
            </View>
          ) : null}
          {lowStock ? (
            <View style={styles.lowBadge} testID={`item-card-${item.id}-low`}>
              <Text style={styles.lowBadgeText}>Only {totalQty} left</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.cardBody}>
          <View style={styles.cardSellerRow}>
            <Text style={styles.cardSeller} numberOfLines={1}>
              {(item.brand_name || item.seller_name).toUpperCase()}
            </Text>
            <VerifiedBadge
              verified={item.seller_verified}
              size="sm"
              testID={`item-card-${item.id}-verified`}
            />
          </View>
          <Text style={styles.cardName} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={styles.cardPrice}>
            {formatPriceIn(item.price_cents, item.currency, user?.preferred_currency)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* Sticky header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={tp.caption}>DRAPE</Text>
          <Text style={[tp.h2, styles.headerTitle]}>Hello, {user?.full_name.split(" ")[0]}.</Text>
        </View>
        <TouchableOpacity
          testID="discover-brand-toggle-btn"
          style={styles.iconBtn}
          onPress={() => {
            setShowBrandInput((v) => !v);
            setBrandInput(brandFilter);
          }}
          accessibilityLabel="Filter by brand"
        >
          <Feather name="bookmark" size={20} color={brandFilter ? colors.primary : colors.mutedFg} />
        </TouchableOpacity>
        {user?.role === "buyer" ? <RestockBell testID="discover-restock-bell" /> : null}
        <HeaderMenu testID="discover-header-menu" />
      </View>

      {showBrandInput ? (
        <View style={styles.brandRow} testID="discover-brand-input-row">
          <Feather name="search" size={14} color={colors.mutedFg} />
          <TextInput
            testID="discover-brand-input"
            value={brandInput}
            onChangeText={setBrandInput}
            placeholder="Brand name (e.g. Maison Lumière)"
            placeholderTextColor={colors.mutedFg}
            style={styles.brandInput}
            returnKeyType="search"
            autoFocus
            onSubmitEditing={() => {
              setBrandFilter(brandInput.trim());
              setShowBrandInput(false);
            }}
          />
          <TouchableOpacity
            testID="discover-brand-apply"
            onPress={() => {
              setBrandFilter(brandInput.trim());
              setShowBrandInput(false);
            }}
            style={styles.brandApply}
          >
            <Text style={styles.brandApplyLabel}>APPLY</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {brandFilter ? (
        <View style={styles.brandChipRow} testID="discover-brand-filter-chip">
          <Feather name="bookmark" size={12} color={colors.primaryFg} />
          <Text style={styles.brandChipLabel}>Brand · {brandFilter}</Text>
          <TouchableOpacity
            testID="discover-brand-clear"
            onPress={() => {
              setBrandFilter("");
              setBrandInput("");
            }}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <Feather name="x" size={12} color={colors.primaryFg} />
          </TouchableOpacity>
        </View>
      ) : null}
      {user?.role === "buyer" ? (
        <View style={styles.profileChipWrap}>
          <ActiveProfileChip testIDPrefix="discover-profile-chip" />
        </View>
      ) : null}
      {/* Gender override row — buyers can shop across genders without
          switching the active body profile. Tapping "Men" hides Dresses
          from the category strip below and from the resulting grid. */}
      <View style={styles.genderRowWrap}>
        <Text style={[tp.caption, styles.genderRowLabel]}>SHOP FOR</Text>
        <ChipsRow
          chips={GENDER_CHIPS}
          active={genderOverride}
          onPress={(k) => {
            setGenderOverride(k as any);
            // If the current category isn't valid for the new gender,
            // clear it so the user isn't stuck on an unselectable chip.
            if (k && k !== "all") {
              const allowed = CATEGORIES_BY_AUDIENCE[k] ?? [];
              if (category && !allowed.includes(category)) setCategory(null);
            }
          }}
          testIDPrefix="gender"
        />
      </View>
      <ChipsRow chips={visibleCategories} active={category} onPress={setCategory} testIDPrefix="cat" />
      {isKidActive ? (
        <View style={styles.ageGroupWrap}>
          <ChipsRow
            chips={[
              { key: "0-2", label: "0–2" },
              { key: "3-5", label: "3–5" },
              { key: "6-9", label: "6–9" },
              { key: "10-13", label: "10–13" },
              { key: "14-17", label: "14–17" },
            ]}
            active={kidAgeGroup}
            onPress={(k) => setKidAgeGroup(k as KidAgeGroup | null)}
            testIDPrefix="age-group"
          />
        </View>
      ) : null}
      {audienceLabel ? (
        <View style={styles.audienceBanner} testID="discover-audience-banner">
          <Feather name="user" size={14} color={colors.primary} />
          <Text style={styles.audienceText}>
            {showAll
              ? "Showing pieces for everyone"
              : `Showing pieces for ${audienceLabel}`}
          </Text>
          <TouchableOpacity
            testID="discover-toggle-audience"
            onPress={() => setShowAll((v) => !v)}
          >
            <Text style={styles.audienceLink}>{showAll ? "Filter" : "Show all"}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {sizeFilter ? (
        <View style={styles.sizeBanner} testID="discover-size-filter">
          <Feather name="filter" size={14} color={colors.primaryFg} />
          <Text style={styles.sizeBannerText}>Showing your size: {sizeFilter}</Text>
          <TouchableOpacity onPress={() => setSizeFilter(null)} testID="discover-clear-size">
            <Feather name="x" size={14} color={colors.primaryFg} />
          </TouchableOpacity>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center} testID="discover-loading">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          testID="discover-list"
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          numColumns={2}
          // numColumns is fixed at 2; key only needs to change if we ever
          // switched between grid and list. Keep stable to avoid full re-mount.
          key="discover-grid-2col"
          contentContainerStyle={
            items.length === 0 ? styles.emptyListContent : styles.listContent
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.empty} testID="discover-empty">
              <Image source={{ uri: HERO }} style={styles.emptyHero} resizeMode="cover" />
              <Text style={[tp.h3, styles.emptyTitle]}>
                {category ? `No ${category} in this size yet.` : "Stocking the racks…"}
              </Text>
              <Text style={[tp.bodyMuted, styles.emptySub]}>
                Pull to refresh, or change filters above. Sellers are uploading new pieces every day.
              </Text>
            </View>
          }
          ListHeaderComponent={
            collections.length > 0 && !category && !sizeFilter ? (
              <View style={styles.dropsBlock}>
                <View style={styles.dropsHeader}>
                  <Text style={tp.caption}>Drops</Text>
                  <Text style={[tp.bodyMuted, { fontSize: 12 }]}>
                    {collections.length} collection{collections.length === 1 ? "" : "s"}
                  </Text>
                </View>
                <FlatList
                  horizontal
                  data={collections}
                  keyExtractor={(c) => c.id}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.dropsRow}
                  renderItem={({ item: c }) => (
                    <TouchableOpacity
                      testID={`drop-${c.id}`}
                      onPress={() => router.push(`/collection/${c.id}`)}
                      style={styles.dropCard}
                      activeOpacity={0.85}
                    >
                      {c.cover_image_b64 ? (
                        <Image
                          source={{ uri: dataUriFromBase64(c.cover_image_b64) }}
                          style={styles.dropImage}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={[styles.dropImage, styles.dropImageEmpty]} />
                      )}
                      <View style={styles.dropOverlay} />
                      <View style={styles.dropTextWrap}>
                        <Text style={styles.dropName} numberOfLines={2}>
                          {c.name}
                        </Text>
                        <Text style={styles.dropMeta} numberOfLines={1}>
                          {c.seller_name} · {c.item_ids.length} piece
                          {c.item_ids.length === 1 ? "" : "s"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  )}
                />
              </View>
            ) : null
          }
        />
      )}
      <OutfitPill onPress={() => setOutfitOpen(true)} />
      <OutfitDrawer visible={outfitOpen} onClose={() => setOutfitOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 8,
  },
  headerTitle: { marginTop: 4 },
  iconBtn: { padding: 8 },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  brandInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.primary,
    paddingVertical: 6,
  },
  brandApply: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.primary,
  },
  brandApplyLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.primaryFg,
  },
  brandChipRow: {
    alignSelf: "flex-start",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
  },
  brandChipLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.primaryFg,
    textTransform: "uppercase",
  },
  sizeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    backgroundColor: colors.primary,
  },
  sizeBannerText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    color: colors.primaryFg,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  audienceBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    backgroundColor: colors.muted,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  profileChipWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  genderRowWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: 4,
    paddingBottom: 2,
  },
  genderRowLabel: {
    color: colors.mutedFg,
    marginBottom: 6,
  },
  ageGroupWrap: {
    paddingTop: 4,
    paddingBottom: 4,
  },
  audienceText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    color: colors.primary,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  audienceLink: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.primary,
    textTransform: "uppercase",
    textDecorationLine: "underline",
  },
  listContent: { paddingBottom: spacing.xxl, paddingTop: spacing.md },
  emptyListContent: {
    flexGrow: 1,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.md,
  },
  dropsBlock: { marginBottom: spacing.lg },
  dropsHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  dropsRow: { paddingHorizontal: spacing.lg, gap: spacing.md },
  dropCard: {
    width: 240,
    height: 150,
    backgroundColor: colors.muted,
    overflow: "hidden",
    position: "relative",
  },
  dropImage: { ...StyleSheet.absoluteFillObject, width: 240, height: 150 },
  dropImageEmpty: { backgroundColor: colors.primary },
  dropOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  dropTextWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 14,
  },
  dropName: {
    fontFamily: fonts.heading,
    fontSize: 20,
    lineHeight: 22,
    color: "#FFFFFF",
  },
  dropMeta: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: "#E5E5E5",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 4,
  },
  card: {
    flex: 1,
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
  },
  cardLeft: { marginLeft: spacing.lg, marginRight: spacing.sm / 2 },
  cardRight: { marginLeft: spacing.sm / 2, marginRight: spacing.lg },
  cardImage: { width: "100%", aspectRatio: 3 / 4, backgroundColor: colors.muted },
  cardImageWrap: { position: "relative" },
  cardHeart: { position: "absolute", top: 8, right: 8 },
  cardFit: { position: "absolute", top: 8, left: 8 },
  outBadge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "#DC2626",
  },
  outBadgeText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primaryFg,
  },
  lowBadge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "#D97706",
  },
  lowBadgeText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primaryFg,
  },
  galleryBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(10,10,10,0.65)",
  },
  galleryBadgeText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 0.5,
    color: colors.primaryFg,
  },
  cardBody: { paddingTop: spacing.sm },
  cardSellerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardSeller: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 10, letterSpacing: 2, color: colors.mutedFg },
  cardName: { fontFamily: fonts.heading, fontSize: 18, color: colors.primary, marginTop: 2 },
  cardPrice: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary, marginTop: 4 },
  cardPriceApprox: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    marginTop: 2,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { padding: spacing.lg },
  emptyHero: { width: "100%", aspectRatio: 4 / 5, backgroundColor: colors.muted, marginBottom: spacing.lg },
  emptyTitle: {},
  emptySub: { marginTop: spacing.sm },
});

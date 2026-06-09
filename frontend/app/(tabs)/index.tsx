import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChipsRow } from "@/src/components/ChipsRow";
import { HeartButton } from "@/src/components/HeartButton";
import { useToast } from "@/src/components/Toast";
import { api, Collection, Item } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPrice, indicativePrice } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const CATEGORIES = [
  { key: "shirts", label: "Shirts" },
  { key: "dresses", label: "Dresses" },
  { key: "pants", label: "Pants" },
  { key: "outerwear", label: "Outerwear" },
  { key: "shoes", label: "Shoes" },
  { key: "accessories", label: "Accessories" },
];

const HERO =
  "https://images.unsplash.com/photo-1668952135120-7d997b1b3778?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODl8MHwxfHNlYXJjaHwxfHxmYXNoaW9uJTIwZWRpdG9yaWFsJTIwbW9kZWwlMjBzdHVkaW98ZW58MHx8fHwxNzgwOTIzMjg3fDA&ixlib=rb-4.1.0&q=85";

export default function Discover() {
  const { user } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [wishedIds, setWishedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const audienceLabel =
    user?.gender === "male" ? "men" : user?.gender === "female" ? "women" : null;

  const load = useCallback(async () => {
    try {
      const [data, wl] = await Promise.all([
        api.listItems({
          category: category ?? undefined,
          size: sizeFilter ?? undefined,
          audience: showAll ? "all" : undefined,
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
  }, [category, sizeFilter, showAll, toast, user?.role]);

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

  const renderItem = ({ item, index }: { item: Item; index: number }) => {
    const totalQty = item.sizes.reduce((s, x) => s + (x.available_qty || 0), 0);
    const outOfStock = totalQty === 0;
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
          {outOfStock ? (
            <View style={styles.outBadge} testID={`item-card-${item.id}-out`}>
              <Text style={styles.outBadgeText}>Sold out</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardSeller} numberOfLines={1}>
            {item.seller_name.toUpperCase()}
          </Text>
          <Text style={styles.cardName} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={styles.cardPrice}>{formatPrice(item.price_cents, item.currency)}</Text>
          {(() => {
            const approx = indicativePrice(
              item.price_cents,
              item.currency,
              user?.preferred_currency,
            );
            return approx ? (
              <Text style={styles.cardPriceApprox} numberOfLines={1}>
                {approx}
              </Text>
            ) : null;
          })()}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* Sticky header */}
      <View style={styles.header}>
        <View>
          <Text style={tp.caption}>DRAPE</Text>
          <Text style={[tp.h2, styles.headerTitle]}>Hello, {user?.full_name.split(" ")[0]}.</Text>
        </View>
        <TouchableOpacity
          testID="discover-search-btn"
          style={styles.iconBtn}
          onPress={() => toast.show("Search coming soon", "info")}
        >
          <Feather name="search" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>
      <ChipsRow chips={CATEGORIES} active={category} onPress={setCategory} testIDPrefix="cat" />
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
  },
  headerTitle: { marginTop: 4 },
  iconBtn: { padding: 8 },
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
  cardBody: { paddingTop: spacing.sm },
  cardSeller: { fontFamily: fonts.bodyMedium, fontSize: 10, letterSpacing: 2, color: colors.mutedFg },
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

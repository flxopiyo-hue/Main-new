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
import { useToast } from "@/src/components/Toast";
import { api, Item } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
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
  const [category, setCategory] = useState<string | null>(null);
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.listItems({
        category: category ?? undefined,
        size: sizeFilter ?? undefined,
      });
      setItems(data);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load items", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [category, sizeFilter, toast]);

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
    return (
      <TouchableOpacity
        testID={`item-card-${item.id}`}
        activeOpacity={0.85}
        onPress={() => router.push(`/item/${item.id}`)}
        style={[styles.card, index % 2 === 0 ? styles.cardLeft : styles.cardRight]}
      >
        <Image
          source={{ uri: dataUriFromBase64(item.image_b64) }}
          style={styles.cardImage}
          resizeMode="cover"
        />
        <View style={styles.cardBody}>
          <Text style={styles.cardSeller} numberOfLines={1}>
            {item.seller_name.toUpperCase()}
          </Text>
          <Text style={styles.cardName} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={styles.cardPrice}>${(item.price_cents / 100).toFixed(0)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      {/* Sticky header */}
      <View style={styles.header}>
        <View>
          <Text style={tp.caption}>AURAFIT</Text>
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
      ) : items.length === 0 ? (
        <FlatList
          testID="discover-list-empty"
          data={[]}
          renderItem={() => null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ flex: 1 }}
          ListHeaderComponent={
            <View style={styles.empty}>
              <Image source={{ uri: HERO }} style={styles.emptyHero} resizeMode="cover" />
              <Text style={[tp.h3, styles.emptyTitle]}>
                {category ? `No ${category} in this size yet.` : "Stocking the racks…"}
              </Text>
              <Text style={[tp.bodyMuted, styles.emptySub]}>
                Pull to refresh, or change filters above. Sellers are uploading new pieces every day.
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          testID="discover-list"
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          numColumns={2}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
  listContent: { paddingBottom: spacing.xxl, paddingTop: spacing.md },
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { padding: spacing.lg },
  emptyHero: { width: "100%", aspectRatio: 4 / 5, backgroundColor: colors.muted, marginBottom: spacing.lg },
  emptyTitle: {},
  emptySub: { marginTop: spacing.sm },
});

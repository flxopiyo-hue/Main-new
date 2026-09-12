import { Feather } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  api,
  CategoryRow,
  Item,
  itemTotalQty,
} from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPriceIn } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { fonts } from "@/src/lib/theme";
import { storeColumns, useBreakpoint, WEB_MAX_WIDTH, webColors } from "@/src/lib/web";
import { WebFooter } from "@/src/components/web/WebFooter";
import { WebNav } from "@/src/components/web/WebNav";

const GENDER_CHIPS = [
  { key: "all", label: "All" },
  { key: "women", label: "Women" },
  { key: "men", label: "Men" },
  { key: "unisex", label: "Unisex" },
  { key: "kids", label: "Kids" },
];

// Public web storefront (oromona.com/store). Anyone can browse the live
// marketplace here without an account; login is prompted at try-on/checkout.
export default function WebStore() {
  const { user } = useAuth();
  const { width } = useBreakpoint();

  const [items, setItems] = useState<Item[]>([]);
  const [catalog, setCatalog] = useState<CategoryRow[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [gender, setGender] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);

  const columns = storeColumns(width);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listItems({
        category: category ?? undefined,
        audience: gender === "all" ? "all" : gender,
        q: search || undefined,
      });
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [category, gender, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const rows = await api.listCategories();
        if (rows.length > 0) setCatalog(rows);
      } catch {
        /* keep empty */
      }
    })();
  }, []);

  // Native devices should never see the website storefront.
  if (Platform.OS !== "web") return <Redirect href="/" />;

  const visibleCategories = (() => {
    const rows =
      gender !== "all"
        ? catalog.filter((c) => (c.audiences ?? []).includes(gender))
        : catalog;
    return rows.map((c) => ({ key: c.slug, label: c.label }));
  })();

  const renderCard = ({ item }: { item: Item }) => {
    const out = itemTotalQty(item) === 0;
    return (
      <TouchableOpacity
        testID={`web-store-card-${item.id}`}
        activeOpacity={0.85}
        style={styles.card}
        onPress={() => router.push(`/item/${item.id}`)}
      >
        <View style={styles.cardImageWrap}>
          <Image
            source={{ uri: dataUriFromBase64(item.image_b64) }}
            style={styles.cardImage}
            resizeMode="cover"
          />
          {out ? (
            <View style={styles.outBadge}>
              <Text style={styles.outBadgeText}>Sold out</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.cardSeller} numberOfLines={1}>
          {(item.brand_name || item.seller_name).toUpperCase()}
        </Text>
        <Text style={styles.cardName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.cardPrice}>
          {formatPriceIn(item.price_cents, item.currency, user?.preferred_currency)}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.root}>
      <WebNav active="shop" />
      <FlatList
        testID="web-store-list"
        style={styles.list}
        data={items}
        key={`web-store-${columns}`}
        keyExtractor={(i) => i.id}
        numColumns={columns}
        renderItem={renderCard}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.kicker}>Shop the collection</Text>
            <Text style={styles.title}>Made to fit you.</Text>

            {/* Search */}
            <View style={styles.searchRow}>
              <Feather name="search" size={16} color={webColors.muted} />
              <TextInput
                testID="web-store-search"
                value={searchInput}
                onChangeText={setSearchInput}
                placeholder="Search pieces, brands, styles…"
                placeholderTextColor={webColors.muted}
                style={styles.searchInput}
                returnKeyType="search"
                onSubmitEditing={() => setSearch(searchInput.trim())}
              />
              {searchInput ? (
                <TouchableOpacity
                  testID="web-store-search-clear"
                  onPress={() => {
                    setSearchInput("");
                    setSearch("");
                  }}
                >
                  <Feather name="x" size={16} color={webColors.muted} />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Gender chips */}
            <ChipRow
              chips={GENDER_CHIPS}
              active={gender}
              onPress={(k) => {
                setGender(k);
                setCategory(null);
              }}
              testIDPrefix="web-store-gender"
            />
            {/* Category chips */}
            {visibleCategories.length > 0 ? (
              <ChipRow
                chips={[{ key: "__all", label: "All" }, ...visibleCategories]}
                active={category ?? "__all"}
                onPress={(k) => setCategory(k === "__all" ? null : k)}
                testIDPrefix="web-store-cat"
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.centerPad}>
              <ActivityIndicator color={webColors.ink} />
            </View>
          ) : (
            <View style={styles.centerPad}>
              <Feather name="shopping-bag" size={28} color={webColors.muted} />
              <Text style={styles.emptyText}>
                No pieces match these filters yet. Try clearing them.
              </Text>
            </View>
          )
        }
        ListFooterComponent={<WebFooter />}
      />
    </View>
  );
}

function ChipRow({
  chips,
  active,
  onPress,
  testIDPrefix,
}: {
  chips: { key: string; label: string }[];
  active: string | null;
  onPress: (k: string) => void;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.chipRow}>
      {chips.map((c) => {
        const isActive = c.key === active;
        return (
          <TouchableOpacity
            key={c.key}
            testID={`${testIDPrefix}-${c.key}`}
            onPress={() => onPress(c.key)}
            style={[styles.chip, isActive && styles.chipActive]}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipLabel, isActive && styles.chipLabelActive]}>{c.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: webColors.bg },
  list: { flex: 1, width: "100%", maxWidth: WEB_MAX_WIDTH, alignSelf: "center" },
  listContent: { paddingHorizontal: 20, paddingBottom: 0, rowGap: 28 },
  column: { gap: 16 },
  header: { paddingTop: 36, paddingBottom: 8 },
  kicker: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 4,
    textTransform: "uppercase",
    color: webColors.accent,
    marginBottom: 8,
  },
  title: { fontFamily: fonts.heading, fontSize: 40, color: webColors.ink, marginBottom: 20 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: webColors.border,
    backgroundColor: webColors.card,
    paddingHorizontal: 14,
    height: 48,
    maxWidth: 520,
    marginBottom: 16,
  },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: webColors.ink },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: webColors.border,
    backgroundColor: webColors.card,
  },
  chipActive: { backgroundColor: webColors.ink, borderColor: webColors.ink },
  chipLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: webColors.muted,
  },
  chipLabelActive: { color: webColors.inkFg },
  card: { flex: 1, backgroundColor: webColors.bg },
  cardImageWrap: { position: "relative", marginBottom: 10 },
  cardImage: { width: "100%", aspectRatio: 3 / 4, backgroundColor: "#E9E1D6" },
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
    color: "#FFFFFF",
  },
  cardSeller: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 2,
    color: webColors.muted,
  },
  cardName: { fontFamily: fonts.heading, fontSize: 19, color: webColors.ink, marginTop: 2 },
  cardPrice: { fontFamily: fonts.bodySemi, fontSize: 14, color: webColors.ink, marginTop: 4 },
  centerPad: { paddingVertical: 64, alignItems: "center", gap: 12 },
  emptyText: { fontFamily: fonts.body, fontSize: 15, color: webColors.muted, textAlign: "center" },
});

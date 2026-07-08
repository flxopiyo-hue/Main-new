// Buyer order history — filterable + searchable list of every order the
// currently signed-in buyer has ever placed. Uses the existing
// `GET /api/orders` endpoint (returns newest first).
//
// UX affordances:
//   • Sticky status filter chips (All / Pending / Paid / Shipped / Delivered)
//   • Search bar filters by item name (client-side substring match — the
//     buyer's total history is small enough that this is snappier than
//     round-tripping a query param).
//   • Empty states differentiated by "no orders ever" vs "no matches for
//     this filter/search".
//   • Every row taps into the existing order detail screen at /order/[id]
//     so the fulfillment timeline component is reused.

import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { api, Order } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPriceIn } from "@/src/lib/currency";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

type Filter = "all" | "pending" | "paid" | "shipped" | "delivered";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "paid", label: "Paid" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
];

// Status labels + colour mapping shared between the row chip and the
// filter chip so the palette stays consistent. Ships-in-progress uses
// the primary indigo, delivered gets a green semantic tint, pending
// muted, cancelled red.
const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  pending: { color: colors.mutedFg, label: "PENDING" },
  paid: { color: colors.primary, label: "PAID" },
  in_fulfillment: { color: "#D97706", label: "PACKING" },
  shipped: { color: "#059669", label: "SHIPPED" },
  delivered: { color: "#0F766E", label: "DELIVERED" },
  cancelled: { color: colors.error, label: "CANCELLED" },
  failed: { color: colors.error, label: "FAILED" },
};

export default function OrderHistoryScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await api.orders();
      setOrders(list);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load orders", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Client-side filter + search. Case-insensitive substring on item_name.
  const visible = useMemo(() => {
    let list = orders;
    if (filter !== "all") {
      // Ship + delivered filters need to include the intermediate
      // "in_fulfillment" state or the buyer would think their paid order
      // vanished the moment the seller packed it.
      if (filter === "shipped") {
        list = list.filter(
          (o) => o.status === "shipped" || o.status === "in_fulfillment",
        );
      } else {
        list = list.filter((o) => o.status === filter);
      }
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((o) => o.item_name.toLowerCase().includes(q));
    }
    return list;
  }, [orders, filter, search]);

  const totalSpent = useMemo(
    () => orders.filter((o) => o.status !== "cancelled" && o.status !== "failed")
              .reduce((sum, o) => sum + o.amount_cents, 0),
    [orders],
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.center]} edges={["top"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="orders-history-back"
          style={styles.iconBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={tp.caption}>MY ORDERS</Text>
          <Text style={[tp.h2, { marginTop: 4 }]}>Order history</Text>
        </View>
      </View>

      {/* Totals card — small, informative, no CTA */}
      <View style={styles.totalCard} testID="orders-history-total">
        <View style={{ flex: 1 }}>
          <Text style={[tp.caption, { color: colors.mutedFg }]}>Total lifetime spend</Text>
          <Text style={styles.totalValue} numberOfLines={1}>
            {orders.length > 0
              ? formatPriceIn(
                  totalSpent,
                  orders[0]?.currency ?? "KES",
                  user?.preferred_currency ?? "KES",
                )
              : formatPriceIn(0, "KES", user?.preferred_currency ?? "KES")}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[tp.caption, { color: colors.mutedFg }]}>Orders placed</Text>
          <Text style={styles.totalCount} testID="orders-history-count">
            {orders.length}
          </Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Feather name="search" size={14} color={colors.mutedFg} />
        <TextInput
          testID="orders-history-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search by item name"
          placeholderTextColor={colors.mutedFg}
          style={styles.searchInput}
          returnKeyType="search"
        />
        {search ? (
          <TouchableOpacity
            testID="orders-history-search-clear"
            onPress={() => setSearch("")}
          >
            <Feather name="x" size={14} color={colors.mutedFg} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Filter chips */}
      <FlatList
        data={FILTERS}
        horizontal
        keyExtractor={(f) => f.key}
        contentContainerStyle={styles.filterRow}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => {
          const active = filter === item.key;
          return (
            <TouchableOpacity
              testID={`orders-history-filter-${item.key}`}
              onPress={() => setFilter(item.key)}
              style={[styles.filterChip, active && styles.filterChipActive]}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.filterLabel,
                  active && styles.filterLabelActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      <FlatList
        data={visible}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
        renderItem={({ item }) => (
          <OrderRow item={item} preferredCurrency={user?.preferred_currency ?? "KES"} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="package" size={28} color={colors.mutedFg} />
            <Text style={[tp.h3, styles.emptyTitle]}>
              {orders.length === 0 ? "No orders yet" : "No matches"}
            </Text>
            <Text style={[tp.bodyMuted, styles.emptyBody]}>
              {orders.length === 0
                ? "When you complete a checkout, it'll show up here."
                : "Try clearing the filter or search."}
            </Text>
            {orders.length === 0 ? (
              <TouchableOpacity
                testID="orders-history-shop-cta"
                style={styles.shopCta}
                onPress={() => router.replace("/(tabs)")}
                activeOpacity={0.85}
              >
                <Text style={styles.shopCtaLabel}>DISCOVER PIECES</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
      />
    </SafeAreaView>
  );
}

function OrderRow({
  item,
  preferredCurrency,
}: {
  item: Order;
  preferredCurrency: string;
}) {
  const style = STATUS_STYLE[item.status] ?? {
    color: colors.mutedFg,
    label: item.status.toUpperCase(),
  };
  return (
    <TouchableOpacity
      testID={`orders-history-row-${item.id}`}
      onPress={() => router.push(`/order/${item.id}`)}
      activeOpacity={0.85}
      style={styles.row}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.item_name}
        </Text>
        <Text style={[tp.bodyMuted, { marginTop: 2 }]} numberOfLines={1}>
          Size {item.size}
          {item.color ? ` · ${item.color}` : ""}
        </Text>
        <View style={styles.rowMeta}>
          <View
            style={[styles.rowStatusChip, { borderColor: style.color }]}
            testID={`orders-history-row-${item.id}-status`}
          >
            <Text style={[styles.rowStatusLabel, { color: style.color }]}>
              {style.label}
            </Text>
          </View>
          <Text style={[tp.bodyMuted, { fontSize: 11 }]}>
            {new Date(item.created_at).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Text style={styles.rowAmount}>
          {formatPriceIn(item.amount_cents, item.currency, preferredCurrency)}
        </Text>
        <Feather name="chevron-right" size={16} color={colors.mutedFg} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  iconBtn: { padding: 8 },
  totalCard: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  totalValue: {
    fontFamily: fonts.heading,
    fontSize: 24,
    color: colors.primary,
    marginTop: 4,
  },
  totalCount: {
    fontFamily: fonts.heading,
    fontSize: 24,
    color: colors.primary,
    marginTop: 4,
  },
  searchRow: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.primary,
  },
  filterRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  filterLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.primary,
    textTransform: "uppercase",
  },
  filterLabelActive: { color: colors.primaryFg },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.primary,
  },
  rowMeta: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  rowStatusChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  rowStatusLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  rowAmount: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.primary,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  emptyTitle: { textAlign: "center", marginTop: spacing.sm },
  emptyBody: { textAlign: "center" },
  shopCta: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    backgroundColor: colors.primary,
  },
  shopCtaLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.primaryFg,
  },
});

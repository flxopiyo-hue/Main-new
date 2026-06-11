// Vendor Inventory Dashboard — sellers land here after login.
//
// Layout (mobile-first, scales up on tablet/web):
//   ┌────────────────────────────────────────────────────────────┐
//   │ Brand header + Add New Product CTA                          │
//   ├────────────────────────────────────────────────────────────┤
//   │ [Gross Revenue] [Platform Fees Deducted] [Total Orders]     │
//   ├────────────────────────────────────────────────────────────┤
//   │ Listings table (Photo · Title · Price · Stock · Views ·     │
//   │                  Try-Ons · Actions)                          │
//   └────────────────────────────────────────────────────────────┘
//
// The metric cards are wired to `/api/seller/analytics` so the values are
// the same numbers Drape will pay out / fee on. The table sources from
// `/api/items/mine` and joins the per-item analytics on the fly. Each row
// includes a single-tap delete; tapping the row body opens the buyer-facing
// item detail in a new screen so the seller can preview their listing.

import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { api, Item, SellerAnalytics } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPrice } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface Row {
  item: Item;
  views: number;
  try_ons: number;
  total_qty: number;
}

export default function Inventory() {
  const toast = useToast();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<Item[]>([]);
  const [analytics, setAnalytics] = useState<SellerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [its, an] = await Promise.all([
        api.myItems(),
        api.sellerAnalytics(),
      ]);
      setItems(its);
      setAnalytics(an);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load dashboard", "error");
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

  const remove = async (id: string, name: string) => {
    try {
      await api.deleteItem(id);
      toast.show(`Removed "${name}"`, "success");
      load();
    } catch (e: any) {
      toast.show(e?.message ?? "Delete failed", "error");
    }
  };

  // Join items with their per-item analytics row so the table can show
  // views/try-ons inline. If analytics hasn't loaded yet (e.g. brand new
  // seller), we just default the counters to zero.
  const rows: Row[] = useMemo(() => {
    const statsById = new Map(
      (analytics?.items ?? []).map((a) => [a.item_id, a] as const),
    );
    return items.map((item) => {
      const a = statsById.get(item.id);
      return {
        item,
        views: a?.views ?? 0,
        try_ons: a?.try_ons ?? 0,
        total_qty: item.sizes.reduce((sum, s) => sum + s.available_qty, 0),
      };
    });
  }, [items, analytics]);

  // Currency to display the KPI totals in. We prefer the seller's stored
  // preference so the dashboard "feels" theirs.
  const dispCurrency = user?.preferred_currency ?? "USD";

  // On wide viewports (≥720px, e.g. tablet landscape / web) we use a true
  // tabular layout. On narrow phones we stack each row as a card. This is
  // the simplest responsive trick that keeps both layouts touch-friendly.
  const isWide = width >= 720;

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.center]} edges={["top"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        testID="inventory-scroll"
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
      >
        {/* Brand header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={tp.caption}>SELLER PORTAL</Text>
            <Text style={[tp.h2, { marginTop: 4 }]} numberOfLines={2}>
              {user?.company_name || user?.full_name || "Inventory"}
            </Text>
            {user?.location ? (
              <Text style={[tp.bodyMuted, { marginTop: 4 }]}>
                <Feather name="map-pin" size={11} color={colors.mutedFg} />{" "}
                {user.location.city}, {user.location.country}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            testID="inventory-add-btn"
            onPress={() => router.push("/add-item")}
            style={styles.primaryBtn}
            activeOpacity={0.85}
          >
            <Feather name="plus" size={16} color={colors.primaryFg} />
            <Text style={styles.primaryLabel}>Add New Product</Text>
          </TouchableOpacity>
        </View>

        {/* Metric cards */}
        <View style={[styles.kpiRow, isWide && styles.kpiRowWide]}>
          <KpiCard
            testID="kpi-gross"
            icon="trending-up"
            label="Gross Revenue"
            value={formatPrice(analytics?.total_revenue_cents ?? 0, dispCurrency)}
            hint={`${analytics?.total_orders_paid ?? 0} paid order${
              (analytics?.total_orders_paid ?? 0) === 1 ? "" : "s"
            }`}
          />
          <KpiCard
            testID="kpi-fees"
            icon="percent"
            label="Platform Fees Deducted"
            value={formatPrice(
              analytics?.total_platform_fee_cents ?? 0,
              dispCurrency,
            )}
            hint={`${((analytics?.platform_fee_bps ?? 0) / 100).toFixed(0)}% per transaction`}
          />
          <KpiCard
            testID="kpi-orders"
            icon="shopping-bag"
            label="Total Orders"
            value={String(analytics?.total_orders_paid ?? 0)}
            hint={`${analytics?.total_try_ons ?? 0} try-ons · ${
              analytics?.total_wishlists ?? 0
            } wishlists`}
          />
        </View>

        {/* Listings */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={tp.caption}>Active listings</Text>
            <Text style={[tp.bodyMuted, { fontSize: 11 }]} testID="inventory-count">
              {rows.length} item{rows.length === 1 ? "" : "s"}
            </Text>
          </View>

          {rows.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="package" size={28} color={colors.mutedFg} />
              <Text style={[tp.h3, styles.emptyTitle]}>No active listings</Text>
              <Text style={[tp.bodyMuted, styles.emptyBody]}>
                Upload your first item to start collecting views and orders.
              </Text>
              <TouchableOpacity
                testID="inventory-empty-add-btn"
                onPress={() => router.push("/add-item")}
                style={[styles.primaryBtn, { marginTop: spacing.lg }]}
                activeOpacity={0.85}
              >
                <Feather name="plus" size={16} color={colors.primaryFg} />
                <Text style={styles.primaryLabel}>Add New Product</Text>
              </TouchableOpacity>
            </View>
          ) : isWide ? (
            <TableView rows={rows} onDelete={remove} />
          ) : (
            <View>
              {rows.map((r) => (
                <ListingCard key={r.item.id} row={r} onDelete={remove} />
              ))}
            </View>
          )}
        </View>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function KpiCard({
  icon,
  label,
  value,
  hint,
  testID,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  hint?: string;
  testID?: string;
}) {
  return (
    <View style={styles.kpiCard} testID={testID}>
      <View style={styles.kpiTop}>
        <Text style={[tp.caption, { color: colors.mutedFg }]}>{label}</Text>
        <Feather name={icon} size={16} color={colors.primary} />
      </View>
      <Text style={styles.kpiValue} numberOfLines={1}>
        {value}
      </Text>
      {hint ? <Text style={styles.kpiHint} numberOfLines={2}>{hint}</Text> : null}
    </View>
  );
}

function ListingCard({
  row,
  onDelete,
}: {
  row: Row;
  onDelete: (id: string, name: string) => void;
}) {
  const { item } = row;
  return (
    <Pressable
      testID={`inventory-row-${item.id}`}
      onPress={() => router.push(`/item/${item.id}`)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <Image
        source={{ uri: dataUriFromBase64(item.image_b64) }}
        style={styles.cardThumb}
        resizeMode="cover"
      />
      <View style={{ flex: 1 }}>
        <Text style={tp.caption} numberOfLines={1}>
          {item.category.toUpperCase()}
          {item.subcategory ? ` · ${item.subcategory}` : ""}
        </Text>
        <Text style={styles.cardName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.cardPrice}>
          {formatPrice(item.price_cents, item.currency)}
        </Text>
        <View style={styles.cardMeta}>
          <Stat label="Stock" value={row.total_qty} testID={`stock-${item.id}`} />
          <Stat label="Views" value={row.views} testID={`views-${item.id}`} />
          <Stat label="Try-ons" value={row.try_ons} testID={`tryons-${item.id}`} />
        </View>
      </View>
      <TouchableOpacity
        testID={`inventory-delete-${item.id}`}
        onPress={() => onDelete(item.id, item.name)}
        style={styles.deleteBtn}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
        <Feather name="trash-2" size={16} color={colors.error} />
      </TouchableOpacity>
    </Pressable>
  );
}

function TableView({
  rows,
  onDelete,
}: {
  rows: Row[];
  onDelete: (id: string, name: string) => void;
}) {
  return (
    <View style={styles.table} testID="inventory-table">
      <View style={[styles.tableRow, styles.tableHead]}>
        <Text style={[styles.cellPhoto, styles.tableHeadText]}>PHOTO</Text>
        <Text style={[styles.cellTitle, styles.tableHeadText]}>TITLE</Text>
        <Text style={[styles.cellPrice, styles.tableHeadText]}>PRICE</Text>
        <Text style={[styles.cellNumber, styles.tableHeadText]}>STOCK</Text>
        <Text style={[styles.cellNumber, styles.tableHeadText]}>VIEWS</Text>
        <Text style={[styles.cellNumber, styles.tableHeadText]}>TRY-ONS</Text>
        <Text style={[styles.cellActions, styles.tableHeadText]}> </Text>
      </View>
      {rows.map(({ item, views, try_ons, total_qty }) => (
        <Pressable
          key={item.id}
          testID={`inventory-table-row-${item.id}`}
          onPress={() => router.push(`/item/${item.id}`)}
          style={({ pressed }) => [
            styles.tableRow,
            pressed && styles.cardPressed,
          ]}
        >
          <View style={styles.cellPhoto}>
            <Image
              source={{ uri: dataUriFromBase64(item.image_b64) }}
              style={styles.tableThumb}
              resizeMode="cover"
            />
          </View>
          <View style={styles.cellTitle}>
            <Text style={styles.cardName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[tp.bodyMuted, { fontSize: 11 }]} numberOfLines={1}>
              {item.category}
              {item.subcategory ? ` · ${item.subcategory}` : ""}
            </Text>
          </View>
          <Text style={[styles.cellPrice, styles.cellText]}>
            {formatPrice(item.price_cents, item.currency)}
          </Text>
          <Text style={[styles.cellNumber, styles.cellText]}>{total_qty}</Text>
          <Text style={[styles.cellNumber, styles.cellText]}>{views}</Text>
          <Text style={[styles.cellNumber, styles.cellText]}>{try_ons}</Text>
          <View style={styles.cellActions}>
            <TouchableOpacity
              testID={`inventory-table-delete-${item.id}`}
              onPress={() => onDelete(item.id, item.name)}
              style={styles.deleteBtn}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Feather name="trash-2" size={16} color={colors.error} />
            </TouchableOpacity>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function Stat({
  label,
  value,
  testID,
}: {
  label: string;
  value: number;
  testID?: string;
}) {
  return (
    <View style={styles.statCell} testID={testID}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  scroll: { paddingBottom: spacing.xxl },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.md,
    flexWrap: "wrap",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    minHeight: 44,
  },
  primaryLabel: {
    color: colors.primaryFg,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  kpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  kpiRowWide: { flexWrap: "nowrap" },
  kpiCard: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 220,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 120,
  },
  kpiTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kpiValue: {
    fontFamily: fonts.heading,
    fontSize: 28,
    color: colors.primary,
    marginTop: 12,
  },
  kpiHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
    marginTop: 6,
  },
  section: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { textAlign: "center", marginTop: spacing.sm },
  emptyBody: { textAlign: "center" },
  // Card layout (mobile)
  card: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cardPressed: { opacity: 0.7 },
  cardThumb: { width: 72, height: 92, backgroundColor: colors.muted },
  cardName: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.primary,
    marginTop: 4,
  },
  cardPrice: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
    marginTop: 4,
  },
  cardMeta: { flexDirection: "row", gap: spacing.lg, marginTop: 8 },
  statCell: { minWidth: 56 },
  statValue: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.primary },
  statLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 9,
    letterSpacing: 1.5,
    color: colors.mutedFg,
    textTransform: "uppercase",
    marginTop: 2,
  },
  deleteBtn: { padding: 8, alignSelf: "flex-start" },
  // Table layout (wide)
  table: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  tableHead: { backgroundColor: colors.muted },
  tableHeadText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.mutedFg,
    textTransform: "uppercase",
  },
  tableThumb: { width: 56, height: 72, backgroundColor: colors.muted },
  cellPhoto: { width: 72 },
  cellTitle: { flex: 3, minWidth: 160 },
  cellPrice: { flex: 1, minWidth: 80, textAlign: "right" },
  cellNumber: { flex: 1, minWidth: 60, textAlign: "right" },
  cellActions: { width: 40, alignItems: "flex-end" },
  cellText: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.primary,
    ...(Platform.OS === "web" ? { whiteSpace: "nowrap" as any } : {}),
  },
});

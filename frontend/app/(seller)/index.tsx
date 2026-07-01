// Vendor Inventory Dashboard — sellers land here after login.
//
// Mobile-first card layout (with a wider tabular variant on tablet). Each
// listing row now ships with a kebab/action menu so the seller can:
//   • Edit       → opens the Add Item wizard pre-loaded with this item.
//   • Duplicate  → server clones the item; new copy lands paused.
//   • Pause/Unpause → toggles `is_paused`; hidden listings stay in the
//                     inventory dashboard but disappear from Discover.
//   • Delete     → unchanged; lives at the end of the action strip.
//
// A new low-stock nudge surfaces under any item whose total inventory
// across sizes is ≤5 so sellers see what's about to run out at a glance.

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

import { HeaderMenu } from "@/src/components/HeaderMenu";
import { useToast } from "@/src/components/Toast";
import { api, Item, SellerAnalytics, CATEGORY_LABELS } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPrice, formatPriceIn } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface Row {
  item: Item;
  views: number;
  try_ons: number;
  total_qty: number;
}

type RowAction = (item: Item) => Promise<void> | void;

interface RowActions {
  onEdit: RowAction;
  onDuplicate: RowAction;
  onTogglePause: RowAction;
  onDelete: RowAction;
}

const LOW_STOCK_THRESHOLD = 5;

export default function Inventory() {
  const toast = useToast();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<Item[]>([]);
  const [analytics, setAnalytics] = useState<SellerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const onEdit = useCallback((item: Item) => {
    router.push(`/(seller)/add-item?edit_id=${item.id}`);
  }, []);

  const onDuplicate = useCallback(
    async (item: Item) => {
      setBusyId(item.id);
      try {
        await api.duplicateItem(item.id);
        toast.show(`Duplicated "${item.name}" (paused)`, "success");
        await load();
      } catch (e: any) {
        toast.show(e?.message ?? "Could not duplicate", "error");
      } finally {
        setBusyId(null);
      }
    },
    [toast, load],
  );

  const onTogglePause = useCallback(
    async (item: Item) => {
      setBusyId(item.id);
      try {
        const next = !item.is_paused;
        await api.patchItem(item.id, { is_paused: next });
        toast.show(
          next
            ? `Paused "${item.name}" — hidden from buyers`
            : `Unpaused "${item.name}" — live for buyers`,
          "success",
        );
        await load();
      } catch (e: any) {
        toast.show(e?.message ?? "Could not update", "error");
      } finally {
        setBusyId(null);
      }
    },
    [toast, load],
  );

  const onDelete = useCallback(
    async (item: Item) => {
      try {
        await api.deleteItem(item.id);
        toast.show(`Removed "${item.name}"`, "success");
        await load();
      } catch (e: any) {
        toast.show(e?.message ?? "Delete failed", "error");
      }
    },
    [toast, load],
  );

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

  // Number of listings that are either low stock OR fully out of stock.
  // Drives the inventory health banner near the top of the page.
  const lowStockRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          !r.item.is_paused && r.total_qty > 0 && r.total_qty <= LOW_STOCK_THRESHOLD,
      ),
    [rows],
  );
  const outOfStockRows = useMemo(
    () => rows.filter((r) => !r.item.is_paused && r.total_qty === 0),
    [rows],
  );

  // Currency to display the KPI totals in. We prefer the seller's stored
  // preference so the dashboard "feels" theirs.
  const dispCurrency = user?.preferred_currency ?? "USD";

  // On wide viewports (≥720px, e.g. tablet landscape / web) we use a true
  // tabular layout. On narrow phones we stack each row as a card. This is
  // the simplest responsive trick that keeps both layouts touch-friendly.
  const isWide = width >= 720;

  const actions: RowActions = { onEdit, onDuplicate, onTogglePause, onDelete };

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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={tp.caption}>SELLER PORTAL</Text>
            </View>
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TouchableOpacity
              testID="inventory-add-btn"
              onPress={() => router.push("/(seller)/add-item")}
              style={styles.primaryBtn}
              activeOpacity={0.85}
            >
              <Feather name="plus" size={16} color={colors.primaryFg} />
              <Text style={styles.primaryLabel}>Add</Text>
            </TouchableOpacity>
            <HeaderMenu testID="inventory-header-menu" />
          </View>
        </View>

        {/* Stock health nudges */}
        {outOfStockRows.length > 0 || lowStockRows.length > 0 ? (
          <View style={styles.nudgeRow} testID="inventory-nudge-row">
            {outOfStockRows.length > 0 ? (
              <View
                style={[styles.nudgeChip, { borderColor: colors.error }]}
                testID="inventory-nudge-out"
              >
                <Feather name="alert-octagon" size={12} color={colors.error} />
                <Text style={[styles.nudgeLabel, { color: colors.error }]}>
                  {outOfStockRows.length} sold out
                </Text>
              </View>
            ) : null}
            {lowStockRows.length > 0 ? (
              <View
                style={[styles.nudgeChip, { borderColor: "#D97706" }]}
                testID="inventory-nudge-low"
              >
                <Feather name="alert-triangle" size={12} color="#D97706" />
                <Text style={[styles.nudgeLabel, { color: "#D97706" }]}>
                  {lowStockRows.length} low stock
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

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
                onPress={() => router.push("/(seller)/add-item")}
                style={[styles.primaryBtn, { marginTop: spacing.lg }]}
                activeOpacity={0.85}
              >
                <Feather name="plus" size={16} color={colors.primaryFg} />
                <Text style={styles.primaryLabel}>Add New Product</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              {rows.map((r) => (
                <ListingCard
                  key={r.item.id}
                  row={r}
                  busy={busyId === r.item.id}
                  actions={actions}
                  dispCurrency={dispCurrency}
                />
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
  busy,
  actions,
  dispCurrency,
}: {
  row: Row;
  busy: boolean;
  actions: RowActions;
  dispCurrency: string;
}) {
  const { item } = row;
  const paused = !!item.is_paused;
  const outOfStock = row.total_qty === 0;
  const lowStock = !outOfStock && row.total_qty <= LOW_STOCK_THRESHOLD;

  return (
    <View style={styles.card} testID={`inventory-row-${item.id}`}>
      <Pressable
        testID={`inventory-row-${item.id}-open`}
        onPress={() => router.push(`/item/${item.id}`)}
        style={({ pressed }) => [styles.cardTop, pressed && styles.cardPressed]}
      >
        <View>
          <Image
            source={{ uri: dataUriFromBase64(item.image_b64) }}
            style={styles.cardThumb}
            resizeMode="cover"
          />
          {paused ? (
            <View style={styles.pausedBadge} testID={`inventory-row-${item.id}-paused-badge`}>
              <Feather name="pause" size={10} color={colors.primaryFg} />
              <Text style={styles.pausedBadgeLabel}>PAUSED</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={tp.caption} numberOfLines={1}>
            {(CATEGORY_LABELS[item.category] ?? item.category).toUpperCase()}
            {item.subcategory ? ` · ${item.subcategory}` : ""}
          </Text>
          <Text style={styles.cardName} numberOfLines={2}>
            {item.name}
          </Text>
          {item.brand_name ? (
            <Text style={[tp.bodyMuted, { fontSize: 11 }]} numberOfLines={1}>
              by {item.brand_name}
            </Text>
          ) : null}
          <Text style={styles.cardPrice}>
            {formatPriceIn(item.price_cents, item.currency, dispCurrency)}
            {item.currency !== dispCurrency ? (
              <Text style={[tp.bodyMuted, { fontSize: 11 }]}>
                {"  ·  "}listed {formatPrice(item.price_cents, item.currency)}
              </Text>
            ) : null}
          </Text>
          <View style={styles.cardMeta}>
            <Stat label="Stock" value={row.total_qty} testID={`stock-${item.id}`} />
            <Stat label="Views" value={row.views} testID={`views-${item.id}`} />
            <Stat label="Try-ons" value={row.try_ons} testID={`tryons-${item.id}`} />
          </View>
          {outOfStock ? (
            <View style={[styles.stockHint, { backgroundColor: colors.error }]} testID={`inventory-row-${item.id}-soldout`}>
              <Feather name="alert-octagon" size={10} color={colors.primaryFg} />
              <Text style={styles.stockHintLabel}>Sold out — restock or pause</Text>
            </View>
          ) : lowStock ? (
            <View style={[styles.stockHint, { backgroundColor: "#D97706" }]} testID={`inventory-row-${item.id}-low`}>
              <Feather name="alert-triangle" size={10} color={colors.primaryFg} />
              <Text style={styles.stockHintLabel}>
                Only {row.total_qty} left across sizes
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {/* Row actions strip */}
      <View style={styles.actionRow}>
        <ActionButton
          icon="edit-2"
          label="Edit"
          testID={`inventory-row-${item.id}-edit`}
          disabled={busy}
          onPress={() => actions.onEdit(item)}
        />
        <ActionButton
          icon="copy"
          label="Duplicate"
          testID={`inventory-row-${item.id}-duplicate`}
          disabled={busy}
          onPress={() => actions.onDuplicate(item)}
        />
        <ActionButton
          icon={paused ? "play" : "pause"}
          label={paused ? "Unpause" : "Pause"}
          testID={`inventory-row-${item.id}-toggle-pause`}
          disabled={busy}
          onPress={() => actions.onTogglePause(item)}
        />
        <ActionButton
          icon="trash-2"
          label="Delete"
          destructive
          testID={`inventory-row-${item.id}-delete`}
          disabled={busy}
          onPress={() => actions.onDelete(item)}
        />
      </View>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  testID,
  onPress,
  disabled,
  destructive,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  testID: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.actionBtn,
        destructive && styles.actionBtnDestructive,
        disabled && { opacity: 0.5 },
      ]}
      hitSlop={{ top: 4, right: 4, bottom: 4, left: 4 }}
      activeOpacity={0.7}
    >
      <Feather
        name={icon}
        size={13}
        color={destructive ? colors.error : colors.primary}
      />
      <Text
        style={[
          styles.actionLabel,
          destructive && { color: colors.error },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
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
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: 40,
  },
  primaryLabel: {
    color: colors.primaryFg,
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  nudgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  nudgeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  nudgeLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
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
  // Card layout (mobile + tablet)
  card: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  cardTop: {
    flexDirection: "row",
    gap: spacing.md,
  },
  cardPressed: { opacity: 0.7 },
  cardThumb: { width: 72, height: 92, backgroundColor: colors.muted },
  pausedBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: colors.primary,
  },
  pausedBadgeLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1,
    color: colors.primaryFg,
  },
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
  stockHint: {
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  stockHintLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.primaryFg,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionBtnDestructive: {
    borderColor: colors.error,
  },
  actionLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primary,
    textTransform: "uppercase",
  },
  // Legacy table styles retained in case we re-enable the wide-mode table later.
  cellText: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.primary,
    ...(Platform.OS === "web" ? { whiteSpace: "nowrap" as any } : {}),
  },
});

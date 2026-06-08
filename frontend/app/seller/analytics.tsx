import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { api, SellerAnalytics } from "@/src/lib/api";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function Analytics() {
  const toast = useToast();
  const [data, setData] = useState<SellerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const a = await api.sellerAnalytics();
      setData(a);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load analytics", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !data) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const fmt = (c: number) => `$${(c / 100).toFixed(0)}`;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="analytics-back-btn"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption}>ATELIER · ANALYTICS</Text>
        <View style={styles.iconBtn} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.summary}>
          <Text style={[tp.h1, styles.kpi]} testID="analytics-revenue">
            {fmt(data.total_revenue_cents)}
          </Text>
          <Text style={tp.caption}>Revenue (paid)</Text>
        </View>

        <View style={styles.statsGrid}>
          <Stat label="Views" value={data.total_views} testID="analytics-views" />
          <Stat label="Try-ons" value={data.total_try_ons} testID="analytics-tryons" />
          <Stat label="Wishlists" value={data.total_wishlists} testID="analytics-wishes" />
          <Stat label="Orders" value={data.total_orders_paid} testID="analytics-orders" />
        </View>

        <Text style={[tp.caption, styles.section]}>Per piece</Text>
        {data.items.length === 0 ? (
          <Text style={[tp.bodyMuted, { paddingHorizontal: spacing.lg }]}>
            Publish your first piece to start collecting insights.
          </Text>
        ) : (
          data.items.map((it) => {
            const conv = (it.conversion * 100).toFixed(1);
            return (
              <TouchableOpacity
                key={it.item_id}
                testID={`analytics-item-${it.item_id}`}
                onPress={() => router.push(`/item/${it.item_id}`)}
                style={styles.itemCard}
                activeOpacity={0.85}
              >
                <View style={styles.itemHeader}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {it.name}
                  </Text>
                  <Text style={styles.itemRevenue}>{fmt(it.revenue_cents)}</Text>
                </View>
                <View style={styles.itemStats}>
                  <ItemStat label="Views" value={it.views} />
                  <ItemStat label="Try-ons" value={it.try_ons} />
                  <ItemStat label="Wished" value={it.wishlists} />
                  <ItemStat label="Sold" value={it.orders_paid} />
                  <ItemStat label="Conv" value={`${conv}%`} />
                </View>
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
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

function ItemStat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.itemStat}>
      <Text style={styles.itemStatValue}>{value}</Text>
      <Text style={styles.itemStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: { width: 40, height: 32, justifyContent: "center" },
  scroll: { paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  summary: { paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  kpi: { fontSize: 56, lineHeight: 60 },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  statCell: {
    width: "50%",
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
  },
  statValue: { fontFamily: fonts.heading, fontSize: 32, color: colors.primary },
  statLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.8,
    color: colors.mutedFg,
    textTransform: "uppercase",
    marginTop: 4,
  },
  section: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  itemCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  itemName: { fontFamily: fonts.heading, fontSize: 18, color: colors.primary, flex: 1, marginRight: spacing.md },
  itemRevenue: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  itemStats: { flexDirection: "row", gap: spacing.md, flexWrap: "wrap" },
  itemStat: { minWidth: 56 },
  itemStatValue: { fontFamily: fonts.bodySemi, fontSize: 18, color: colors.primary },
  itemStatLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 9,
    letterSpacing: 1.5,
    color: colors.mutedFg,
    textTransform: "uppercase",
    marginTop: 2,
  },
});

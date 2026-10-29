// Admin dashboard — at-a-glance platform analytics.

import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { AdminShell } from "@/src/components/AdminShell";
import { useToast } from "@/src/components/Toast";
import { AdminAnalytics, api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPrice } from "@/src/lib/currency";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function AdminDashboard() {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const a = await api.adminAnalytics();
      setData(a);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load analytics", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useFocusEffect(
    useCallback(() => {
      if (!authLoading) {
        if (!user || user.role !== "admin") {
          router.replace("/(auth)/welcome");
          return;
        }
        load();
      }
    }, [authLoading, user, load]),
  );

  // Display KES summary by default — admin sees totals reported in USD cents,
  // we convert to KES for display since the platform is anchored in Kenya.
  const displayCurrency = user?.preferred_currency ?? "KES";

  if (loading || !data) {
    return (
      <AdminShell title="Dashboard" subtitle="Loading platform analytics…">
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AdminShell>
    );
  }

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  return (
    <AdminShell
      title="Dashboard"
      subtitle="Platform-wide metrics across all sellers and buyers."
    >
      <ScrollView
        testID="admin-dashboard-scroll"
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.grid}>
          <Tile
            testID="tile-users"
            icon="users"
            label="Members"
            value={String(data.total_users)}
            hint={`${data.buyers} buyers · ${data.sellers} sellers · ${data.admins} admins`}
          />
          <Tile
            testID="tile-suspended"
            icon="slash"
            label="Suspended"
            value={String(data.suspended)}
            hint={data.suspended > 0 ? "Tap Users to review" : "All accounts active"}
          />
          <Tile
            testID="tile-items"
            icon="package"
            label="Listings"
            value={String(data.total_items)}
            hint={`${data.pending_connect_sellers} sellers without payouts`}
          />
          <Tile
            testID="tile-orders"
            icon="shopping-bag"
            label="Orders"
            value={String(data.total_orders)}
            hint={`${data.total_paid_orders} paid`}
          />
        </View>

        <View style={styles.revenue}>
          <Text style={[tp.caption, { color: "#A3A3A3" }]}>Gross revenue (paid)</Text>
          <Text style={[tp.h1, { marginTop: 6, color: colors.primaryFg }]} testID="admin-gross-revenue">
            {formatPrice(data.total_revenue_cents, displayCurrency)}
          </Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.statLabel}>Platform fees</Text>
              <Text style={styles.statValue} testID="admin-fees">
                {formatPrice(data.total_platform_fee_cents, displayCurrency)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statLabel}>Net to sellers</Text>
              <Text style={styles.statValue} testID="admin-net">
                {formatPrice(data.total_net_to_sellers_cents, displayCurrency)}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          testID="admin-feedback-link"
          onPress={() => router.push("/admin/feedback")}
          activeOpacity={0.85}
          style={styles.feedbackLink}
        >
          <Feather name="message-square" size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={tp.caption}>Tester voices</Text>
            <Text style={[tp.h3, { marginTop: 2 }]}>User feedback</Text>
            <Text style={[tp.bodyMuted, { marginTop: 2 }]}>
              Read what testers are reporting during closed testing
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.mutedFg} />
        </TouchableOpacity>

        <View style={styles.section}>
          <Text style={[tp.caption, { marginBottom: spacing.md }]}>Top sellers</Text>
          {data.top_sellers.length === 0 ? (
            <Text style={tp.bodyMuted}>No paid orders yet.</Text>
          ) : (
            data.top_sellers.map((s, idx) => (
              <View key={s.seller_id} style={styles.sellerRow} testID={`top-seller-${idx}`}>
                <Text style={styles.rank}>{idx + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sellerName} numberOfLines={1}>{s.name}</Text>
                  <Text style={tp.bodyMuted}>{s.orders} order{s.orders === 1 ? "" : "s"}</Text>
                </View>
                <Text style={styles.sellerRev}>
                  {formatPrice(s.revenue_cents, displayCurrency)}
                </Text>
              </View>
            ))
          )}
        </View>
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </AdminShell>
  );
}

interface TileProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  hint?: string;
  testID?: string;
}

function Tile({ icon, label, value, hint, testID }: TileProps) {
  return (
    <View style={styles.tile} testID={testID}>
      <View style={styles.tileTop}>
        <Text style={tp.caption}>{label}</Text>
        <Feather name={icon} size={16} color={colors.primary} />
      </View>
      <Text style={styles.tileValue}>{value}</Text>
      {hint ? <Text style={styles.tileHint} numberOfLines={2}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 110,
  },
  tileTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tileValue: { fontFamily: fonts.heading, fontSize: 32, color: colors.primary, marginTop: 8 },
  tileHint: { fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg, marginTop: 4 },
  revenue: {
    padding: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
  },
  row: { flexDirection: "row", marginTop: spacing.md, gap: spacing.md },
  statLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "#A3A3A3",
  },
  statValue: { fontFamily: fonts.bodySemi, fontSize: 18, color: colors.primaryFg, marginTop: 4 },
  section: { marginTop: spacing.xl },
  feedbackLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sellerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rank: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: colors.primary,
    width: 28,
  },
  sellerName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.primary },
  sellerRev: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
});

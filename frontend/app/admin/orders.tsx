// Admin → All orders across the platform.

import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { AdminShell } from "@/src/components/AdminShell";
import { useToast } from "@/src/components/Toast";
import { api, Order } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPrice } from "@/src/lib/currency";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const FILTERS: { key: "all" | "paid" | "pending" | "failed" | "cancelled"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "pending", label: "Pending" },
  { key: "failed", label: "Failed" },
  { key: "cancelled", label: "Cancelled" },
];

export default function AdminOrders() {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<typeof FILTERS[number]["key"]>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.adminListOrders({
        status: filter === "all" ? undefined : filter,
      });
      setOrders(list);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load orders", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, toast]);

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

  return (
    <AdminShell title="Orders" subtitle="Every order placed through Oromona, across all sellers.">
      <View style={styles.controls}>
        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                testID={`admin-orders-filter-${f.key}`}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          testID="admin-orders-list"
          data={orders}
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
          ListEmptyComponent={
            <Text style={[tp.bodyMuted, { textAlign: "center", marginTop: spacing.xl }]}>
              No orders match.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.orderRow} testID={`admin-order-${item.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderName} numberOfLines={1}>{item.item_name}</Text>
                <Text style={tp.bodyMuted}>
                  Size {item.size}
                  {item.color ? ` · ${item.color}` : ""}
                </Text>
                <Text style={[tp.bodyMuted, { marginTop: 2 }]}>
                  {new Date(item.created_at).toLocaleString()}
                </Text>
              </View>
              <View style={styles.orderRight}>
                <Text style={styles.orderAmount}>
                  {formatPrice(item.amount_cents, item.currency)}
                </Text>
                <View
                  style={[
                    styles.statusPill,
                    item.status === "paid" && styles.statusPaid,
                    item.status === "pending" && styles.statusPending,
                    item.status === "failed" && styles.statusFailed,
                    item.status === "cancelled" && styles.statusCancelled,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      (item.status === "paid" || item.status === "failed" ||
                        item.status === "cancelled") && styles.statusTextLight,
                    ]}
                  >
                    {item.status.toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  filterRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 12,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.primary,
  },
  chipLabelActive: { color: colors.primaryFg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  orderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  orderName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.primary },
  orderRight: { alignItems: "flex-end", gap: 6 },
  orderAmount: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.muted,
  },
  statusPaid: { backgroundColor: colors.success },
  statusPending: { backgroundColor: "#FFD60A" },
  statusFailed: { backgroundColor: colors.error },
  statusCancelled: { backgroundColor: colors.mutedFg },
  statusText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primary,
  },
  statusTextLight: { color: colors.primaryFg },
});

// Courier earnings — today's total, pending balance (paid end-of-day by
// Oromona to the rider's M-Pesa), lifetime paid, and the ledger.

import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { api, CourierEarningRow } from "@/src/lib/api";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const fmtKsh = (cents: number) => `KSh ${Math.round(cents / 100).toLocaleString()}`;

export default function CourierEarnings() {
  const toast = useToast();
  const [today, setToday] = useState(0);
  const [pending, setPending] = useState(0);
  const [paid, setPaid] = useState(0);
  const [rows, setRows] = useState<CourierEarningRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.courierEarnings();
      setToday(r.today_cents);
      setPending(r.pending_cents);
      setPaid(r.paid_cents);
      setRows(r.rows);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load earnings", "error");
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
        <Text style={tp.caption}>RIDER PORTAL · EARNINGS</Text>
        <Text style={[tp.h2, { marginTop: 4 }]}>Your earnings</Text>

        <View style={styles.statRow}>
          <View style={styles.statCard} testID="courier-earnings-today">
            <Text style={styles.statLabel}>TODAY</Text>
            <Text style={styles.statValue}>{fmtKsh(today)}</Text>
          </View>
          <View style={styles.statCard} testID="courier-earnings-pending">
            <Text style={styles.statLabel}>PENDING</Text>
            <Text style={styles.statValue}>{fmtKsh(pending)}</Text>
          </View>
          <View style={styles.statCard} testID="courier-earnings-paid">
            <Text style={styles.statLabel}>PAID OUT</Text>
            <Text style={styles.statValue}>{fmtKsh(paid)}</Text>
          </View>
        </View>
        <Text style={[tp.bodyMuted, { marginTop: spacing.sm, fontSize: 12 }]}>
          Pending earnings are paid to your M-Pesa at the end of each day.
        </Text>

        <Text style={styles.sectionTitle}>DELIVERY LEDGER</Text>
        {rows.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="dollar-sign" size={26} color={colors.mutedFg} />
            <Text style={[tp.bodyMuted, { marginTop: 6, textAlign: "center" }]}>
              Complete your first delivery to start earning.
            </Text>
          </View>
        ) : (
          rows.map((r) => (
            <View key={r.id} style={styles.row} testID={`courier-earning-${r.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowItem} numberOfLines={1}>
                  {r.item_name ?? "Delivery"}
                </Text>
                <Text style={styles.rowDate}>
                  {new Date(r.created_at).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  ·{" "}
                  {new Date(r.created_at).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.rowAmount}>{fmtKsh(r.amount_cents)}</Text>
                <Text style={[styles.rowStatus, r.status === "paid" && { color: colors.success }]}>
                  {r.status.toUpperCase()}
                </Text>
              </View>
            </View>
          ))
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  statCard: {
    flex: 1,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  statLabel: { fontFamily: fonts.bodySemi, fontSize: 10, letterSpacing: 1.2, color: colors.mutedFg },
  statValue: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.primary, marginTop: 4 },
  sectionTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.mutedFg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  empty: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowItem: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.primary },
  rowDate: { fontFamily: fonts.body, fontSize: 11, color: colors.mutedFg, marginTop: 2 },
  rowAmount: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  rowStatus: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.mutedFg,
    marginTop: 2,
  },
});

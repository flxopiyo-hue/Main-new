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
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { api, CourierEarningRow, CourierPayoutBatch } from "@/src/lib/api";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const fmtKsh = (cents: number) => `KSh ${Math.round(cents / 100).toLocaleString()}`;

const BATCH_COLOR: Record<string, string> = {
  settled: colors.success,
  sent: "#B45309",
  processing: "#B45309",
  failed: colors.error,
};

export default function CourierEarnings() {
  const toast = useToast();
  const [today, setToday] = useState(0);
  const [pending, setPending] = useState(0);
  const [paid, setPaid] = useState(0);
  const [rows, setRows] = useState<CourierEarningRow[]>([]);
  const [batches, setBatches] = useState<CourierPayoutBatch[]>([]);
  const [mpesa, setMpesa] = useState<string | null>(null);
  const [hasRecipient, setHasRecipient] = useState(false);
  const [editingPayout, setEditingPayout] = useState(false);
  const [draft, setDraft] = useState("");
  const [savingPayout, setSavingPayout] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.courierEarnings();
      setToday(r.today_cents);
      setPending(r.pending_cents);
      setPaid(r.paid_cents);
      setRows(r.rows);
      setBatches(r.batches ?? []);
      setMpesa(r.mpesa_number ?? null);
      setHasRecipient(!!r.has_recipient);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load earnings", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  const savePayout = async () => {
    if (!draft.trim()) return;
    setSavingPayout(true);
    try {
      const res = await api.courierSetPayoutAccount(draft.trim());
      setMpesa(res.mpesa_number);
      setHasRecipient(res.has_recipient);
      setEditingPayout(false);
      toast.show("M-Pesa payout number saved", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to save payout number", "error");
    } finally {
      setSavingPayout(false);
    }
  };

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

        <Text style={styles.sectionTitle}>M-PESA PAYOUT ACCOUNT</Text>
        <View style={styles.payoutCard} testID="courier-payout-card">
          {editingPayout || !hasRecipient ? (
            <>
              <Text style={[tp.bodyMuted, { fontSize: 12 }]}>
                {hasRecipient
                  ? "Update the M-Pesa number we pay you on."
                  : "Add your M-Pesa number so Oromona can send your earnings automatically."}
              </Text>
              <TextInput
                testID="courier-mpesa-input"
                value={draft}
                onChangeText={setDraft}
                placeholder="07XX XXX XXX"
                placeholderTextColor={colors.mutedFg}
                keyboardType="phone-pad"
                style={styles.mpesaInput}
              />
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <TouchableOpacity
                  testID="courier-mpesa-save"
                  onPress={savePayout}
                  disabled={savingPayout}
                  style={styles.saveBtn}
                >
                  {savingPayout ? (
                    <ActivityIndicator size="small" color={colors.primaryFg} />
                  ) : (
                    <Text style={styles.saveBtnLabel}>SAVE NUMBER</Text>
                  )}
                </TouchableOpacity>
                {hasRecipient ? (
                  <TouchableOpacity
                    onPress={() => setEditingPayout(false)}
                    style={styles.ghostBtn}
                  >
                    <Text style={styles.ghostBtnLabel}>CANCEL</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          ) : (
            <View style={styles.payoutRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.payoutNumber}>{mpesa}</Text>
                <Text style={[tp.bodyMuted, { fontSize: 11, marginTop: 2 }]}>
                  Automatic M-Pesa payouts active
                </Text>
              </View>
              <TouchableOpacity
                testID="courier-mpesa-edit"
                onPress={() => {
                  setDraft(mpesa ?? "");
                  setEditingPayout(true);
                }}
                style={styles.ghostBtn}
              >
                <Text style={styles.ghostBtnLabel}>EDIT</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {batches.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>PAYOUT HISTORY</Text>
            {batches.map((b) => (
              <View key={b.id} style={styles.row} testID={`courier-batch-${b.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowItem}>
                    {fmtKsh(b.total_cents)} · {b.deliveries}{" "}
                    {b.deliveries === 1 ? "delivery" : "deliveries"}
                  </Text>
                  <Text style={styles.rowDate}>
                    {new Date(b.created_at).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    · {b.method === "mpesa" ? "M-Pesa" : "paid manually"}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.rowStatus,
                    { color: BATCH_COLOR[b.status ?? "settled"] ?? colors.mutedFg },
                  ]}
                >
                  {(b.status ?? "settled").toUpperCase()}
                </Text>
              </View>
            ))}
          </>
        ) : null}

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
  payoutCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  payoutRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  payoutNumber: {
    fontFamily: fonts.bodySemi,
    fontSize: 15,
    color: colors.primary,
    letterSpacing: 0.5,
  },
  mpesaInput: {
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    paddingVertical: 8,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.primary,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primaryFg,
  },
  ghostBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostBtnLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primary,
  },
});

// Admin → Rider (courier) management: approve/reject applications and
// record end-of-day M-Pesa payouts of pending earnings.

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
import { AdminCourierRow, api, CourierPayoutBatch } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { confirmDialog } from "@/src/lib/confirm";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const fmtKsh = (cents: number) => `KSh ${Math.round(cents / 100).toLocaleString()}`;

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "#FFE8A3", fg: "#7A5B00" },
  approved: { bg: colors.success, fg: colors.primaryFg },
  rejected: { bg: "#F5A3A3", fg: "#7A0000" },
};

export default function AdminCouriers() {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [riders, setRiders] = useState<AdminCourierRow[]>([]);
  const [batches, setBatches] = useState<CourierPayoutBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, history] = await Promise.all([
        api.adminCouriers(),
        api.adminCourierPayouts(),
      ]);
      setRiders(list);
      setBatches(history);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load riders", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useFocusEffect(
    useCallback(() => {
      if (!authLoading) {
        if (!user || user.role !== "admin") {
          router.replace("/welcome");
          return;
        }
        load();
      }
    }, [authLoading, user, load]),
  );

  const act = async (rider: AdminCourierRow, action: "approve" | "reject") => {
    setBusyId(rider.id);
    try {
      if (action === "approve") await api.adminCourierApprove(rider.id);
      else await api.adminCourierReject(rider.id);
      toast.show(`${rider.full_name} ${action}d`, "success");
      await load();
    } catch (e: any) {
      toast.show(e?.message ?? "Failed", "error");
    } finally {
      setBusyId(null);
    }
  };

  const markPaid = (rider: AdminCourierRow) => {
    confirmDialog({
      title: "Record manual payout?",
      message: `Confirm you've sent ${fmtKsh(rider.pending_cents)} to ${rider.full_name}'s M-Pesa (${rider.mpesa_number || rider.phone || "no number"}) yourself. This marks ${rider.pending_count} deliveries as paid.`,
      confirmLabel: "Mark paid",
      onConfirm: async () => {
        setBusyId(rider.id);
        try {
          const res = await api.adminCourierMarkPaid(rider.id);
          toast.show(`Recorded ${fmtKsh(res.total_cents)} payout`, "success");
          await load();
        } catch (e: any) {
          toast.show(e?.message ?? "Failed", "error");
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  const payMpesa = (rider: AdminCourierRow) => {
    confirmDialog({
      title: "Send M-Pesa payout?",
      message: `Send ${fmtKsh(rider.pending_cents)} to ${rider.full_name}'s M-Pesa (${rider.mpesa_number ?? "—"}) now via Paystack? Covers ${rider.pending_count} ${rider.pending_count === 1 ? "delivery" : "deliveries"}.`,
      confirmLabel: "Send payout",
      onConfirm: async () => {
        setBusyId(rider.id);
        try {
          const res = await api.adminCourierPayout(rider.id);
          toast.show(
            `Transfer ${res.paystack_status}: ${fmtKsh(res.total_cents)} → ${rider.full_name}`,
            "success",
          );
          await load();
        } catch (e: any) {
          toast.show(e?.message ?? "Transfer failed", "error");
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  const verifyBatch = async (batchId: string) => {
    setBusyId(batchId);
    try {
      const res = await api.adminCourierPayoutVerify(batchId);
      toast.show(
        `Paystack status: ${res.paystack_status || "unknown"}`,
        res.status === "failed" ? "error" : "success",
      );
      await load();
    } catch (e: any) {
      toast.show(e?.message ?? "Verify failed", "error");
    } finally {
      setBusyId(null);
    }
  };

  const pendingApps = riders.filter((r) => r.courier_status === "pending").length;

  return (
    <AdminShell title="Riders" subtitle={`${riders.length} riders · ${pendingApps} awaiting approval`}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
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
          {riders.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="truck" size={28} color={colors.mutedFg} />
              <Text style={[tp.bodyMuted, { marginTop: 6, textAlign: "center" }]}>
                No rider applications yet. Riders sign up from the Create
                Account screen.
              </Text>
            </View>
          ) : (
            riders.map((r) => {
              const sty = STATUS_STYLE[r.courier_status] ?? STATUS_STYLE.pending;
              const busy = busyId === r.id;
              return (
                <View key={r.id} style={styles.card} testID={`admin-courier-${r.id}`}>
                  <View style={styles.cardHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{r.full_name}</Text>
                      <Text style={styles.meta}>{r.email}</Text>
                      <Text style={styles.meta}>
                        {r.phone ?? "no phone"} · M-Pesa {r.mpesa_number || r.phone || "—"}
                      </Text>
                      {!r.has_recipient ? (
                        <Text style={[styles.meta, { color: "#B45309" }]}>
                          No M-Pesa payout account yet
                        </Text>
                      ) : null}
                    </View>
                    <View style={[styles.badge, { backgroundColor: sty.bg }]}>
                      <Text style={[styles.badgeLabel, { color: sty.fg }]}>
                        {r.courier_status.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.actions}>
                    {r.courier_status === "pending" ? (
                      <>
                        <TouchableOpacity
                          testID={`admin-courier-approve-${r.id}`}
                          onPress={() => act(r, "approve")}
                          disabled={busy}
                          style={[styles.btn, styles.btnPrimary]}
                        >
                          {busy ? (
                            <ActivityIndicator size="small" color={colors.primaryFg} />
                          ) : (
                            <Text style={styles.btnPrimaryLabel}>APPROVE</Text>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          testID={`admin-courier-reject-${r.id}`}
                          onPress={() => act(r, "reject")}
                          disabled={busy}
                          style={[styles.btn, styles.btnGhost]}
                        >
                          <Text style={styles.btnGhostLabel}>REJECT</Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                    {r.courier_status === "rejected" ? (
                      <TouchableOpacity
                        testID={`admin-courier-reapprove-${r.id}`}
                        onPress={() => act(r, "approve")}
                        disabled={busy}
                        style={[styles.btn, styles.btnGhost]}
                      >
                        <Text style={styles.btnGhostLabel}>APPROVE ANYWAY</Text>
                      </TouchableOpacity>
                    ) : null}
                    {r.pending_cents > 0 ? (
                      <>
                        {r.has_recipient ? (
                          <TouchableOpacity
                            testID={`admin-courier-pay-${r.id}`}
                            onPress={() => payMpesa(r)}
                            disabled={busy}
                            style={[styles.btn, styles.btnPay]}
                          >
                            <Feather name="smartphone" size={12} color={colors.primaryFg} />
                            <Text style={styles.btnPrimaryLabel}>
                              M-PESA {fmtKsh(r.pending_cents)}
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                          testID={`admin-courier-markpaid-${r.id}`}
                          onPress={() => markPaid(r)}
                          disabled={busy}
                          style={[styles.btn, styles.btnGhost]}
                        >
                          <Text style={styles.btnGhostLabel}>MARK PAID MANUALLY</Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}

          <Text style={styles.sectionTitle}>PAYOUT HISTORY</Text>
          {batches.length === 0 ? (
            <Text style={tp.bodyMuted}>No payouts recorded yet.</Text>
          ) : (
            batches.map((b) => {
              const busy = busyId === b.id;
              const color =
                b.status === "settled"
                  ? colors.success
                  : b.status === "failed"
                    ? colors.error
                    : "#B45309";
              return (
                <View key={b.id} style={styles.batchRow} testID={`admin-batch-${b.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.batchName}>
                      {b.courier_name ?? "Rider"} · {fmtKsh(b.total_cents)}
                    </Text>
                    <Text style={styles.meta}>
                      {new Date(b.created_at).toLocaleDateString()} · {b.deliveries}{" "}
                      {b.deliveries === 1 ? "delivery" : "deliveries"} ·{" "}
                      {b.method === "mpesa"
                        ? `M-Pesa${b.mpesa_number ? ` ${b.mpesa_number}` : ""}`
                        : "manual"}
                    </Text>
                    {b.failure_reason ? (
                      <Text style={[styles.meta, { color: colors.error }]} numberOfLines={2}>
                        {b.failure_reason}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 6 }}>
                    <Text style={[styles.batchStatus, { color }]}>
                      {(b.status ?? "settled").toUpperCase()}
                    </Text>
                    {b.method === "mpesa" &&
                    (b.status === "sent" || b.status === "processing") ? (
                      <TouchableOpacity
                        testID={`admin-batch-verify-${b.id}`}
                        onPress={() => verifyBatch(b.id)}
                        disabled={busy}
                        style={[styles.btn, styles.btnGhost, { paddingVertical: 6 }]}
                      >
                        {busy ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <Text style={styles.btnGhostLabel}>VERIFY</Text>
                        )}
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: spacing.xxl, alignItems: "center" },
  scroll: { paddingBottom: spacing.xl },
  empty: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHead: { flexDirection: "row", gap: spacing.md },
  name: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" },
  badgeLabel: { fontFamily: fonts.bodySemi, fontSize: 9, letterSpacing: 1.2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  sectionTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.mutedFg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  batchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  batchName: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary },
  batchStatus: { fontFamily: fonts.bodySemi, fontSize: 9, letterSpacing: 1.2 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPay: { backgroundColor: colors.success },
  btnGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  btnPrimaryLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primaryFg,
  },
  btnGhostLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primary,
  },
});

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
import { AdminCourierRow, api } from "@/src/lib/api";
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.adminCouriers();
      setRiders(list);
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
      title: "Record payout?",
      message: `Confirm you've sent ${fmtKsh(rider.pending_cents)} to ${rider.full_name}'s M-Pesa (${rider.mpesa_number || rider.phone || "no number"}). This marks ${rider.pending_count} deliveries as paid.`,
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
                      <TouchableOpacity
                        testID={`admin-courier-pay-${r.id}`}
                        onPress={() => markPaid(r)}
                        disabled={busy}
                        style={[styles.btn, styles.btnPay]}
                      >
                        <Feather name="dollar-sign" size={12} color={colors.primaryFg} />
                        <Text style={styles.btnPrimaryLabel}>
                          PAY {fmtKsh(r.pending_cents)}
                        </Text>
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

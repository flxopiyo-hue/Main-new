// Courier job board — available jobs to accept + the rider's active
// deliveries. Pending riders see an approval-wait card instead.

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
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { api, CourierJob } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const fmtKsh = (cents: number) => `KSh ${Math.round(cents / 100).toLocaleString()}`;

const STATUS_LABEL: Record<string, string> = {
  accepted: "Head to pickup",
  picked_up: "Parcel with you",
  out_for_delivery: "Out for delivery",
};

export default function CourierJobs() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | null>(null);
  const [open, setOpen] = useState<CourierJob[]>([]);
  const [mine, setMine] = useState<CourierJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const me = await api.courierMe();
      setStatus(me.courier_status);
      if (me.courier_status === "approved") {
        const jobs = await api.courierJobs();
        setOpen(jobs.open);
        setMine(jobs.mine);
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load jobs", "error");
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

  const accept = async (job: CourierJob) => {
    setAcceptingId(job.id);
    try {
      await api.courierAccept(job.id);
      toast.show("Job is yours — head to pickup", "success");
      router.push(`/(courier)/job/${job.id}`);
      await load();
    } catch (e: any) {
      toast.show(e?.message ?? "Could not accept job", "error");
      await load();
    } finally {
      setAcceptingId(null);
    }
  };

  const doLogout = async () => {
    await logout();
    router.replace("/welcome");
  };

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
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={tp.caption}>RIDER PORTAL · JOBS</Text>
            <Text style={[tp.h2, { marginTop: 4 }]} testID="courier-greeting">
              {user?.full_name?.split(" ")[0] ?? "Rider"}
            </Text>
          </View>
          <TouchableOpacity testID="courier-logout-btn" onPress={doLogout} style={styles.logoutBtn}>
            <Feather name="log-out" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {status !== "approved" ? (
          <View style={styles.pendingCard} testID="courier-pending-card">
            <Feather
              name={status === "rejected" ? "x-circle" : "clock"}
              size={28}
              color={colors.primary}
            />
            <Text style={[tp.h3, { marginTop: spacing.sm }]}>
              {status === "rejected" ? "Application declined" : "Approval pending"}
            </Text>
            <Text style={[tp.bodyMuted, { textAlign: "center", marginTop: 6 }]}>
              {status === "rejected"
                ? "Your rider application was not approved. Contact Oromona support if you think this is a mistake."
                : "Our team is reviewing your rider account. Once approved you may need to sign in again — then delivery jobs will appear here."}
            </Text>
          </View>
        ) : (
          <>
            {/* Active deliveries */}
            <Text style={styles.sectionTitle}>YOUR ACTIVE DELIVERIES · {mine.length}</Text>
            {mine.length === 0 ? (
              <Text style={[tp.bodyMuted, styles.emptyLine]}>
                No active deliveries — accept a job below.
              </Text>
            ) : (
              mine.map((j) => (
                <TouchableOpacity
                  key={j.id}
                  testID={`courier-my-job-${j.id}`}
                  onPress={() => router.push(`/(courier)/job/${j.id}`)}
                  style={styles.jobCard}
                  activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.jobItem} numberOfLines={1}>
                      {j.item_name ?? "Parcel"}
                    </Text>
                    <Text style={styles.jobRoute} numberOfLines={1}>
                      {j.pickup_area} → {j.dropoff_area}
                    </Text>
                    <Text style={styles.jobStatus}>{STATUS_LABEL[j.status] ?? j.status}</Text>
                  </View>
                  <View style={styles.jobRight}>
                    <Text style={styles.jobFee}>{fmtKsh(j.rider_cut_cents ?? 0)}</Text>
                    <Feather name="chevron-right" size={18} color={colors.mutedFg} />
                  </View>
                </TouchableOpacity>
              ))
            )}

            {/* Open board */}
            <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>
              AVAILABLE JOBS · {open.length}
            </Text>
            {open.length === 0 ? (
              <View style={styles.emptyBoard}>
                <Feather name="package" size={28} color={colors.mutedFg} />
                <Text style={[tp.bodyMuted, { textAlign: "center", marginTop: 6 }]}>
                  No open jobs right now — pull down to refresh.
                </Text>
              </View>
            ) : (
              open.map((j) => (
                <View key={j.id} style={styles.jobCard} testID={`courier-open-job-${j.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.jobItem} numberOfLines={1}>
                      {j.item_name ?? "Parcel"}
                    </Text>
                    <Text style={styles.jobRoute} numberOfLines={1}>
                      {j.pickup_area} → {j.dropoff_area}
                    </Text>
                    <Text style={styles.jobZone}>{j.zone_label}</Text>
                  </View>
                  <View style={styles.jobRight}>
                    <Text style={styles.jobFee}>{fmtKsh(j.rider_cut_cents ?? 0)}</Text>
                    <TouchableOpacity
                      testID={`courier-accept-${j.id}`}
                      onPress={() => accept(j)}
                      disabled={acceptingId !== null}
                      style={[styles.acceptBtn, acceptingId !== null && { opacity: 0.6 }]}
                    >
                      {acceptingId === j.id ? (
                        <ActivityIndicator size="small" color={colors.primaryFg} />
                      ) : (
                        <Text style={styles.acceptLabel}>ACCEPT</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </>
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
  header: { flexDirection: "row", alignItems: "center", marginBottom: spacing.lg },
  logoutBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pendingCard: {
    alignItems: "center",
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.mutedFg,
    marginBottom: spacing.sm,
  },
  emptyLine: { marginBottom: spacing.sm },
  emptyBoard: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  jobCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  jobItem: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  jobRoute: { fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg, marginTop: 2 },
  jobZone: { fontFamily: fonts.body, fontSize: 11, color: colors.mutedFg, marginTop: 2 },
  jobStatus: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.primary,
    marginTop: 4,
    textTransform: "uppercase",
  },
  jobRight: { alignItems: "flex-end", gap: 6 },
  jobFee: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.primary },
  acceptBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.primaryFg,
  },
});

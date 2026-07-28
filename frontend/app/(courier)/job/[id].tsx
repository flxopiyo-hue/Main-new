// Courier job detail — pickup/dropoff info, buyer call button, and the
// delivery lifecycle actions ending with the buyer's 4-digit handover code.

import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { api, CourierJob } from "@/src/lib/api";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const fmtKsh = (cents: number) => `KSh ${Math.round(cents / 100).toLocaleString()}`;

export default function CourierJobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const [job, setJob] = useState<CourierJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");

  const load = useCallback(async () => {
    try {
      const j = await api.courierJobDetail(String(id));
      setJob(j);
    } catch (e: any) {
      toast.show(e?.message ?? "Job not found", "error");
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const advance = async (action: "picked_up" | "out_for_delivery") => {
    if (!job) return;
    setBusy(true);
    try {
      const j = await api.courierJobStatus(job.id, action);
      setJob(j);
      toast.show(
        action === "picked_up" ? "Parcel picked up" : "Buyer notified — out for delivery",
        "success",
      );
    } catch (e: any) {
      toast.show(e?.message ?? "Could not update", "error");
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!job) return;
    if (code.trim().length !== 4) {
      toast.show("Enter the buyer's 4-digit code", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await api.courierDeliver(job.id, code.trim());
      toast.show(
        `Delivered! ${res.earned_cents ? fmtKsh(res.earned_cents) + " added to your earnings" : ""}`,
        "success",
      );
      router.replace("/(courier)/earnings");
    } catch (e: any) {
      toast.show(e?.message ?? "Wrong code", "error");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !job) {
    return (
      <SafeAreaView style={[styles.root, styles.center]} edges={["top"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const addr = job.dropoff_address;
  const addrLine = addr
    ? [
        [addr.building_estate, addr.house_number].filter(Boolean).join(" · "),
        [addr.street, addr.area].filter(Boolean).join(", "),
        addr.city,
      ]
        .filter(Boolean)
        .join(" — ")
    : job.dropoff_area;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity testID="courier-job-back" onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color={colors.primary} />
          </TouchableOpacity>
          <Text style={tp.caption}>DELIVERY JOB</Text>
          <View style={styles.backBtn} />
        </View>

        <Text style={[tp.h2, { marginTop: spacing.sm }]} testID="courier-job-item">
          {job.item_name ?? "Parcel"}
        </Text>
        <Text style={styles.fee}>You earn {fmtKsh(job.rider_cut_cents ?? 0)} · {job.zone_label}</Text>

        {/* Route */}
        <View style={styles.routeCard}>
          <View style={styles.routeRow}>
            <Feather name="arrow-up-circle" size={16} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLabel}>PICKUP</Text>
              <Text style={styles.routeValue}>{job.pickup_area}</Text>
            </View>
          </View>
          <View style={styles.routeDivider} />
          <View style={styles.routeRow}>
            <Feather name="map-pin" size={16} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLabel}>DROPOFF</Text>
              <Text style={styles.routeValue} testID="courier-job-dropoff">
                {addrLine}
              </Text>
              {addr?.delivery_notes ? (
                <Text style={styles.routeNotes}>{`"${addr.delivery_notes}"`}</Text>
              ) : null}
            </View>
          </View>
          {addr?.recipient_name ? (
            <View style={styles.buyerRow}>
              <Text style={styles.buyerName}>
                {addr.recipient_name}
              </Text>
              {addr.phone ? (
                <TouchableOpacity
                  testID="courier-call-buyer-btn"
                  onPress={() => Linking.openURL(`tel:${addr.phone}`)}
                  style={styles.callBtn}
                >
                  <Feather name="phone" size={12} color={colors.primaryFg} />
                  <Text style={styles.callLabel}>CALL BUYER</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Lifecycle actions */}
        {job.status === "accepted" ? (
          <TouchableOpacity
            testID="courier-picked-up-btn"
            onPress={() => advance("picked_up")}
            disabled={busy}
            style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryFg} />
            ) : (
              <Text style={styles.primaryLabel}>I&apos;VE PICKED UP THE PARCEL</Text>
            )}
          </TouchableOpacity>
        ) : null}

        {job.status === "picked_up" ? (
          <TouchableOpacity
            testID="courier-out-for-delivery-btn"
            onPress={() => advance("out_for_delivery")}
            disabled={busy}
            style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryFg} />
            ) : (
              <Text style={styles.primaryLabel}>OUT FOR DELIVERY — NOTIFY BUYER</Text>
            )}
          </TouchableOpacity>
        ) : null}

        {job.status === "picked_up" || job.status === "out_for_delivery" ? (
          <View style={styles.codeCard}>
            <Text style={styles.codeCaption}>COMPLETE DELIVERY</Text>
            <Text style={[tp.bodyMuted, { marginTop: 4 }]}>
              Ask the buyer for the 4-digit handover code on their order screen.
            </Text>
            <TextInput
              testID="courier-code-input"
              value={code}
              onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="0000"
              placeholderTextColor={colors.mutedFg}
              style={styles.codeInput}
            />
            <TouchableOpacity
              testID="courier-deliver-btn"
              onPress={complete}
              disabled={busy || code.length !== 4}
              style={[styles.primaryBtn, (busy || code.length !== 4) && { opacity: 0.6 }]}
            >
              {busy ? (
                <ActivityIndicator color={colors.primaryFg} />
              ) : (
                <Text style={styles.primaryLabel}>CONFIRM HANDOVER</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        {job.status === "delivered" ? (
          <View style={styles.doneCard} testID="courier-job-done">
            <Feather name="check-circle" size={22} color={colors.success} />
            <Text style={[tp.h3, { marginTop: 6 }]}>Delivered</Text>
            <Text style={tp.bodyMuted}>
              {fmtKsh(job.rider_cut_cents ?? 0)} added to your earnings.
            </Text>
          </View>
        ) : null}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { width: 36, height: 36, alignItems: "flex-start", justifyContent: "center" },
  fee: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.mutedFg, marginTop: 4 },
  routeCard: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  routeRow: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  routeDivider: {
    width: 1,
    height: 18,
    backgroundColor: colors.border,
    marginLeft: 7,
    marginVertical: 4,
  },
  routeLabel: { fontFamily: fonts.bodySemi, fontSize: 10, letterSpacing: 1.5, color: colors.mutedFg },
  routeValue: { fontFamily: fonts.body, fontSize: 14, color: colors.primary, marginTop: 2 },
  routeNotes: { fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg, marginTop: 4, fontStyle: "italic" },
  buyerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  buyerName: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.primary,
  },
  callLabel: { fontFamily: fonts.bodySemi, fontSize: 10, letterSpacing: 1.2, color: colors.primaryFg },
  primaryBtn: {
    marginTop: spacing.lg,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  primaryLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.primaryFg,
  },
  codeCard: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  codeCaption: { fontFamily: fonts.bodySemi, fontSize: 11, letterSpacing: 1.5, color: colors.mutedFg },
  codeInput: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingVertical: 12,
    textAlign: "center",
    fontFamily: fonts.bodySemi,
    fontSize: 24,
    letterSpacing: 12,
    color: colors.primary,
  },
  doneCard: {
    marginTop: spacing.lg,
    alignItems: "center",
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});

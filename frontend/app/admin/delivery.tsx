// Admin → Delivery fees: edit zone rates (anchored on CBD→Karen ≈ KSh 600)
// and the free-delivery threshold, without code changes.

import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { AdminShell } from "@/src/components/AdminShell";
import { useToast } from "@/src/components/Toast";
import { api, DeliveryZone } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function AdminDelivery() {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [fees, setFees] = useState<Record<string, string>>({});
  const [threshold, setThreshold] = useState("");
  const [platformPct, setPlatformPct] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [z, s] = await Promise.all([api.adminDeliveryZones(), api.adminDeliverySettings()]);
      setZones(z);
      setFees(Object.fromEntries(z.map((x) => [x.key, String(Math.round(x.fee_cents / 100))])));
      setThreshold(String(Math.round(s.free_delivery_threshold_cents / 100)));
      setPlatformPct(String(s.courier_platform_bps / 100));
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load delivery settings", "error");
    } finally {
      setLoading(false);
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

  const saveZone = async (zone: DeliveryZone) => {
    const ksh = parseInt(fees[zone.key] || "0", 10);
    if (Number.isNaN(ksh) || ksh < 0) {
      toast.show("Enter a valid fee in KSh", "error");
      return;
    }
    setSavingKey(zone.key);
    try {
      await api.adminPatchDeliveryZone(zone.key, { fee_cents: ksh * 100 });
      toast.show(`${zone.label} → KSh ${ksh.toLocaleString()}`, "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to save", "error");
    } finally {
      setSavingKey(null);
    }
  };

  const saveSettings = async () => {
    const t = parseInt(threshold || "0", 10);
    const pct = parseFloat(platformPct || "0");
    if (Number.isNaN(t) || t < 0 || Number.isNaN(pct) || pct < 0 || pct > 50) {
      toast.show("Enter a valid threshold and percentage (0–50)", "error");
      return;
    }
    setSavingKey("settings");
    try {
      await api.adminPatchDeliverySettings({
        free_delivery_threshold_cents: t * 100,
        courier_platform_bps: Math.round(pct * 100),
      });
      toast.show("Delivery settings saved", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to save", "error");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <AdminShell title="Delivery fees" subtitle="Zone rates from Nairobi CBD · rider split · free delivery">
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.sectionTitle}>ZONE RATES (WHAT THE BUYER PAYS)</Text>
          {zones.map((z) => (
            <View key={z.key} style={styles.zoneRow} testID={`admin-zone-${z.key}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.zoneLabel}>{z.label}</Text>
                <Text style={styles.zoneKey}>{z.key}</Text>
              </View>
              <View style={styles.feeWrap}>
                <Text style={styles.feePrefix}>KSh</Text>
                <TextInput
                  testID={`admin-zone-fee-${z.key}`}
                  value={fees[z.key] ?? ""}
                  onChangeText={(t) =>
                    setFees((f) => ({ ...f, [z.key]: t.replace(/[^0-9]/g, "") }))
                  }
                  keyboardType="number-pad"
                  style={styles.feeInput}
                />
              </View>
              <TouchableOpacity
                testID={`admin-zone-save-${z.key}`}
                onPress={() => saveZone(z)}
                disabled={savingKey !== null}
                style={[styles.saveBtn, savingKey !== null && { opacity: 0.6 }]}
              >
                {savingKey === z.key ? (
                  <ActivityIndicator size="small" color={colors.primaryFg} />
                ) : (
                  <Text style={styles.saveLabel}>SAVE</Text>
                )}
              </TouchableOpacity>
            </View>
          ))}

          <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>PLATFORM SETTINGS</Text>
          <View style={styles.settingCard}>
            <Text style={styles.settingLabel}>Free delivery above (KSh)</Text>
            <Text style={[tp.bodyMuted, { fontSize: 12, marginTop: 2 }]}>
              Orders at or over this amount ship free — Oromona absorbs the
              rider&apos;s cut. Set 0 to disable.
            </Text>
            <TextInput
              testID="admin-free-threshold-input"
              value={threshold}
              onChangeText={(t) => setThreshold(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              style={styles.settingInput}
            />
          </View>
          <View style={styles.settingCard}>
            <Text style={styles.settingLabel}>Oromona share of courier fee (%)</Text>
            <Text style={[tp.bodyMuted, { fontSize: 12, marginTop: 2 }]}>
              The rider earns the rest of each fee. Currently riders get{" "}
              {Math.max(0, 100 - (parseFloat(platformPct) || 0)).toFixed(0)}%.
            </Text>
            <TextInput
              testID="admin-platform-pct-input"
              value={platformPct}
              onChangeText={(t) => setPlatformPct(t.replace(/[^0-9.]/g, ""))}
              keyboardType="decimal-pad"
              style={styles.settingInput}
            />
          </View>
          <TouchableOpacity
            testID="admin-delivery-settings-save"
            onPress={saveSettings}
            disabled={savingKey !== null}
            style={[styles.bigSaveBtn, savingKey !== null && { opacity: 0.6 }]}
          >
            {savingKey === "settings" ? (
              <ActivityIndicator color={colors.primaryFg} />
            ) : (
              <Text style={styles.saveLabel}>SAVE SETTINGS</Text>
            )}
          </TouchableOpacity>
          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: spacing.xxl, alignItems: "center" },
  scroll: { paddingBottom: spacing.xl },
  sectionTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.mutedFg,
    marginBottom: spacing.sm,
  },
  zoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  zoneLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary },
  zoneKey: { fontFamily: fonts.body, fontSize: 10, color: colors.mutedFg, marginTop: 2 },
  feeWrap: { flexDirection: "row", alignItems: "center", gap: 4 },
  feePrefix: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.mutedFg },
  feeInput: {
    width: 76,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.primary,
    textAlign: "right",
  },
  saveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  saveLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primaryFg,
  },
  settingCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  settingLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary },
  settingInput: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontFamily: fonts.bodySemi,
    fontSize: 15,
    color: colors.primary,
  },
  bigSaveBtn: {
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
  },
});

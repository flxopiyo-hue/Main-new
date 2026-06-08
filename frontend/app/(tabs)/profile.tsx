import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { useToast } from "@/src/components/Toast";
import { api, Measurements, Order, Profile as ProfileT } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function Profile() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState<ProfileT | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [p, o] = await Promise.all([
        api.getProfile(),
        user?.role === "buyer" ? api.orders() : Promise.resolve<Order[]>([]),
      ]);
      setProfile(p);
      setOrders(o);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load profile", "error");
    } finally {
      setLoading(false);
    }
  }, [toast, user?.role]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleLogout = async () => {
    await logout();
    router.replace("/(auth)/welcome");
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const m: Measurements = profile?.measurements ?? {};

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={tp.caption}>{user?.role.toUpperCase()} ACCOUNT</Text>
          <Text style={[tp.h1, styles.name]}>{user?.full_name}</Text>
          <Text style={[tp.bodyMuted, { marginTop: 4 }]}>{user?.email}</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={tp.caption}>Body Profile</Text>
            <TouchableOpacity
              testID="profile-edit-body-btn"
              onPress={() => router.push("/onboarding/measurements")}
            >
              <Text style={styles.link}>Edit</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.grid}>
            <Cell label="Height" value={m.height_cm} />
            <Cell label="Chest" value={m.chest_cm} />
            <Cell label="Waist" value={m.waist_cm} />
            <Cell label="Hips" value={m.hips_cm} />
            <Cell label="Shoulders" value={m.shoulders_cm} />
            <Cell label="Inseam" value={m.inseam_cm} />
          </View>
          {profile?.preferred_size ? (
            <Text style={[tp.bodyMuted, { marginTop: spacing.md }]}>
              Preferred size: <Text style={styles.bold}>{profile.preferred_size}</Text>
            </Text>
          ) : null}
        </View>

        {user?.role === "buyer" ? (
          <View style={styles.section}>
            <Text style={[tp.caption, { marginBottom: spacing.md }]}>Orders</Text>
            {orders.length === 0 ? (
              <Text style={tp.bodyMuted}>No orders yet.</Text>
            ) : (
              orders.map((o) => (
                <View key={o.id} style={styles.orderRow} testID={`order-${o.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.orderName}>{o.item_name}</Text>
                    <Text style={[tp.bodyMuted, { marginTop: 2 }]}>
                      Size {o.size}
                      {o.color ? ` · ${o.color}` : ""}
                    </Text>
                  </View>
                  <View style={styles.orderRight}>
                    <Text style={styles.orderAmount}>${(o.amount_cents / 100).toFixed(0)}</Text>
                    <View
                      style={[
                        styles.statusPill,
                        o.status === "paid" && styles.statusPaid,
                        o.status === "pending" && styles.statusPending,
                      ]}
                    >
                      <Text style={styles.statusText}>{o.status.toUpperCase()}</Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}

        <AppButton
          testID="profile-logout-btn"
          label="Sign Out"
          variant="secondary"
          onPress={handleLogout}
          style={{ marginHorizontal: spacing.lg, marginTop: spacing.lg }}
        />
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Cell({ label, value }: { label: string; value?: number | null }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue}>{value != null ? `${value.toFixed(0)}cm` : "—"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  scroll: { paddingBottom: spacing.xxl },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  name: { marginTop: 8 },
  section: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  link: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: colors.primary },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -spacing.sm / 2 },
  cell: { width: "33.333%", paddingHorizontal: spacing.sm / 2, marginBottom: spacing.md },
  cellLabel: { fontFamily: fonts.bodyMedium, fontSize: 10, letterSpacing: 1.5, color: colors.mutedFg, textTransform: "uppercase" },
  cellValue: { fontFamily: fonts.heading, fontSize: 26, color: colors.primary, marginTop: 4 },
  bold: { fontFamily: fonts.bodySemi },
  orderRow: { flexDirection: "row", gap: spacing.md, alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  orderName: { fontFamily: fonts.heading, fontSize: 18, color: colors.primary },
  orderRight: { alignItems: "flex-end", gap: 4 },
  orderAmount: { fontFamily: fonts.bodySemi, fontSize: 14 },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.muted,
  },
  statusPaid: { backgroundColor: colors.success },
  statusPending: { backgroundColor: "#FFD60A" },
  statusText: { fontFamily: fonts.bodySemi, fontSize: 10, letterSpacing: 1, color: colors.primary },
});

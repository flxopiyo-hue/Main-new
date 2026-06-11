// Seller settings — company info, payout method, preferences, and the
// "Switch to Buyer Mode" toggle.
//
// This screen replaces the seller's Profile tab and bundles together:
//   • Company info card (name + location). Tap "Edit" to update.
//   • Payout method (delegated to /(seller)/payouts via "Manage payouts").
//   • Preferences (currency).
//   • Account actions: Switch to Buyer Mode + Sign out.

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { CURRENCIES } from "@/src/lib/currency";
import { api, CurrencyCode } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function SellerSettings() {
  const { user, logout, toggleRole, refresh } = useAuth();
  const toast = useToast();
  const [switching, setSwitching] = useState(false);
  const [savingCurrency, setSavingCurrency] = useState<CurrencyCode | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onSwitch = async () => {
    const proceed = async () => {
      setSwitching(true);
      try {
        await toggleRole({ to: "buyer" });
        toast.show("Switched to Shopping mode", "success");
        router.replace("/(tabs)");
      } catch (e: any) {
        toast.show(e?.message ?? "Could not switch", "error");
      } finally {
        setSwitching(false);
      }
    };

    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      const ok = window.confirm(
        "Switch to Buyer Mode? Your seller listings remain intact — you'll return to the shopping experience and can switch back any time.",
      );
      if (ok) await proceed();
      return;
    }
    Alert.alert(
      "Switch to Buyer Mode?",
      "Your seller listings remain intact — you'll return to the shopping experience and can switch back any time.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Switch", style: "default", onPress: proceed },
      ],
    );
  };

  const onSignOut = async () => {
    await logout();
    router.replace("/welcome");
  };

  const setCurrency = async (c: CurrencyCode) => {
    if (user?.preferred_currency === c) return;
    setSavingCurrency(c);
    try {
      await api.updatePreferences({ preferred_currency: c });
      await refresh();
      toast.show(`Currency set to ${c}`, "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not update currency", "error");
    } finally {
      setSavingCurrency(null);
    }
  };

  if (!user) {
    return (
      <SafeAreaView style={[styles.root, styles.center]} edges={["top"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        testID="seller-settings-scroll"
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.header}>
          <Text style={tp.caption}>SELLER PORTAL · SETTINGS</Text>
          <Text style={[tp.h2, { marginTop: 4 }]}>Settings</Text>
        </View>

        {/* Company card */}
        <View style={styles.card} testID="seller-settings-company">
          <View style={styles.cardHead}>
            <Text style={tp.caption}>Company</Text>
          </View>
          <Text style={styles.companyName}>{user.company_name || "—"}</Text>
          {user.location ? (
            <Text style={[tp.bodyMuted, { marginTop: 4 }]}>
              <Feather name="map-pin" size={11} color={colors.mutedFg} />{" "}
              {user.location.city}, {user.location.country}
            </Text>
          ) : null}
          <Text style={[tp.bodyMuted, { marginTop: 12 }]}>
            <Feather name="user" size={11} color={colors.mutedFg} /> {user.full_name}
          </Text>
          <Text style={[tp.bodyMuted, { marginTop: 4 }]}>
            <Feather name="mail" size={11} color={colors.mutedFg} /> {user.email}
          </Text>
        </View>

        {/* Payouts shortcut */}
        <Pressable
          testID="seller-settings-payouts"
          onPress={() => router.push("/(seller)/payouts")}
          style={({ pressed }) => [styles.linkCard, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.linkIcon}>
            <Feather name="credit-card" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.linkTitle}>Payouts</Text>
            <Text style={[tp.bodyMuted, { fontSize: 12 }]}>
              Stripe Connect status · 10% platform fee · payout history
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedFg} />
        </Pressable>

        {/* Currency preference */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={tp.caption}>Preferred currency</Text>
          </View>
          <Text style={[tp.bodyMuted, { marginBottom: spacing.md }]}>
            Used for dashboard totals and any item without an explicit listing
            currency.
          </Text>
          <View style={styles.currencyRow}>
            {CURRENCIES.map((c) => {
              const active = user.preferred_currency === c.code;
              const busy = savingCurrency === c.code;
              return (
                <TouchableOpacity
                  key={c.code}
                  testID={`seller-settings-currency-${c.code}`}
                  onPress={() => setCurrency(c.code)}
                  disabled={busy}
                  style={[
                    styles.currencyChip,
                    active ? styles.currencyChipActive : styles.currencyChipInactive,
                    busy && { opacity: 0.6 },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator
                      size="small"
                      color={active ? colors.primaryFg : colors.primary}
                    />
                  ) : (
                    <Text
                      style={[
                        styles.currencyLabel,
                        active
                          ? styles.currencyLabelActive
                          : styles.currencyLabelInactive,
                      ]}
                    >
                      {c.symbol} {c.code}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Role switch */}
        <View style={styles.card} testID="seller-settings-switch-card">
          <View style={styles.cardHead}>
            <Text style={tp.caption}>Account mode</Text>
          </View>
          <Text style={[tp.body, { marginBottom: spacing.md }]}>
            You're currently in <Text style={{ fontFamily: fonts.bodySemi }}>Seller</Text> mode.
            Switch to Buyer mode to browse the marketplace, do virtual try-ons,
            and shop. Your listings stay live and you can switch back any time.
          </Text>
          <TouchableOpacity
            testID="seller-settings-switch-btn"
            onPress={onSwitch}
            disabled={switching}
            style={[styles.switchBtn, switching && { opacity: 0.6 }]}
          >
            {switching ? (
              <ActivityIndicator color={colors.primaryFg} />
            ) : (
              <>
                <Feather name="shopping-bag" size={16} color={colors.primaryFg} />
                <Text style={styles.switchLabel}>Switch to Buyer Mode</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Sign out */}
        <TouchableOpacity
          testID="seller-settings-signout-btn"
          onPress={onSignOut}
          style={styles.signOut}
        >
          <Feather name="log-out" size={14} color={colors.error} />
          <Text style={styles.signOutLabel}>Sign out</Text>
        </TouchableOpacity>

        <Text style={styles.versionLabel}>
          Drape · Seller Portal · v{user.token_version ?? 0}
        </Text>
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  scroll: { paddingBottom: spacing.xxl },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  card: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardHead: { marginBottom: spacing.sm },
  companyName: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: colors.primary,
  },
  linkCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  linkTitle: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.primary },
  currencyRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  currencyChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  currencyChipInactive: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  currencyChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  currencyLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 0.6,
  },
  currencyLabelInactive: { color: colors.primary },
  currencyLabelActive: { color: colors.primaryFg },
  switchBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 48,
    backgroundColor: colors.primary,
  },
  switchLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.primaryFg,
    textTransform: "uppercase",
  },
  signOut: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  signOutLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.error,
    textTransform: "uppercase",
  },
  versionLabel: {
    textAlign: "center",
    marginTop: spacing.md,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
  },
});

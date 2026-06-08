import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { useToast } from "@/src/components/Toast";
import {
  api,
  CurrencyCode,
  FitFeedback,
  Measurements,
  Order,
  Profile as ProfileT,
  WishlistEntry,
} from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { CURRENCIES, formatPrice } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function Profile() {
  const { user, logout, refresh } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState<ProfileT | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [wishlist, setWishlist] = useState<WishlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const [savingCurrency, setSavingCurrency] = useState<CurrencyCode | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, o, w] = await Promise.all([
        api.getProfile(),
        user?.role === "buyer" ? api.orders() : Promise.resolve<Order[]>([]),
        user?.role === "buyer" ? api.listWishlist() : Promise.resolve<WishlistEntry[]>([]),
      ]);
      setProfile(p);
      setOrders(o);
      setWishlist(w);
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

  const submitFeedback = async (orderId: string, fit: FitFeedback) => {
    try {
      const updated = await api.orderFeedback(orderId, fit);
      setOrders((curr) =>
        curr.map((o) => (o.id === orderId ? { ...o, fit_feedback: updated.fit_feedback } : o)),
      );
      toast.show("Thanks for the feedback", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not submit feedback", "error");
    }
  };

  const changeCurrency = async (code: CurrencyCode) => {
    setSavingCurrency(code);
    try {
      await api.updatePreferences({ preferred_currency: code });
      await refresh();
      toast.show(`Currency set to ${code}`, "success");
      setCurrencyPickerOpen(false);
    } catch (e: any) {
      toast.show(e?.message ?? "Could not update currency", "error");
    } finally {
      setSavingCurrency(null);
    }
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
          {user?.gender || user?.age ? (
            <Text style={[tp.bodyMuted, { marginTop: 4 }]} testID="profile-demographics">
              {user.gender ? user.gender.replace(/_/g, " ") : ""}
              {user.gender && user.age ? " · " : ""}
              {user.age ? `${user.age} yrs` : ""}
            </Text>
          ) : null}
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

        {/* Region / Currency */}
        <View style={styles.section}>
          <TouchableOpacity
            testID="profile-currency-card"
            onPress={() => setCurrencyPickerOpen((v) => !v)}
            activeOpacity={0.85}
            style={styles.currencyHeader}
          >
            <View style={{ flex: 1 }}>
              <Text style={tp.caption}>Region & Currency</Text>
              <Text style={[tp.h3, { marginTop: 6 }]} testID="profile-currency-current">
                {user?.preferred_currency ?? "KES"}
              </Text>
              <Text style={[tp.bodyMuted, { marginTop: 4 }]}>
                Show prices in your preferred currency. Sellers list pieces in their own
                currency — we&apos;ll show an approximation alongside.
              </Text>
            </View>
            <Feather
              name={currencyPickerOpen ? "chevron-up" : "chevron-down"}
              size={22}
              color={colors.primary}
            />
          </TouchableOpacity>
          {currencyPickerOpen ? (
            <View style={styles.currencyList} testID="profile-currency-list">
              {CURRENCIES.map((c) => {
                const active = user?.preferred_currency === c.code;
                const loading = savingCurrency === c.code;
                return (
                  <TouchableOpacity
                    key={c.code}
                    testID={`profile-currency-${c.code}`}
                    onPress={() => changeCurrency(c.code)}
                    disabled={!!savingCurrency}
                    style={[styles.currencyRow, active && styles.currencyRowActive]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.currencySymbol, active && styles.currencyTextActive]}>
                      {c.symbol}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.currencyCode, active && styles.currencyTextActive]}>
                        {c.code}
                      </Text>
                      <Text style={[styles.currencyLabel, active && styles.currencyLabelActive]}>
                        {c.label}
                      </Text>
                    </View>
                    {loading ? (
                      <ActivityIndicator
                        size="small"
                        color={active ? colors.primaryFg : colors.primary}
                      />
                    ) : active ? (
                      <Feather name="check" size={18} color={colors.primaryFg} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>

        {user?.role === "buyer" ? (
          <View style={styles.section}>
            <Text style={[tp.caption, { marginBottom: spacing.md }]}>Wishlist</Text>
            {wishlist.length === 0 ? (
              <Text style={tp.bodyMuted}>Tap a heart on any piece to save it here.</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.wishRow}
              >
                {wishlist.map((w) => (
                  <TouchableOpacity
                    key={w.item.id}
                    testID={`wishlist-${w.item.id}`}
                    onPress={() => router.push(`/item/${w.item.id}`)}
                    style={styles.wishCard}
                    activeOpacity={0.85}
                  >
                    <View style={styles.wishImageWrap}>
                      <Image
                        source={{ uri: dataUriFromBase64(w.item.image_b64) }}
                        style={styles.wishImage}
                        resizeMode="cover"
                      />
                      {w.restocked ? (
                        <View style={styles.restockBadge} testID={`wishlist-${w.item.id}-restock`}>
                          <Feather name="bell" size={11} color={colors.primaryFg} />
                          <Text style={styles.restockText}>Back in stock</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.wishName} numberOfLines={2}>
                      {w.item.name}
                    </Text>
                    <Text style={styles.wishPrice}>
                      {formatPrice(w.item.price_cents, w.item.currency)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        ) : null}

        {user?.role === "buyer" ? (
          <View style={styles.section}>
            <Text style={[tp.caption, { marginBottom: spacing.md }]}>Orders</Text>
            {orders.length === 0 ? (
              <Text style={tp.bodyMuted}>No orders yet.</Text>
            ) : (
              orders.map((o) => (
                <View key={o.id} style={styles.orderRow} testID={`order-${o.id}`}>
                  <View style={styles.orderTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.orderName}>{o.item_name}</Text>
                      <Text style={[tp.bodyMuted, { marginTop: 2 }]}>
                        Size {o.size}
                        {o.color ? ` · ${o.color}` : ""}
                      </Text>
                    </View>
                    <View style={styles.orderRight}>
                      <Text style={styles.orderAmount}>
                        {formatPrice(o.amount_cents, o.currency)}
                      </Text>
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
                  {o.status === "paid" ? (
                    <View style={styles.fitFeedbackRow}>
                      <Text style={styles.fitFeedbackPrompt}>
                        {o.fit_feedback ? "How it fit:" : "How did it fit?"}
                      </Text>
                      {(["small", "perfect", "large"] as FitFeedback[]).map((f) => {
                        const active = o.fit_feedback === f;
                        return (
                          <TouchableOpacity
                            key={f}
                            testID={`order-${o.id}-fit-${f}`}
                            disabled={!!o.fit_feedback}
                            onPress={() => submitFeedback(o.id, f)}
                            style={[styles.fitChip, active && styles.fitChipActive]}
                          >
                            <Text
                              style={[
                                styles.fitChipLabel,
                                active && styles.fitChipLabelActive,
                              ]}
                            >
                              {f === "small" ? "Too small" : f === "large" ? "Too large" : "Perfect"}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </View>
        ) : null}

        {user?.role === "seller" ? (
          <View style={styles.section}>
            <TouchableOpacity
              testID="profile-analytics-link"
              onPress={() => router.push("/seller/analytics")}
              style={styles.analyticsCard}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1 }}>
                <Text style={tp.caption}>Atelier insights</Text>
                <Text style={[tp.h3, { marginTop: 4 }]}>Analytics</Text>
                <Text style={[tp.bodyMuted, { marginTop: 4 }]}>
                  Views · try-ons · wishlists · revenue
                </Text>
              </View>
              <Feather name="bar-chart-2" size={28} color={colors.primary} />
            </TouchableOpacity>
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
  orderRow: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
  orderTop: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
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
  fitFeedbackRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  fitFeedbackPrompt: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.mutedFg,
    textTransform: "uppercase",
    marginRight: 4,
  },
  fitChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fitChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  fitChipLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.primary,
    textTransform: "uppercase",
  },
  fitChipLabelActive: { color: colors.primaryFg },
  wishRow: { gap: spacing.md, paddingRight: spacing.md },
  wishCard: { width: 130 },
  wishImageWrap: { position: "relative" },
  wishImage: { width: 130, height: 170, backgroundColor: colors.muted },
  wishName: { fontFamily: fonts.body, fontSize: 13, color: colors.primary, marginTop: 8 },
  wishPrice: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.primary, marginTop: 2 },
  restockBadge: {
    position: "absolute",
    left: 0,
    bottom: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 4,
    backgroundColor: colors.success,
  },
  restockText: {
    color: colors.primaryFg,
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  analyticsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  currencyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  currencyList: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  currencyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  currencyRowActive: { backgroundColor: colors.primary, borderBottomColor: colors.primary },
  currencySymbol: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: colors.primary,
    width: 44,
    textAlign: "center",
  },
  currencyCode: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    letterSpacing: 1,
    color: colors.primary,
  },
  currencyLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg, marginTop: 2 },
  currencyTextActive: { color: colors.primaryFg },
  currencyLabelActive: { color: colors.primaryFg, opacity: 0.85 },
});

// Dedicated seller dashboard — KPIs, recent orders, payouts, and Connect onboarding.

import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
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

import { AppInput } from "@/src/components/AppInput";
import { useToast } from "@/src/components/Toast";
import {
  BankDetails,
  ConnectStatus,
  Order,
  SellerAnalytics,
  api,
} from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPrice } from "@/src/lib/currency";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function SellerDashboard() {
  const { user, loading: authLoading, refresh } = useAuth();
  const toast = useToast();
  const [analytics, setAnalytics] = useState<SellerAnalytics | null>(null);
  const [recent, setRecent] = useState<Order[]>([]);
  const [connect, setConnect] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [payoutSheet, setPayoutSheet] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, o, c] = await Promise.all([
        api.sellerAnalytics(),
        api.sellerOrders(),
        api.connectStatus(),
      ]);
      setAnalytics(a);
      setRecent(o);
      setConnect(c);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load dashboard", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useFocusEffect(
    useCallback(() => {
      if (!authLoading) {
        if (!user || user.role !== "seller") {
          router.replace("/(auth)/welcome");
          return;
        }
        load();
      }
    }, [authLoading, user, load]),
  );

  const startConnect = async () => {
    setConnecting(true);
    try {
      const res = await api.connectSetup({});
      setConnect(res);
      if (res.onboarding_url) {
        await WebBrowser.openBrowserAsync(res.onboarding_url);
        toast.show("Finish KYC in the browser, then pull-to-refresh.", "success");
      } else {
        toast.show("Payouts enabled (demo)", "success");
      }
      const a = await api.sellerAnalytics();
      setAnalytics(a);
    } catch (e: any) {
      toast.show(e?.message ?? "Could not start payout onboarding", "error");
    } finally {
      setConnecting(false);
    }
  };

  if (loading || !analytics || !user) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  // Display in user's preferred currency for consistency.
  const dispCurrency = user.preferred_currency ?? "USD";
  const items = analytics.items ?? [];
  const totalLive = items.length;
  const overallConv =
    analytics.total_views > 0
      ? (analytics.total_orders_paid / analytics.total_views) * 100
      : 0;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <ScrollView
        testID="seller-dashboard-scroll"
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
          <TouchableOpacity
            testID="seller-back-btn"
            onPress={() => router.back()}
            style={styles.iconBtn}
          >
            <Feather name="arrow-left" size={22} color={colors.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={tp.caption}>SELLER DASHBOARD</Text>
            <Text style={[tp.h2, { marginTop: 4 }]} numberOfLines={2}>
              {user.company_name || user.full_name}
            </Text>
            {user.location ? (
              <Text style={[tp.bodyMuted, { marginTop: 2 }]}>
                <Feather name="map-pin" size={11} color={colors.mutedFg} />{" "}
                {user.location.city}, {user.location.country}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Connect banner */}
        {connect?.connect_status !== "active" ? (
          <View style={styles.connectCard} testID="seller-connect-card">
            <Feather name="zap" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[tp.bodySemi, { fontSize: 14 }]}>Activate payouts</Text>
              <Text style={[tp.bodyMuted, { fontSize: 12, marginTop: 2 }]}>
                {connect?.note ??
                  "Stripe Connect Express is required before we can disburse funds to your bank."}
              </Text>
            </View>
            <TouchableOpacity
              testID="seller-connect-btn"
              onPress={startConnect}
              disabled={connecting}
              style={styles.connectBtn}
              activeOpacity={0.85}
            >
              {connecting ? (
                <ActivityIndicator size="small" color={colors.primaryFg} />
              ) : (
                <Text style={styles.connectLabel}>START</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.connectCard, styles.connectActive]} testID="seller-connect-active">
            <Feather name="check-circle" size={20} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={[tp.bodySemi, { fontSize: 14 }]}>Payouts active</Text>
              <Text style={[tp.bodyMuted, { fontSize: 12, marginTop: 2 }]}>
                Connected to Stripe — net revenue routes automatically to your account.
              </Text>
            </View>
          </View>
        )}

        {/* KPI cards */}
        <View style={styles.grid}>
          <Kpi
            testID="kpi-gross"
            icon="dollar-sign"
            label="Gross (paid)"
            value={formatPrice(analytics.total_revenue_cents, dispCurrency)}
            hint={`${analytics.total_orders_paid} order${analytics.total_orders_paid === 1 ? "" : "s"}`}
          />
          <Kpi
            testID="kpi-net"
            icon="trending-up"
            label="Net to you"
            value={formatPrice(analytics.total_net_cents, dispCurrency)}
            hint={`${(analytics.platform_fee_bps / 100).toFixed(0)}% platform fee`}
          />
          <Kpi
            testID="kpi-items"
            icon="package"
            label="Listings live"
            value={String(totalLive)}
            hint={`${analytics.total_try_ons} try-ons`}
          />
          <Kpi
            testID="kpi-conversion"
            icon="bar-chart-2"
            label="Conversion"
            value={`${overallConv.toFixed(1)}%`}
            hint={`${analytics.total_wishlists} wishlist saves`}
          />
        </View>

        {/* Quick actions */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            testID="seller-new-item-cta"
            style={styles.primaryBtn}
            onPress={() => router.push("/seller/new-item")}
          >
            <Feather name="plus" size={16} color={colors.primaryFg} />
            <Text style={styles.primaryLabel}>NEW ITEM</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="seller-analytics-cta"
            style={styles.outlineBtn}
            onPress={() => router.push("/seller/analytics")}
          >
            <Feather name="pie-chart" size={16} color={colors.primary} />
            <Text style={styles.outlineLabel}>FULL ANALYTICS</Text>
          </TouchableOpacity>
        </View>

        {/* Recent orders */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={tp.caption}>Recent orders</Text>
            <Text style={[tp.bodyMuted, { fontSize: 11 }]} testID="seller-orders-count">
              {recent.length} total
            </Text>
          </View>
          {recent.length === 0 ? (
            <Text style={[tp.bodyMuted, { marginTop: spacing.md }]}>
              No orders yet. Share your atelier link to drive your first sale.
            </Text>
          ) : (
            recent.slice(0, 6).map((o) => (
              <TouchableOpacity
                key={o.id}
                testID={`seller-order-${o.id}`}
                style={styles.orderRow}
                onPress={() => router.push(`/order/${o.id}`)}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderName} numberOfLines={1}>{o.item_name}</Text>
                  <Text style={tp.bodyMuted}>
                    Size {o.size}
                    {o.color ? ` · ${o.color}` : ""}
                    {" · "}
                    {new Date(o.created_at).toLocaleDateString()}
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
                      o.status === "failed" && styles.statusFailed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        (o.status === "paid" || o.status === "failed") && styles.statusTextLight,
                      ]}
                    >
                      {o.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Payout details */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={tp.caption}>Payout details</Text>
            <TouchableOpacity
              testID="seller-edit-payout-btn"
              onPress={() => setPayoutSheet(true)}
            >
              <Text style={styles.link}>Edit</Text>
            </TouchableOpacity>
          </View>
          <PayoutSummary bank={user.bank_details ?? undefined} />
        </View>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>

      <PayoutSheet
        visible={payoutSheet}
        initial={user.bank_details ?? undefined}
        onCancel={() => setPayoutSheet(false)}
        onSaved={async () => {
          setPayoutSheet(false);
          await refresh();
          toast.show("Payout details updated", "success");
        }}
      />
    </SafeAreaView>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  testID,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  hint?: string;
  testID?: string;
}) {
  return (
    <View style={styles.tile} testID={testID}>
      <View style={styles.tileTop}>
        <Text style={tp.caption}>{label}</Text>
        <Feather name={icon} size={16} color={colors.primary} />
      </View>
      <Text style={styles.tileValue}>{value}</Text>
      {hint ? <Text style={styles.tileHint} numberOfLines={2}>{hint}</Text> : null}
    </View>
  );
}

function PayoutSummary({ bank }: { bank?: BankDetails }) {
  if (!bank || !Object.values(bank).some(Boolean)) {
    return (
      <Text style={[tp.bodyMuted, { marginTop: spacing.sm }]}>
        No payout method on file yet. Tap “Edit” to add bank or M-Pesa details.
      </Text>
    );
  }
  return (
    <View style={{ marginTop: spacing.sm, gap: 6 }}>
      {bank.bank_name ? (
        <Text style={tp.bodyMuted}>
          <Text style={styles.summaryLabel}>Bank</Text>{" "}{bank.bank_name}
          {bank.account_number
            ? `  ·  ••• ${bank.account_number.slice(-4)}`
            : ""}
        </Text>
      ) : null}
      {bank.mpesa_paybill ? (
        <Text style={tp.bodyMuted}>
          <Text style={styles.summaryLabel}>M-Pesa Paybill</Text>{" "}{bank.mpesa_paybill}
        </Text>
      ) : null}
      {bank.mpesa_till ? (
        <Text style={tp.bodyMuted}>
          <Text style={styles.summaryLabel}>M-Pesa Till</Text>{" "}{bank.mpesa_till}
        </Text>
      ) : null}
    </View>
  );
}

interface PayoutSheetProps {
  visible: boolean;
  initial?: BankDetails;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}

function PayoutSheet({ visible, initial, onCancel, onSaved }: PayoutSheetProps) {
  const toast = useToast();
  const [bankName, setBankName] = useState(initial?.bank_name ?? "");
  const [accountName, setAccountName] = useState(initial?.account_name ?? "");
  const [accountNumber, setAccountNumber] = useState(initial?.account_number ?? "");
  const [mpesaPaybill, setMpesaPaybill] = useState(initial?.mpesa_paybill ?? "");
  const [mpesaTill, setMpesaTill] = useState(initial?.mpesa_till ?? "");
  const [saving, setSaving] = useState(false);

  // Reset state when the modal opens with fresh initial values
  React.useEffect(() => {
    if (visible) {
      setBankName(initial?.bank_name ?? "");
      setAccountName(initial?.account_name ?? "");
      setAccountNumber(initial?.account_number ?? "");
      setMpesaPaybill(initial?.mpesa_paybill ?? "");
      setMpesaTill(initial?.mpesa_till ?? "");
    }
  }, [visible, initial]);

  const save = async () => {
    setSaving(true);
    try {
      await api.updatePayoutDetails({
        bank_name: bankName.trim() || null,
        account_name: accountName.trim() || null,
        account_number: accountNumber.trim() || null,
        mpesa_paybill: mpesaPaybill.trim() || null,
        mpesa_till: mpesaTill.trim() || null,
      });
      await onSaved();
    } catch (e: any) {
      toast.show(e?.message ?? "Could not save payout details", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <Pressable style={styles.modalBackdrop} onPress={onCancel}>
        <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHandle} />
          <Text style={[tp.h3, { marginBottom: spacing.sm }]}>Edit payout details</Text>
          <Text style={[tp.bodyMuted, { marginBottom: spacing.md }]}>
            Save bank and/or M-Pesa info. Both are optional — fill at least one before your first payout.
          </Text>
          <ScrollView style={{ maxHeight: Platform.OS === "web" ? 480 : 520 }}>
            <Text style={[tp.caption, { marginTop: spacing.sm, marginBottom: 6 }]}>Bank</Text>
            <AppInput
              testID="payout-bank-name"
              label="Bank name"
              value={bankName}
              onChangeText={setBankName}
              placeholder="Equity Bank"
            />
            <AppInput
              testID="payout-account-name"
              label="Account name"
              value={accountName}
              onChangeText={setAccountName}
              placeholder="Maison Lumière Ltd"
            />
            <AppInput
              testID="payout-account-number"
              label="Account number"
              value={accountNumber}
              onChangeText={setAccountNumber}
              keyboardType="number-pad"
              placeholder="0123456789"
            />
            <Text style={[tp.caption, { marginTop: spacing.md, marginBottom: 6 }]}>M-Pesa</Text>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <AppInput
                  testID="payout-mpesa-paybill"
                  label="Paybill"
                  value={mpesaPaybill}
                  onChangeText={setMpesaPaybill}
                  keyboardType="number-pad"
                  placeholder="247247"
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppInput
                  testID="payout-mpesa-till"
                  label="Till"
                  value={mpesaTill}
                  onChangeText={setMpesaTill}
                  keyboardType="number-pad"
                  placeholder="123456"
                />
              </View>
            </View>
          </ScrollView>
          <View style={styles.modalActions}>
            <TouchableOpacity
              testID="payout-cancel-btn"
              onPress={onCancel}
              style={[styles.modalBtn, styles.modalBtnGhost]}
              activeOpacity={0.85}
            >
              <Text style={styles.modalGhostLabel}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="payout-save-btn"
              onPress={save}
              disabled={saving}
              style={[styles.modalBtn, styles.modalBtnPrimary]}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color={colors.primaryFg} />
              ) : (
                <Text style={styles.modalPrimaryLabel}>SAVE</Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingBottom: spacing.xxl },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  connectCard: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  connectActive: { borderColor: colors.success },
  connectBtn: {
    paddingHorizontal: spacing.md,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  connectLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.primaryFg,
  },
  grid: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 110,
  },
  tileTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tileValue: { fontFamily: fonts.heading, fontSize: 26, color: colors.primary, marginTop: 8 },
  tileHint: { fontFamily: fonts.body, fontSize: 11, color: colors.mutedFg, marginTop: 4 },
  actionRow: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    backgroundColor: colors.primary,
  },
  primaryLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.primaryFg,
  },
  outlineBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  outlineLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.primary,
  },
  section: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  link: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.primary, letterSpacing: 0.6 },
  summaryLabel: { fontFamily: fonts.bodySemi, color: colors.primary },
  orderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  orderName: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  orderRight: { alignItems: "flex-end", gap: 6 },
  orderAmount: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.muted },
  statusPaid: { backgroundColor: colors.success },
  statusPending: { backgroundColor: "#FFD60A" },
  statusFailed: { backgroundColor: colors.error },
  statusText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primary,
  },
  statusTextLight: { color: colors.primaryFg },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.background,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: "90%",
  },
  modalHandle: {
    width: 48,
    height: 4,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  modalBtn: {
    flex: 1,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnPrimary: { backgroundColor: colors.primary },
  modalBtnGhost: { borderWidth: 1, borderColor: colors.border },
  modalPrimaryLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.primaryFg,
  },
  modalGhostLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.primary,
  },
});

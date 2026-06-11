// Payout Management — sellers configure their payout method and review the
// full ledger of paid orders here.
//
// Sections:
//   1. Connect status card (Connected ✓ / Pending / Unstarted)
//   2. Payment terms (10% platform fee per transaction)
//   3. Historical payout transactions — one row per paid order, mirroring
//      `GET /api/seller/payouts`.

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
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppInput } from "@/src/components/AppInput";
import { useToast } from "@/src/components/Toast";
import {
  api,
  BankDetails,
  ConnectStatus,
  PayoutHistory,
  PayoutRow,
} from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPrice } from "@/src/lib/currency";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

/* -------------------------------------------------------------------------- */

export default function Payouts() {
  const toast = useToast();
  const { user, refresh } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 720;

  const [data, setData] = useState<PayoutHistory | null>(null);
  const [connect, setConnect] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api.sellerPayouts(), api.connectStatus()]);
      setData(p);
      setConnect(c);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load payouts", "error");
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
      await load();
    } catch (e: any) {
      toast.show(e?.message ?? "Could not start payout onboarding", "error");
    } finally {
      setConnecting(false);
    }
  };

  if (loading || !data) {
    return (
      <SafeAreaView style={[styles.root, styles.center]} edges={["top"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const dispCurrency = user?.preferred_currency ?? "USD";
  const status: "active" | "pending" | "unstarted" =
    (data.connect_status ?? connect?.connect_status ?? "unstarted") as
      | "active"
      | "pending"
      | "unstarted";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        testID="payouts-scroll"
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
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={tp.caption}>SELLER PORTAL · PAYOUTS</Text>
            <Text style={[tp.h2, { marginTop: 4 }]}>Payout management</Text>
          </View>
        </View>

        {/* Connection status card */}
        <View style={styles.section} testID="payouts-connection">
          <View style={styles.sectionHead}>
            <Text style={tp.caption}>Connection</Text>
            <StatusPill status={status} />
          </View>
          <Text style={[tp.body, { marginTop: spacing.sm }]}>
            {status === "active"
              ? "Stripe Connect is active — net revenue routes automatically to your bank or M-Pesa account."
              : status === "pending"
                ? "Stripe is reviewing your KYC submission. Payouts will start once approved."
                : "Connect your payout account to receive funds for paid orders. Drape uses Stripe Connect Express."}
          </Text>
          {connect?.note ? (
            <Text style={[tp.bodyMuted, { marginTop: spacing.sm, fontStyle: "italic" }]}>
              {connect.note}
            </Text>
          ) : null}
          <View style={styles.connectActions}>
            {status !== "active" ? (
              <TouchableOpacity
                testID="payouts-connect-btn"
                onPress={startConnect}
                disabled={connecting}
                style={[styles.primaryBtn, connecting && styles.primaryBtnDisabled]}
                activeOpacity={0.85}
              >
                {connecting ? (
                  <ActivityIndicator color={colors.primaryFg} size="small" />
                ) : (
                  <>
                    <Feather name="zap" size={14} color={colors.primaryFg} />
                    <Text style={styles.primaryLabel}>Set up payouts</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              testID="payouts-edit-method-btn"
              onPress={() => setEditOpen(true)}
              style={styles.outlineBtn}
              activeOpacity={0.85}
            >
              <Feather name="edit-2" size={14} color={colors.primary} />
              <Text style={styles.outlineLabel}>Edit method</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.methodCard} testID="payouts-method-summary">
            <PayoutMethodSummary bank={user?.bank_details ?? undefined} />
          </View>
        </View>

        {/* Payment terms */}
        <View style={styles.section} testID="payouts-terms">
          <View style={styles.sectionHead}>
            <Text style={tp.caption}>Payment terms</Text>
          </View>
          <View style={[styles.termsGrid, isWide && styles.termsGridWide]}>
            <TermsCard
              icon="percent"
              label="Platform fee"
              value={`${(data.platform_fee_bps / 100).toFixed(0)}%`}
              hint="Drape's commission, deducted automatically per paid transaction."
              testID="terms-fee"
            />
            <TermsCard
              icon="trending-up"
              label="Lifetime gross"
              value={formatPrice(data.totals.gross_cents, dispCurrency)}
              hint={`${data.totals.count} paid transaction${data.totals.count === 1 ? "" : "s"}`}
              testID="terms-gross"
            />
            <TermsCard
              icon="minus-circle"
              label="Lifetime fees"
              value={`−${formatPrice(data.totals.platform_fee_cents, dispCurrency)}`}
              hint="Sum of all platform fees deducted to date."
              testID="terms-fees"
            />
            <TermsCard
              icon="dollar-sign"
              label="Net to you"
              value={formatPrice(data.totals.net_cents, dispCurrency)}
              hint="Sum of what we've paid (or will pay) out."
              testID="terms-net"
            />
          </View>
        </View>

        {/* Historical payouts */}
        <View style={styles.section} testID="payouts-history">
          <View style={styles.sectionHead}>
            <Text style={tp.caption}>Payout transactions</Text>
            <Text style={[tp.bodyMuted, { fontSize: 11 }]}>
              {data.payouts.length} entr{data.payouts.length === 1 ? "y" : "ies"}
            </Text>
          </View>
          {data.payouts.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="credit-card" size={28} color={colors.mutedFg} />
              <Text style={[tp.h3, { textAlign: "center", marginTop: spacing.sm }]}>
                No payouts yet
              </Text>
              <Text style={[tp.bodyMuted, { textAlign: "center", marginTop: 4 }]}>
                Paid orders appear here as soon as a buyer checks out.
              </Text>
            </View>
          ) : isWide ? (
            <PayoutsTable rows={data.payouts} />
          ) : (
            <View>
              {data.payouts.map((p) => (
                <PayoutCard key={p.id} row={p} />
              ))}
            </View>
          )}
        </View>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>

      <EditPayoutModal
        visible={editOpen}
        initial={user?.bank_details ?? undefined}
        onCancel={() => setEditOpen(false)}
        onSaved={async () => {
          setEditOpen(false);
          await refresh();
          toast.show("Payout method updated", "success");
        }}
      />
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function StatusPill({ status }: { status: "active" | "pending" | "unstarted" }) {
  const map: Record<
    typeof status,
    { label: string; color: string; bg: string; icon: keyof typeof Feather.glyphMap }
  > = {
    active: { label: "Connected", color: colors.primaryFg, bg: colors.success, icon: "check" },
    pending: { label: "In review", color: colors.primary, bg: "#FFD60A", icon: "clock" },
    unstarted: { label: "Unstarted", color: colors.primary, bg: colors.muted, icon: "alert-circle" },
  };
  const s = map[status];
  return (
    <View
      style={[styles.statusPill, { backgroundColor: s.bg }]}
      testID={`payouts-status-${status}`}
    >
      <Feather name={s.icon} size={12} color={s.color} />
      <Text style={[styles.statusPillLabel, { color: s.color }]}>
        {s.label.toUpperCase()}
      </Text>
    </View>
  );
}

function PayoutMethodSummary({ bank }: { bank?: BankDetails }) {
  if (!bank || !Object.values(bank).some(Boolean)) {
    return (
      <Text style={tp.bodyMuted}>
        No payout method on file. Tap “Edit method” to add a bank account or
        M-Pesa Paybill/Till.
      </Text>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      {bank.bank_name ? (
        <Text style={tp.body}>
          <Text style={styles.summaryLabel}>Bank</Text>{"  "}
          {bank.bank_name}
          {bank.account_number ? `  ·  ••• ${bank.account_number.slice(-4)}` : ""}
        </Text>
      ) : null}
      {bank.mpesa_paybill ? (
        <Text style={tp.body}>
          <Text style={styles.summaryLabel}>M-Pesa Paybill</Text>{"  "}
          {bank.mpesa_paybill}
        </Text>
      ) : null}
      {bank.mpesa_till ? (
        <Text style={tp.body}>
          <Text style={styles.summaryLabel}>M-Pesa Till</Text>{"  "}
          {bank.mpesa_till}
        </Text>
      ) : null}
    </View>
  );
}

function TermsCard({
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
    <View style={styles.termsCard} testID={testID}>
      <View style={styles.termsCardTop}>
        <Text style={[tp.caption, { color: colors.mutedFg }]}>{label}</Text>
        <Feather name={icon} size={16} color={colors.primary} />
      </View>
      <Text style={styles.termsValue}>{value}</Text>
      {hint ? <Text style={styles.termsHint}>{hint}</Text> : null}
    </View>
  );
}

function PayoutsTable({ rows }: { rows: PayoutRow[] }) {
  return (
    <View style={styles.table} testID="payouts-table">
      <View style={[styles.tableRow, styles.tableHead]}>
        <Text style={[styles.cellDate, styles.tableHeadText]}>DATE</Text>
        <Text style={[styles.cellItem, styles.tableHeadText]}>ORDER</Text>
        <Text style={[styles.cellMoney, styles.tableHeadText]}>GROSS</Text>
        <Text style={[styles.cellMoney, styles.tableHeadText]}>FEE</Text>
        <Text style={[styles.cellMoney, styles.tableHeadText]}>NET</Text>
        <Text style={[styles.cellStatus, styles.tableHeadText]}>STATUS</Text>
      </View>
      {rows.map((r) => (
        <Pressable
          key={r.id}
          testID={`payouts-table-row-${r.id}`}
          onPress={() => router.push(`/order/${r.id}`)}
          style={({ pressed }) => [
            styles.tableRow,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={[styles.cellDate, styles.cellText]}>
            {new Date(r.created_at).toLocaleDateString()}
          </Text>
          <View style={styles.cellItem}>
            <Text style={styles.itemName} numberOfLines={1}>
              {r.item_name}
            </Text>
            <Text style={[tp.bodyMuted, { fontSize: 11 }]} numberOfLines={1}>
              Size {r.size}
              {r.color ? ` · ${r.color}` : ""}
            </Text>
          </View>
          <Text style={[styles.cellMoney, styles.cellText]}>
            {formatPrice(r.amount_cents, r.currency)}
          </Text>
          <Text style={[styles.cellMoney, styles.cellText, { color: colors.error }]}>
            −{formatPrice(r.platform_fee_cents, r.currency)}
          </Text>
          <Text style={[styles.cellMoney, styles.cellText, { color: colors.success }]}>
            {formatPrice(r.seller_net_cents, r.currency)}
          </Text>
          <View style={styles.cellStatus}>
            <View
              style={[
                styles.statusPill,
                { backgroundColor: r.status === "paid" ? colors.success : colors.muted },
              ]}
            >
              <Text
                style={[
                  styles.statusPillLabel,
                  {
                    color:
                      r.status === "paid" ? colors.primaryFg : colors.primary,
                  },
                ]}
              >
                {r.status.toUpperCase()}
              </Text>
            </View>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function PayoutCard({ row }: { row: PayoutRow }) {
  return (
    <Pressable
      testID={`payouts-card-${row.id}`}
      onPress={() => router.push(`/order/${row.id}`)}
      style={({ pressed }) => [styles.payoutCard, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.itemName} numberOfLines={1}>
          {row.item_name}
        </Text>
        <Text style={[tp.bodyMuted, { fontSize: 11 }]}>
          Size {row.size}
          {row.color ? ` · ${row.color}` : ""}
          {" · "}
          {new Date(row.created_at).toLocaleDateString()}
        </Text>
        <View style={styles.payoutBreakdown}>
          <Text style={styles.breakdownItem}>
            <Text style={styles.breakdownLabel}>GROSS </Text>
            {formatPrice(row.amount_cents, row.currency)}
          </Text>
          <Text style={[styles.breakdownItem, { color: colors.error }]}>
            <Text style={styles.breakdownLabel}>FEE </Text>−
            {formatPrice(row.platform_fee_cents, row.currency)}
          </Text>
          <Text style={[styles.breakdownItem, { color: colors.success }]}>
            <Text style={styles.breakdownLabel}>NET </Text>
            {formatPrice(row.seller_net_cents, row.currency)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Edit payout method modal                                                   */
/* -------------------------------------------------------------------------- */

interface EditPayoutModalProps {
  visible: boolean;
  initial?: BankDetails;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}

function EditPayoutModal({ visible, initial, onCancel, onSaved }: EditPayoutModalProps) {
  const toast = useToast();
  const [bankName, setBankName] = useState(initial?.bank_name ?? "");
  const [accountName, setAccountName] = useState(initial?.account_name ?? "");
  const [accountNumber, setAccountNumber] = useState(initial?.account_number ?? "");
  const [mpesaPaybill, setMpesaPaybill] = useState(initial?.mpesa_paybill ?? "");
  const [mpesaTill, setMpesaTill] = useState(initial?.mpesa_till ?? "");
  const [saving, setSaving] = useState(false);

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
          <Text style={[tp.h3, { marginBottom: spacing.sm }]}>Edit payout method</Text>
          <Text style={[tp.bodyMuted, { marginBottom: spacing.md }]}>
            Save bank and/or M-Pesa info. Both are optional — fill at least one
            before your first payout.
          </Text>
          <ScrollView style={{ maxHeight: Platform.OS === "web" ? 480 : 520 }}>
            <Text style={[tp.caption, { marginTop: spacing.sm, marginBottom: 6 }]}>Bank</Text>
            <AppInput
              testID="payouts-bank-name"
              label="Bank name"
              value={bankName}
              onChangeText={setBankName}
              placeholder="Equity Bank"
            />
            <AppInput
              testID="payouts-account-name"
              label="Account name"
              value={accountName}
              onChangeText={setAccountName}
              placeholder="Maison Lumière Ltd"
            />
            <AppInput
              testID="payouts-account-number"
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
                  testID="payouts-mpesa-paybill"
                  label="Paybill"
                  value={mpesaPaybill}
                  onChangeText={setMpesaPaybill}
                  keyboardType="number-pad"
                  placeholder="247247"
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppInput
                  testID="payouts-mpesa-till"
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
              testID="payouts-cancel-btn"
              onPress={onCancel}
              style={[styles.modalBtn, styles.modalBtnGhost]}
              activeOpacity={0.85}
            >
              <Text style={styles.modalGhostLabel}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="payouts-save-btn"
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

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  scroll: { paddingBottom: spacing.xxl },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    minHeight: 44,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryLabel: {
    color: colors.primaryFg,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  outlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    minHeight: 44,
  },
  outlineLabel: {
    color: colors.primary,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  section: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  connectActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  methodCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryLabel: { fontFamily: fonts.bodySemi, color: colors.primary },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.muted,
  },
  statusPillLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primary,
  },
  termsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  termsGridWide: { flexWrap: "nowrap" },
  termsCard: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 180,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  termsCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  termsValue: {
    fontFamily: fonts.heading,
    fontSize: 24,
    color: colors.primary,
    marginTop: 8,
  },
  termsHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    marginTop: 4,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl,
    gap: 6,
  },
  // Card layout for mobile
  payoutCard: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 4,
  },
  itemName: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  payoutBreakdown: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: 6 },
  breakdownItem: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
  },
  breakdownLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.mutedFg,
  },
  // Table layout for wide screens
  table: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  tableHead: { backgroundColor: colors.muted },
  tableHeadText: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.mutedFg,
    textTransform: "uppercase",
  },
  cellDate: { width: 100 },
  cellItem: { flex: 3, minWidth: 160 },
  cellMoney: { flex: 1, minWidth: 90, textAlign: "right" },
  cellStatus: { width: 90, alignItems: "flex-end" },
  cellText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
  },
  // Modal
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

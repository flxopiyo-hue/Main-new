// Payout Dashboard — sellers review escrow status of paid orders and jump
// into the Payout Account screen to configure their Paystack payout
// destination (Kenyan bank / M-Pesa).
//
// Escrow model (Phase 5):
//   • Buyer pays via Paystack → funds are held by Oromona.
//   • Seller marks the order shipped → later delivered.
//   • Buyer confirms delivery (instant release) OR 48h passes with no
//     dispute (auto-release) OR buyer reports a problem (funds frozen).
//   • Platform retains a flat 15% fee per sale; the rest is transferred
//     to the seller's Paystack Transfer Recipient.
//
// Sections:
//   1. Payout account status card (linked to /(seller)/payout-account).
//   2. Escrow summary (held / released totals + platform fee headline).
//   3. Historical payouts table — one row per paid order, each with its
//      current escrow state (held / released / disputed).

import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { api, PayoutHistory, PayoutRow } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPrice } from "@/src/lib/currency";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

/* -------------------------------------------------------------------------- */

type EscrowState = "held" | "released" | "settled" | "disputed" | "cancelled";

const ESCROW_META: Record<
  EscrowState,
  { label: string; color: string; bg: string; icon: keyof typeof Feather.glyphMap }
> = {
  held: { label: "Held", color: "#92400E", bg: "rgba(245, 158, 11, 0.15)", icon: "clock" },
  released: { label: "Released", color: "#065F46", bg: "rgba(5, 150, 105, 0.15)", icon: "check-circle" },
  settled: { label: "Paid out", color: "#065F46", bg: "rgba(5, 150, 105, 0.15)", icon: "check-circle" },
  disputed: { label: "Disputed", color: "#991B1B", bg: "rgba(220, 38, 38, 0.15)", icon: "alert-triangle" },
  cancelled: { label: "Cancelled", color: colors.mutedFg, bg: colors.muted, icon: "x-circle" },
};

/* -------------------------------------------------------------------------- */

export default function Payouts() {
  const toast = useToast();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 720;

  const [data, setData] = useState<PayoutHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api.sellerPayouts();
      setData(p);
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

  if (loading || !data) {
    return (
      <SafeAreaView style={[styles.root, styles.center]} edges={["top"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const dispCurrency = user?.preferred_currency ?? "KES";
  const feePct = (data.platform_fee_bps / 100).toFixed(0);
  const account = data.payout_account ?? null;
  const hasRecipient = !!data.has_recipient;

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
          <Text style={tp.caption}>SELLER PORTAL · PAYOUTS</Text>
          <Text style={[tp.h2, { marginTop: 4 }]}>Payouts & Escrow</Text>
          <Text style={[tp.bodyMuted, { marginTop: 4 }]}>
            Buyer funds are held in escrow. Released to your Paystack
            payout account on delivery confirmation (or 48h auto-release).
          </Text>
        </View>

        {/* Payout account status card */}
        <Pressable
          testID="payouts-account-card"
          onPress={() => router.push("/(seller)/payout-account")}
          style={({ pressed }) => [
            styles.accountCard,
            account && hasRecipient ? styles.accountCardActive : styles.accountCardEmpty,
            pressed && { opacity: 0.85 },
          ]}
        >
          <View style={styles.accountIcon}>
            <Feather
              name={account && hasRecipient ? "check-circle" : "credit-card"}
              size={20}
              color={account && hasRecipient ? "#059669" : colors.primary}
            />
          </View>
          <View style={{ flex: 1 }}>
            {account && hasRecipient ? (
              <>
                <Text style={styles.accountTitle}>Payout account active</Text>
                <Text style={styles.accountLine}>
                  {account.bank_name} · •••{account.account_number_last4}
                </Text>
                <Text style={[tp.bodyMuted, { fontSize: 11, marginTop: 2 }]}>
                  {account.account_holder} · {account.country.toUpperCase()}
                </Text>
              </>
            ) : account ? (
              <>
                <Text style={styles.accountTitle}>Setup pending on Paystack</Text>
                <Text style={[tp.bodyMuted, { fontSize: 12, marginTop: 4 }]}>
                  Tap to retry — {account.bank_name} · •••{account.account_number_last4}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.accountTitle}>Add your payout account</Text>
                <Text style={[tp.bodyMuted, { fontSize: 12, marginTop: 4 }]}>
                  Bank or M-Pesa · required before your first payout releases.
                </Text>
              </>
            )}
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedFg} />
        </Pressable>

        {/* Escrow summary grid */}
        <View style={styles.section} testID="payouts-summary">
          <View style={styles.sectionHead}>
            <Text style={tp.caption}>Escrow summary</Text>
            <View style={styles.feePill}>
              <Feather name="percent" size={10} color={colors.primaryFg} />
              <Text style={styles.feePillLabel}>{feePct}% platform fee</Text>
            </View>
          </View>
          <View style={[styles.summaryGrid, isWide && styles.summaryGridWide]}>
            <SummaryCard
              icon="clock"
              tint="#92400E"
              tintBg="rgba(245, 158, 11, 0.12)"
              label="Held in escrow"
              value={formatPrice(data.totals.held_cents ?? 0, dispCurrency)}
              hint="Awaiting delivery confirmation or 48h auto-release."
              testID="summary-held"
            />
            <SummaryCard
              icon="check-circle"
              tint="#065F46"
              tintBg="rgba(5, 150, 105, 0.12)"
              label="Released to you"
              value={formatPrice(data.totals.released_cents ?? 0, dispCurrency)}
              hint="Cleared for Paystack transfer to your payout account."
              testID="summary-released"
            />
            <SummaryCard
              icon="trending-up"
              label="Lifetime gross"
              value={formatPrice(data.totals.gross_cents, dispCurrency)}
              hint={`${data.totals.count} paid order${data.totals.count === 1 ? "" : "s"}`}
              testID="summary-gross"
            />
            <SummaryCard
              icon="minus-circle"
              tint={colors.error}
              label="Platform fees"
              value={`−${formatPrice(data.totals.platform_fee_cents, dispCurrency)}`}
              hint={`${feePct}% deducted per paid transaction.`}
              testID="summary-fees"
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
                Paid orders will appear here in escrow. Funds release after
                buyer confirmation or 48h auto-release.
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

        {/* Help block */}
        <View style={styles.helpBox}>
          <Feather name="shield" size={14} color={colors.primary} />
          <Text style={styles.helpText}>
            How escrow works: buyers pay via Paystack, funds are held by
            Oromona. Once the buyer confirms delivery — or 48 hours pass
            after the courier marks delivered — the seller net (after 15%
            platform fee) is transferred to your saved payout account.
            Reported problems freeze the transfer until resolved.
          </Text>
        </View>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function EscrowPill({ status }: { status?: EscrowState | null }) {
  const s = ESCROW_META[status ?? "held"] || ESCROW_META.held;
  return (
    <View style={[styles.escrowPill, { backgroundColor: s.bg }]}>
      <Feather name={s.icon} size={11} color={s.color} />
      <Text style={[styles.escrowPillLabel, { color: s.color }]}>
        {s.label.toUpperCase()}
      </Text>
    </View>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
  testID,
  tint,
  tintBg,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  hint?: string;
  testID?: string;
  tint?: string;
  tintBg?: string;
}) {
  return (
    <View style={styles.summaryCard} testID={testID}>
      <View style={styles.summaryCardTop}>
        <Text style={[tp.caption, { color: colors.mutedFg }]}>{label}</Text>
        <View
          style={[
            styles.summaryIcon,
            tintBg ? { backgroundColor: tintBg } : null,
          ]}
        >
          <Feather name={icon} size={14} color={tint || colors.primary} />
        </View>
      </View>
      <Text style={[styles.summaryValue, tint ? { color: tint } : null]}>{value}</Text>
      {hint ? <Text style={styles.summaryHint}>{hint}</Text> : null}
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
        <Text style={[styles.cellStatus, styles.tableHeadText]}>ESCROW</Text>
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
            <EscrowPill status={r.escrow_status as EscrowState | null} />
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
      <View style={styles.payoutCardHead}>
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
        </View>
        <EscrowPill status={row.escrow_status as EscrowState | null} />
      </View>
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
      {row.escrow_status === "held" && row.escrow_release_at ? (
        <Text style={styles.escrowFooter}>
          Auto-releases {new Date(row.escrow_release_at).toLocaleString()}
        </Text>
      ) : row.escrow_status === "disputed" && row.dispute_raised_at ? (
        <Text style={[styles.escrowFooter, { color: colors.error }]}>
          Dispute raised {new Date(row.dispute_raised_at).toLocaleDateString()} · frozen
        </Text>
      ) : null}
    </Pressable>
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  // Account card
  accountCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
  },
  accountCardActive: {
    backgroundColor: "rgba(5, 150, 105, 0.08)",
    borderColor: "rgba(5, 150, 105, 0.35)",
  },
  accountCardEmpty: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  accountIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  accountTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.primary,
  },
  accountLine: {
    marginTop: 4,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.primary,
  },
  // Section
  section: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  feePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.primary,
    borderRadius: 12,
  },
  feePillLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    color: colors.primaryFg,
    letterSpacing: 0.8,
  },
  // Summary grid
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  summaryGridWide: { flexWrap: "nowrap" },
  summaryCard: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 150,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: 10,
  },
  summaryCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  summaryValue: {
    fontFamily: fonts.heading,
    fontSize: 20,
    color: colors.primary,
    marginTop: 8,
  },
  summaryHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    marginTop: 4,
    lineHeight: 15,
  },
  // Escrow pill
  escrowPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  escrowPillLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.0,
  },
  // History
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl,
    gap: 6,
  },
  payoutCard: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 6,
  },
  payoutCardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  itemName: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  payoutBreakdown: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: 6,
  },
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
  escrowFooter: {
    marginTop: 4,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
  },
  // Table
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: 8,
  },
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
  cellStatus: { width: 96, alignItems: "flex-end" },
  cellText: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
  },
  // Help box
  helpBox: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  helpText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
    lineHeight: 17,
  },
});

// Rich, role-aware order detail screen with post-purchase fit feedback step.

import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { api, FitFeedback, OrderDetail } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPriceIn } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const FIT_OPTIONS: { key: FitFeedback; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "small", label: "Too small", icon: "minus-circle" },
  { key: "perfect", label: "True to size", icon: "check-circle" },
  { key: "large", label: "Too big", icon: "plus-circle" },
];

function statusTone(status: string) {
  switch (status) {
    case "paid":
      return { bg: colors.success, fg: colors.primaryFg };
    case "pending":
      return { bg: "#FFD60A", fg: colors.primary };
    case "failed":
      return { bg: colors.error, fg: colors.primaryFg };
    case "cancelled":
      return { bg: colors.mutedFg, fg: colors.primaryFg };
    default:
      return { bg: colors.muted, fg: colors.primary };
  }
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [fit, setFit] = useState<FitFeedback | null>(null);
  const [comment, setComment] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const o = await api.orderDetail(id);
      setOrder(o);
      setFit(o.fit_feedback ?? null);
      setComment(o.fit_feedback_comment ?? "");
    } catch (e: any) {
      toast.show(e?.message ?? "Order not found", "error");
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!order || !fit) return;
    setSubmitting(true);
    try {
      const updated = await api.orderFeedback(order.id, {
        fit,
        comment: comment.trim() ? comment.trim() : undefined,
      });
      setOrder(updated);
      toast.show("Thanks for the feedback!", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not submit feedback", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !order) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const tone = statusTone(order.status);
  const isBuyer = user?.id === order.buyer_id;
  const isSeller = user?.id === order.seller_id;
  const isAdmin = user?.role === "admin";
  const canLeaveFeedback = isBuyer && order.status === "paid";
  const alreadyGaveFeedback = !!order.fit_feedback;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="order-back-btn"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption} testID="order-id-label">
          ORDER · {order.id.slice(0, 8).toUpperCase()}
        </Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAwareScrollView
        testID="order-scroll"
        bottomOffset={32}
        contentContainerStyle={styles.scroll}
      >
        {order.item_image_b64 ? (
          <Image
            source={{ uri: dataUriFromBase64(order.item_image_b64) }}
            style={styles.hero}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.hero, styles.heroPlaceholder]}>
            <Feather name="image" size={48} color={colors.mutedFg} />
          </View>
        )}

        <View style={styles.contentWrap}>
          <View style={[styles.statusPill, { backgroundColor: tone.bg }]} testID="order-status">
            <Text style={[styles.statusText, { color: tone.fg }]}>
              {order.status.toUpperCase()}
            </Text>
          </View>
          <Text style={[tp.h1, styles.itemName]} testID="order-item-name" numberOfLines={3}>
            {order.item_name}
          </Text>
          <Text style={tp.bodyMuted}>
            Placed {new Date(order.created_at).toLocaleString()}
          </Text>

          <View style={styles.metaRow}>
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Size</Text>
              <Text style={styles.metaValue} testID="order-size">{order.size}</Text>
            </View>
            {order.color ? (
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Color</Text>
                <Text style={styles.metaValue} testID="order-color">{order.color}</Text>
              </View>
            ) : null}
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Total</Text>
              <Text style={styles.metaValue} testID="order-total">
                {formatPriceIn(order.amount_cents, order.currency, user?.preferred_currency)}
              </Text>
            </View>
          </View>

          {/* Buyer try-on shortcut */}
          {isBuyer ? (
            <View style={styles.actionRow}>
              <TouchableOpacity
                testID="order-try-on-btn"
                style={styles.outlineBtn}
                onPress={() => router.push(`/item/${order.item_id}`)}
              >
                <Feather name="package" size={16} color={colors.primary} />
                <Text style={styles.outlineLabel}>View item</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="order-reorder-btn"
                style={styles.outlineBtn}
                onPress={() => router.push(`/item/${order.item_id}`)}
              >
                <Feather name="refresh-cw" size={16} color={colors.primary} />
                <Text style={styles.outlineLabel}>Buy again</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Seller card */}
          {order.seller ? (
            <View style={styles.section} testID="order-seller-card">
              <Text style={tp.caption}>Atelier</Text>
              <Text style={[tp.h3, { marginTop: spacing.sm }]} numberOfLines={2}>
                {order.seller.company_name || order.seller.full_name}
              </Text>
              {order.seller.location ? (
                <Text style={[tp.bodyMuted, { marginTop: 4 }]}>
                  <Feather name="map-pin" size={11} color={colors.mutedFg} />{" "}
                  {order.seller.location.city}, {order.seller.location.country}
                </Text>
              ) : null}
              {(isSeller || isAdmin) && order.seller.payout_summary ? (
                <Text style={[tp.bodyMuted, { marginTop: 8 }]}>
                  Payout · {order.seller.payout_summary}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Revenue split — seller + admin only */}
          {(isSeller || isAdmin) && order.status === "paid" ? (
            <View style={styles.section} testID="order-revenue-split">
              <Text style={tp.caption}>Revenue split</Text>
              <View style={[styles.metaRow, { marginTop: spacing.md }]}>
                <View style={styles.metaCell}>
                  <Text style={styles.metaLabel}>Gross</Text>
                  <Text style={styles.metaValue}>
                    {formatPriceIn(order.amount_cents, order.currency, user?.preferred_currency)}
                  </Text>
                </View>
                <View style={styles.metaCell}>
                  <Text style={styles.metaLabel}>Platform fee</Text>
                  <Text style={styles.metaValue} testID="order-platform-fee">
                    {formatPriceIn(order.platform_fee_cents, order.currency, user?.preferred_currency)}
                  </Text>
                </View>
                <View style={styles.metaCell}>
                  <Text style={styles.metaLabel}>Net to atelier</Text>
                  <Text style={[styles.metaValue, { color: colors.success }]} testID="order-net">
                    {formatPriceIn(order.seller_net_cents, order.currency, user?.preferred_currency)}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* Fit feedback — buyer only, paid orders only */}
          {canLeaveFeedback ? (
            <View style={styles.feedback} testID="order-feedback-block">
              <Text style={tp.caption}>How did it fit?</Text>
              <Text style={[tp.bodyMuted, { marginTop: 4, marginBottom: spacing.md }]}>
                {alreadyGaveFeedback
                  ? "Thanks — your feedback helps tune future Try-Ons. You can update it any time."
                  : "Tap a rating below. Optional comment helps the atelier learn."}
              </Text>
              <View style={styles.fitRow}>
                {FIT_OPTIONS.map((f) => {
                  const active = fit === f.key;
                  return (
                    <TouchableOpacity
                      key={f.key}
                      testID={`order-fit-${f.key}`}
                      onPress={() => setFit(f.key)}
                      style={[styles.fitChip, active && styles.fitChipActive]}
                      activeOpacity={0.85}
                    >
                      <Feather
                        name={f.icon}
                        size={20}
                        color={active ? colors.primaryFg : colors.primary}
                      />
                      <Text
                        style={[
                          styles.fitLabel,
                          active && styles.fitLabelActive,
                        ]}
                      >
                        {f.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={[tp.caption, { marginTop: spacing.lg }]}>Comment (optional)</Text>
              <TextInput
                testID="order-fit-comment"
                value={comment}
                onChangeText={setComment}
                multiline
                numberOfLines={3}
                placeholder="e.g. Runs slim in the chest, length spot-on."
                placeholderTextColor={colors.mutedFg}
                style={styles.commentInput}
              />
              <TouchableOpacity
                testID="order-submit-feedback"
                onPress={submit}
                disabled={!fit || submitting}
                activeOpacity={0.85}
                style={[styles.submitBtn, (!fit || submitting) && { opacity: 0.45 }]}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.primaryFg} />
                ) : (
                  <Text style={styles.submitLabel}>
                    {alreadyGaveFeedback ? "UPDATE FEEDBACK" : "SUBMIT FEEDBACK"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          ) : isBuyer && order.status !== "paid" ? (
            <View style={styles.section}>
              <Text style={[tp.bodyMuted]}>
                Fit feedback unlocks once your order is marked paid.
              </Text>
            </View>
          ) : isSeller && order.fit_feedback ? (
            <View style={styles.section} testID="order-buyer-feedback">
              <Text style={tp.caption}>Buyer fit feedback</Text>
              <Text style={[styles.metaValue, { marginTop: 8, textTransform: "capitalize" }]}>
                {order.fit_feedback === "small"
                  ? "Too small"
                  : order.fit_feedback === "large"
                    ? "Too big"
                    : "True to size"}
              </Text>
            </View>
          ) : null}

          <View style={{ height: spacing.xxl }} />
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: { width: 32, height: 32, justifyContent: "center", alignItems: "center" },
  scroll: { paddingBottom: spacing.xxl },
  hero: { width: "100%", aspectRatio: 1, backgroundColor: colors.muted },
  heroPlaceholder: { alignItems: "center", justifyContent: "center" },
  contentWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  statusPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: spacing.md,
  },
  statusText: { fontFamily: fonts.bodySemi, fontSize: 11, letterSpacing: 1.4 },
  itemName: { marginTop: 6 },
  metaRow: {
    flexDirection: "row",
    marginTop: spacing.lg,
    gap: spacing.lg,
    flexWrap: "wrap",
  },
  metaCell: { minWidth: 70 },
  metaLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.mutedFg,
    textTransform: "uppercase",
  },
  metaValue: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.primary, marginTop: 4 },
  actionRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xl },
  outlineBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  outlineLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary },
  section: {
    marginTop: spacing.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  feedback: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  fitRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  fitChip: {
    flex: 1,
    minWidth: 100,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  fitChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  fitLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
    letterSpacing: 0.6,
  },
  fitLabelActive: { color: colors.primaryFg },
  commentInput: {
    marginTop: 8,
    minHeight: 80,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.primary,
    textAlignVertical: "top",
  },
  submitBtn: {
    marginTop: spacing.lg,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  submitLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.primaryFg,
  },
});

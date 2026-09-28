// Rich, role-aware order detail screen with post-purchase fit feedback step.

import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";

import { OrderTimeline } from "@/src/components/OrderTimeline";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { api, FitFeedback, OrderDetail } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { confirmDialog } from "@/src/lib/confirm";
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
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pollTimer = useRef<any>(null);

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

  // Live polling — while the order is in an "in-flight" state, refresh
  // it every 30s so buyers see status changes without a manual reload.
  useEffect(() => {
    if (!order) return;
    const inflight = new Set([
      "paid",
      "in_fulfillment",
      "shipped",
      "delivered",
    ]);
    const shouldPoll =
      inflight.has(order.status) && !order.buyer_confirmed_at && !order.dispute_raised_at;
    if (!shouldPoll) {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }
    if (pollTimer.current) return; // already polling
    pollTimer.current = setInterval(() => {
      load();
    }, 30000);
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.status, order?.buyer_confirmed_at, order?.dispute_raised_at]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const submitReport = async () => {
    if (!order) return;
    const reason = reportReason.trim();
    if (reason.length < 6) {
      toast.show("Please describe the problem (min 6 characters)", "error");
      return;
    }
    setReportSubmitting(true);
    try {
      const updated = await api.reportProblem(order.id, reason);
      setOrder(updated);
      setReportOpen(false);
      setReportReason("");
      toast.show("Problem reported. Payment is on hold pending review.", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't report the problem", "error");
    } finally {
      setReportSubmitting(false);
    }
  };

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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
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

          {/* Delivery timeline */}
          {order.status !== "pending" && order.status !== "cancelled" && order.status !== "failed" ? (
            <View style={styles.section} testID="order-tracking-section">
              <Text style={tp.caption}>DELIVERY TIMELINE</Text>
              <OrderTimeline order={order} />

              {/* Courier delivery card — rider status, call button, and the
                  buyer's 4-digit handover code (proof of delivery). */}
              {order.courier || (isBuyer && order.handover_code) ? (
                <View style={styles.courierCard} testID="order-courier-card">
                  <View style={styles.trackingHeader}>
                    <Feather name="truck" size={16} color={colors.primary} />
                    <Text style={styles.trackingCarrier}>
                      {order.self_delivery
                        ? order.status === "delivered"
                          ? "Delivered by your seller"
                          : "Out for delivery — your seller is bringing it"
                        : !order.courier || order.courier.status === "open"
                          ? "Looking for a rider…"
                          : order.courier.status === "accepted"
                            ? "Rider assigned — pickup soon"
                            : order.courier.status === "picked_up"
                              ? "Rider has your parcel"
                              : order.courier.status === "out_for_delivery"
                                ? "Out for delivery — rider on the way"
                                : "Delivered by Oromona Rider"}
                    </Text>
                  </View>
                  {order.courier?.rider_name ? (
                    <View style={styles.courierRiderRow}>
                      <Feather name="user" size={14} color={colors.mutedFg} />
                      <Text style={styles.courierRiderName}>{order.courier.rider_name}</Text>
                      {isBuyer && order.courier.rider_phone ? (
                        <TouchableOpacity
                          testID="order-call-rider-btn"
                          onPress={() => Linking.openURL(`tel:${order.courier?.rider_phone}`)}
                          style={styles.courierCallBtn}
                        >
                          <Feather name="phone" size={12} color={colors.primaryFg} />
                          <Text style={styles.courierCallLabel}>CALL RIDER</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}
                  {isBuyer &&
                  order.handover_code &&
                  order.status !== "delivered" &&
                  order.courier?.status !== "delivered" ? (
                    <View style={styles.handoverBox} testID="order-handover-code">
                      <Text style={styles.handoverLabel}>
                        HANDOVER CODE — give this to{" "}
                        {order.self_delivery ? "your seller" : "the rider"}
                      </Text>
                      <Text style={styles.handoverCode} selectable>
                        {order.handover_code}
                      </Text>
                      <Text style={styles.handoverHint}>
                        {order.self_delivery
                          ? "Your seller enters this code to complete the delivery —"
                          : "The rider enters this code to complete your delivery —"}{" "}
                        only share it once the parcel is in your hands.
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Tracking card */}
              {order.tracking_number ? (
                <View style={styles.trackingCard} testID="order-tracking-card">
                  <View style={styles.trackingHeader}>
                    <Feather name="package" size={16} color={colors.primary} />
                    <Text style={styles.trackingCarrier}>
                      {order.carrier || "External carrier"}
                    </Text>
                  </View>
                  <View style={styles.trackingNumberRow}>
                    <Text style={styles.trackingNumber} selectable>
                      {order.tracking_number}
                    </Text>
                    <TouchableOpacity
                      testID="order-copy-tracking"
                      onPress={async () => {
                        await Clipboard.setStringAsync(order.tracking_number || "");
                        toast.show("Tracking number copied", "success");
                      }}
                      style={styles.copyBtn}
                    >
                      <Feather name="copy" size={14} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                  {order.tracking_url ? (
                    <TouchableOpacity
                      testID="order-track-carrier-btn"
                      onPress={() => Linking.openURL(order.tracking_url as string)}
                      style={styles.trackingBtn}
                    >
                      <Feather name="external-link" size={14} color={colors.primaryFg} />
                      <Text style={styles.trackingBtnLabel}>Track with carrier</Text>
                    </TouchableOpacity>
                  ) : null}
                  {order.estimated_delivery_at ? (
                    <Text style={styles.trackingEta}>
                      Est. delivery ·{" "}
                      {new Date(order.estimated_delivery_at).toLocaleDateString(undefined, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </Text>
                  ) : null}
                  {order.fulfillment_note ? (
                    <Text style={styles.trackingNote}>{`"${order.fulfillment_note}"`}</Text>
                  ) : null}
                </View>
              ) : null}

              {/* Buyer actions during tracking */}
              {isBuyer ? (
                <View style={styles.trackingActions}>
                  {/* Shipped/delivered → confirm receipt (releases escrow immediately) */}
                  {(order.status === "shipped" || order.status === "delivered") &&
                    !order.buyer_confirmed_at &&
                    !order.dispute_raised_at ? (
                    <TouchableOpacity
                      testID="order-confirm-delivery-btn"
                      style={styles.primaryBtn}
                      onPress={() => {
                        confirmDialog({
                          title: "Received your item?",
                          message:
                            "Confirming releases payment to the seller immediately. Only do this if you've received the item and are happy with it.",
                          confirmLabel: "Confirm",
                          onConfirm: async () => {
                            try {
                              const updated = await api.confirmDelivery(order.id);
                              setOrder(updated);
                              toast.show("Payment released to seller — thanks!", "success");
                            } catch (e: any) {
                              toast.show(e?.message ?? "Couldn't confirm", "error");
                            }
                          },
                        });
                      }}
                    >
                      <Feather name="check" size={16} color={colors.primaryFg} />
                      <Text style={styles.primaryBtnLabel}>I received my item</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Shipped/delivered but not yet confirmed → report problem */}
                  {(order.status === "shipped" || order.status === "delivered") &&
                    !order.buyer_confirmed_at &&
                    !order.dispute_raised_at ? (
                    <TouchableOpacity
                      testID="order-report-problem-btn"
                      style={styles.dangerBtn}
                      onPress={() => setReportOpen(true)}
                    >
                      <Feather name="alert-triangle" size={16} color={colors.error} />
                      <Text style={styles.dangerBtnLabel}>Report a problem</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Paid/packing/shipped → nudge seller */}
                  {(order.status === "paid" ||
                    order.status === "in_fulfillment" ||
                    order.status === "shipped") ? (
                    <TouchableOpacity
                      testID="order-notify-seller-btn"
                      style={styles.outlineBtn}
                      onPress={async () => {
                        try {
                          await api.notifySeller(order.id);
                          toast.show("Seller notified — they'll get back to you soon", "success");
                          load();
                        } catch (e: any) {
                          toast.show(e?.message ?? "Couldn't notify seller", "error");
                        }
                      }}
                    >
                      <Feather name="bell" size={16} color={colors.primary} />
                      <Text style={styles.outlineLabel}>Nudge seller</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}

              {/* Escrow status banner */}
              {order.dispute_raised_at ? (
                <View style={[styles.escrowBanner, styles.escrowBannerDispute]} testID="order-escrow-dispute">
                  <Feather name="alert-triangle" size={14} color={colors.error} />
                  <Text style={styles.escrowBannerText}>
                    Problem reported · payment held pending resolution
                  </Text>
                </View>
              ) : order.buyer_confirmed_at ? (
                <View style={[styles.escrowBanner, styles.escrowBannerSuccess]} testID="order-escrow-confirmed">
                  <Feather name="check-circle" size={14} color="#059669" />
                  <Text style={styles.escrowBannerText}>
                    You confirmed delivery · payment released to seller
                  </Text>
                </View>
              ) : order.status === "delivered" && order.escrow_release_at ? (
                <View style={[styles.escrowBanner, styles.escrowBannerHold]} testID="order-escrow-hold">
                  <Feather name="clock" size={14} color={colors.primary} />
                  <Text style={styles.escrowBannerText}>
                    Payment releases automatically on{" "}
                    {new Date(order.escrow_release_at).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

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

      {/* Report a problem modal */}
      <Modal
        visible={reportOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setReportOpen(false)}
      >
        <Pressable style={reportStyles.backdrop} onPress={() => setReportOpen(false)}>
          <Pressable style={reportStyles.sheet} onPress={() => {}}>
            <View style={reportStyles.header}>
              <Feather name="alert-triangle" size={20} color={colors.error} />
              <Text style={reportStyles.title}>Report a problem</Text>
              <TouchableOpacity onPress={() => setReportOpen(false)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Feather name="x" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <Text style={reportStyles.body}>
              Tell the seller what went wrong (item not as described, missing pieces, damaged in transit, etc.). The
              payment stays held until this is resolved.
            </Text>
            <TextInput
              testID="order-report-reason"
              multiline
              placeholder="Describe the issue…"
              placeholderTextColor={colors.mutedFg}
              value={reportReason}
              onChangeText={setReportReason}
              style={reportStyles.input}
              maxLength={800}
            />
            <View style={reportStyles.actions}>
              <TouchableOpacity
                onPress={() => setReportOpen(false)}
                style={[reportStyles.btn, reportStyles.btnGhost]}
              >
                <Text style={reportStyles.btnGhostLabel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="order-report-submit"
                onPress={submitReport}
                disabled={reportSubmitting || reportReason.trim().length < 6}
                style={[
                  reportStyles.btn,
                  reportStyles.btnDanger,
                  reportSubmitting || reportReason.trim().length < 6 ? reportStyles.btnDisabled : null,
                ]}
              >
                {reportSubmitting ? (
                  <ActivityIndicator size="small" color={colors.primaryFg} />
                ) : (
                  <Text style={reportStyles.btnDangerLabel}>Send report</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  trackingCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  trackingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  trackingCarrier: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.primary,
    textTransform: "uppercase",
  },
  trackingNumberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  trackingNumber: {
    flex: 1,
    fontFamily: "SF Mono",
    fontSize: 14,
    color: colors.primary,
    letterSpacing: 0.4,
  },
  copyBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  trackingBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  trackingBtnLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    letterSpacing: 1,
    color: colors.primaryFg,
    textTransform: "uppercase",
  },
  trackingEta: {
    marginTop: 12,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
  },
  trackingNote: {
    marginTop: 6,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    fontStyle: "italic",
  },
  courierCard: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  courierRiderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.sm,
  },
  courierRiderName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary },
  courierCallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.primary,
  },
  courierCallLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primaryFg,
  },
  handoverBox: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.background,
    padding: spacing.md,
    alignItems: "center",
  },
  handoverLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.mutedFg,
  },
  handoverCode: {
    fontFamily: fonts.bodySemi,
    fontSize: 32,
    letterSpacing: 12,
    color: colors.primary,
    marginTop: 6,
  },
  handoverHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 16,
  },
  trackingActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: spacing.md,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexGrow: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  primaryBtnLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    letterSpacing: 0.8,
    color: colors.primaryFg,
  },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexGrow: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.background,
  },
  dangerBtnLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.error,
    letterSpacing: 0.5,
  },
  escrowBanner: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  escrowBannerHold: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  escrowBannerSuccess: {
    backgroundColor: "rgba(5, 150, 105, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(5, 150, 105, 0.35)",
  },
  escrowBannerDispute: {
    backgroundColor: "rgba(185, 28, 28, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(185, 28, 28, 0.35)",
  },
  escrowBannerText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.primary,
    lineHeight: 16,
  },
});

const reportStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 10, 10, 0.5)",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    backgroundColor: colors.background,
    borderRadius: 20,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  title: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 16,
    color: colors.primary,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.mutedFg,
    lineHeight: 19,
    marginBottom: 12,
  },
  input: {
    minHeight: 100,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.primary,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 14,
  },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhostLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.primary,
  },
  btnDanger: {
    backgroundColor: colors.error,
  },
  btnDangerLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primaryFg,
  },
  btnDisabled: { opacity: 0.5 },
});

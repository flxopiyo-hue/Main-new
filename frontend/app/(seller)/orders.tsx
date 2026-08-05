// Orders to Fulfill — seller's order management center.
//
// Each row represents a paid order. The seller flow:
//
//   • "Accept order"          → paid → in_fulfillment (buyer sees
//                               "Preparing"). Seller packs the parcel.
//   • "Package ready · Call rider" → opens a job on the Oromona rider
//                               board. Riders are notified ONLY at this
//                               moment. The rider's pickup flips the order
//                               to shipped; the buyer's 4-digit handover
//                               code (entered by the rider) marks it
//                               delivered and starts the 48h escrow timer.
//   • "Ship myself"           → for intercity/self-arranged shipping via
//                               an external carrier. Requires a
//                               tracking_number; only these self-shipped
//                               orders get a manual "Mark as delivered".
//
// The list is filterable by status; the default view shows everything
// EXCEPT cancelled/failed so the seller's attention naturally lands on
// work-to-do.

import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
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

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { useToast } from "@/src/components/Toast";
import { api, Order, OrderStatus } from "@/src/lib/api";
import { formatPrice } from "@/src/lib/currency";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

type FilterKey = "todo" | "all" | "paid" | "in_fulfillment" | "shipped" | "delivered";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "paid", label: "Paid" },
  { key: "in_fulfillment", label: "Preparing" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
  { key: "all", label: "All" },
];

// Visual chip styling per status — kept in sync with the buyer-facing
// status pill so both sides see identical language.
const STATUS_STYLE: Record<
  OrderStatus,
  { label: string; bg: string; fg: string }
> = {
  pending: { label: "Pending", bg: colors.muted, fg: colors.primary },
  paid: { label: "Paid", bg: "#FFD60A", fg: colors.primary },
  in_fulfillment: { label: "Preparing", bg: "#A5D8FF", fg: colors.primary },
  shipped: { label: "Shipped", bg: "#7B8FF5", fg: colors.primaryFg },
  delivered: { label: "Delivered", bg: colors.success, fg: colors.primaryFg },
  failed: { label: "Failed", bg: colors.error, fg: colors.primaryFg },
  cancelled: { label: "Cancelled", bg: colors.mutedFg, fg: colors.primaryFg },
};

interface ShipModalState {
  open: boolean;
  order: Order | null;
}

export default function SellerOrders() {
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("todo");
  const [shipModal, setShipModal] = useState<ShipModalState>({ open: false, order: null });

  const load = useCallback(async () => {
    try {
      const list = await api.sellerOrders();
      setOrders(list);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load orders", "error");
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

  const visible = useMemo(() => {
    if (filter === "all") return orders;
    if (filter === "todo") {
      // The default "to-do" bucket: anything still on us (paid +
      // in_fulfillment). Shipped and delivered are out of our hands.
      return orders.filter((o) => o.status === "paid" || o.status === "in_fulfillment");
    }
    return orders.filter((o) => o.status === filter);
  }, [orders, filter]);

  const buckets = useMemo(() => {
    const out = { paid: 0, in_fulfillment: 0, shipped: 0, delivered: 0 };
    for (const o of orders) {
      if (o.status in out) (out as any)[o.status] += 1;
    }
    return out;
  }, [orders]);

  const acknowledge = async (order: Order) => {
    setBusyId(order.id);
    try {
      await api.sellerUpdateFulfillment(order.id, { action: "acknowledge" });
      toast.show(`Order accepted — pack "${order.item_name}", then call a rider`, "success");
      await load();
    } catch (e: any) {
      toast.show(e?.message ?? "Could not update", "error");
    } finally {
      setBusyId(null);
    }
  };

  // Opens a job on the Oromona rider board — a boda rider picks up the
  // parcel and delivers it against the buyer's handover code.
  const requestCourier = async (order: Order) => {
    setBusyId(order.id);
    try {
      await api.sellerUpdateFulfillment(order.id, { action: "request_courier" });
      toast.show("Riders notified — hand the parcel over when the rider arrives", "success");
      await load();
    } catch (e: any) {
      toast.show(e?.message ?? "Could not request a rider", "error");
    } finally {
      setBusyId(null);
    }
  };

  const markDelivered = async (order: Order) => {
    setBusyId(order.id);
    try {
      await api.sellerUpdateFulfillment(order.id, { action: "deliver" });
      toast.show(`Marked "${order.item_name}" as delivered`, "success");
      await load();
    } catch (e: any) {
      toast.show(e?.message ?? "Could not update", "error");
    } finally {
      setBusyId(null);
    }
  };

  const submitShip = async (
    order: Order,
    tracking_number: string,
    tracking_url: string,
    estimated_delivery_days: number | null,
  ) => {
    setBusyId(order.id);
    try {
      await api.sellerUpdateFulfillment(order.id, {
        action: "ship",
        tracking_number,
        tracking_url: tracking_url || undefined,
        estimated_delivery_days: estimated_delivery_days || undefined,
      });
      toast.show(`Marked "${order.item_name}" as shipped`, "success");
      setShipModal({ open: false, order: null });
      await load();
    } catch (e: any) {
      toast.show(e?.message ?? "Could not mark as shipped", "error");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.center]} edges={["top"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        testID="seller-orders-scroll"
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
          <Text style={tp.caption}>SELLER PORTAL · ORDERS</Text>
          <Text style={[tp.h2, { marginTop: 4 }]}>Orders to fulfill</Text>
          <Text style={[tp.bodyMuted, { marginTop: 6 }]}>
            {buckets.paid + buckets.in_fulfillment > 0
              ? `${buckets.paid + buckets.in_fulfillment} order${buckets.paid + buckets.in_fulfillment === 1 ? "" : "s"} need your attention.`
              : "All caught up — every paid order is shipped or delivered."}
          </Text>
        </View>

        {/* Sticky new-order nudge — surfaces unacknowledged paid orders
            so the seller can't miss them when they open this tab. */}
        {buckets.paid > 0 ? (
          <View style={styles.newOrderBanner} testID="seller-orders-new-banner">
            <Feather name="bell" size={14} color={colors.primaryFg} />
            <Text style={styles.newOrderLabel}>
              {buckets.paid === 1
                ? "1 new order awaiting acknowledgement"
                : `${buckets.paid} new orders awaiting acknowledgement`}
            </Text>
            <TouchableOpacity
              testID="seller-orders-new-banner-jump"
              onPress={() => setFilter("paid")}
              activeOpacity={0.85}
              style={styles.newOrderCta}
            >
              <Text style={styles.newOrderCtaLabel}>OPEN</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((f) => {
            const active = f.key === filter;
            const count =
              f.key === "todo"
                ? buckets.paid + buckets.in_fulfillment
                : f.key === "all"
                  ? orders.length
                  : (buckets as any)[f.key] ?? 0;
            return (
              <TouchableOpacity
                key={f.key}
                testID={`seller-orders-filter-${f.key}`}
                onPress={() => setFilter(f.key)}
                style={[
                  styles.filterChip,
                  active ? styles.filterChipActive : styles.filterChipInactive,
                ]}
              >
                <Text
                  style={[
                    styles.filterLabel,
                    active ? styles.filterLabelActive : styles.filterLabelInactive,
                  ]}
                >
                  {f.label} · {count}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Orders list */}
        {visible.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="package" size={32} color={colors.mutedFg} />
            <Text style={[tp.h3, { marginTop: spacing.sm }]}>No orders here</Text>
            <Text style={[tp.bodyMuted, { textAlign: "center", marginTop: 4 }]}>
              Switch filter to see paid, shipped, or delivered orders.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {visible.map((o) => (
              <OrderRow
                key={o.id}
                order={o}
                busy={busyId === o.id}
                onAcknowledge={() => acknowledge(o)}
                onShip={() => setShipModal({ open: true, order: o })}
                onDeliver={() => markDelivered(o)}
                onRequestCourier={() => requestCourier(o)}
              />
            ))}
          </View>
        )}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>

      <ShipModal
        state={shipModal}
        busy={!!busyId}
        onCancel={() => setShipModal({ open: false, order: null })}
        onSubmit={(num, url, eta) => {
          if (shipModal.order) submitShip(shipModal.order, num, url, eta);
        }}
      />
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function OrderRow({
  order,
  busy,
  onAcknowledge,
  onShip,
  onDeliver,
  onRequestCourier,
}: {
  order: Order;
  busy: boolean;
  onAcknowledge: () => void;
  onShip: () => void;
  onDeliver: () => void;
  onRequestCourier: () => void;
}) {
  const [imgB64, setImgB64] = useState<string | null>(null);

  // Lazy-load the item image so the list stays light. We hit the
  // existing `/items/{id}` endpoint which already returns base64.
  React.useEffect(() => {
    let cancelled = false;
    api
      .getItem(order.item_id)
      .then((it) => {
        if (!cancelled) setImgB64(it.image_b64);
      })
      .catch(() => {
        if (!cancelled) setImgB64(null);
      });
    return () => {
      cancelled = true;
    };
  }, [order.item_id]);

  const status = order.status as OrderStatus;
  const sty = STATUS_STYLE[status] ?? STATUS_STYLE.paid;

  return (
    <View style={styles.row} testID={`seller-order-${order.id}`}>
      <View style={styles.rowHead}>
        {imgB64 ? (
          <Image
            source={{ uri: `data:image/png;base64,${imgB64}` }}
            style={styles.thumb}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumb, { backgroundColor: colors.muted }]} />
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.rowTitleRow}>
            <Text style={styles.rowName} numberOfLines={1}>
              {order.item_name}
            </Text>
            <View
              style={[styles.statusPill, { backgroundColor: sty.bg }]}
              testID={`seller-order-${order.id}-status`}
            >
              <Text style={[styles.statusLabel, { color: sty.fg }]}>
                {sty.label.toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={[tp.bodyMuted, { fontSize: 12 }]} numberOfLines={1}>
            Size {order.size}
            {order.color ? ` · ${order.color}` : ""}
            {" · "}
            {new Date(order.created_at).toLocaleDateString()}
          </Text>
          <Text style={styles.amount}>
            {formatPrice(order.amount_cents, order.currency)}
          </Text>
        </View>
      </View>

      {/* Tracking summary (if shipped) */}
      {order.tracking_number ? (
        <View style={styles.trackingBox} testID={`seller-order-${order.id}-tracking`}>
          <Feather name="truck" size={14} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.trackingLabel}>Tracking number</Text>
            <Text style={styles.trackingValue}>{order.tracking_number}</Text>
            {order.tracking_url ? (
              <Text
                style={styles.trackingUrl}
                numberOfLines={1}
                accessibilityLabel={`Carrier URL ${order.tracking_url}`}
              >
                {order.tracking_url}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Delivery method hint (Phase 1 courier system) */}
      {order.delivery_option === "pickup" ? (
        <View style={styles.deliveryHintRow} testID={`seller-order-${order.id}-pickup-hint`}>
          <Feather name="map-pin" size={13} color={colors.mutedFg} />
          <Text style={styles.deliveryHintText}>
            Buyer collects at the Nairobi CBD pickup point — drop the parcel there.
          </Text>
        </View>
      ) : order.courier_job_id ? (
        <View style={styles.deliveryHintRow} testID={`seller-order-${order.id}-courier-hint`}>
          <Feather name="truck" size={13} color={colors.mutedFg} />
          <Text style={styles.deliveryHintText}>
            Rider requested — keep the parcel ready for pickup.
          </Text>
        </View>
      ) : null}

      {/* Actions row */}
      <View style={styles.actions}>
        {(status === "paid" || status === "in_fulfillment") &&
        order.delivery_option !== "pickup" &&
        !order.courier_job_id ? (
          <TouchableOpacity
            testID={`seller-order-${order.id}-request-courier`}
            onPress={onRequestCourier}
            disabled={busy}
            style={[styles.actionBtn, styles.actionPrimary]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primaryFg} />
            ) : (
              <>
                <Feather name="truck" size={14} color={colors.primaryFg} />
                <Text style={styles.actionPrimaryLabel}>Request rider pickup</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
        {status === "paid" ? (
          <TouchableOpacity
            testID={`seller-order-${order.id}-acknowledge`}
            onPress={onAcknowledge}
            disabled={busy}
            style={[styles.actionBtn, styles.actionGhost]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Feather name="clock" size={14} color={colors.primary} />
                <Text style={styles.actionGhostLabel}>Acknowledge</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
        {(status === "paid" || status === "in_fulfillment") ? (
          <TouchableOpacity
            testID={`seller-order-${order.id}-ship`}
            onPress={onShip}
            disabled={busy}
            style={[styles.actionBtn, styles.actionPrimary]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primaryFg} />
            ) : (
              <>
                <Feather name="send" size={14} color={colors.primaryFg} />
                <Text style={styles.actionPrimaryLabel}>Mark as shipped</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
        {status === "shipped" ? (
          <TouchableOpacity
            testID={`seller-order-${order.id}-deliver`}
            onPress={onDeliver}
            disabled={busy}
            style={[styles.actionBtn, styles.actionGhost]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Feather name="check-circle" size={14} color={colors.primary} />
                <Text style={styles.actionGhostLabel}>Mark as delivered</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
        {status === "delivered" ? (
          <View style={styles.deliveredHint}>
            <Feather name="check-circle" size={14} color={colors.success} />
            <Text style={[tp.bodyMuted, { fontSize: 12 }]}>
              Delivered{" "}
              {order.delivered_at
                ? new Date(order.delivered_at).toLocaleDateString()
                : ""}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ShipModal({
  state,
  busy,
  onCancel,
  onSubmit,
}: {
  state: ShipModalState;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (
    tracking_number: string,
    tracking_url: string,
    estimated_delivery_days: number | null,
  ) => void;
}) {
  const [num, setNum] = useState("");
  const [url, setUrl] = useState("");
  const [eta, setEta] = useState<number | null>(2);

  React.useEffect(() => {
    if (state.open) {
      setNum("");
      setUrl("");
      setEta(2);
    }
  }, [state.open]);

  if (!state.order) return null;

  return (
    <Modal
      visible={state.open}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <Pressable style={styles.modalBackdrop} onPress={onCancel}>
        <Pressable
          style={styles.modalSheet}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.modalHandle} />
          <Text style={[tp.h3, { marginBottom: 6 }]}>Mark as shipped</Text>
          <Text style={[tp.bodyMuted, { marginBottom: spacing.md }]}>
            {state.order.item_name} · Size {state.order.size}
          </Text>
          <AppInput
            testID="seller-orders-ship-number"
            label="Tracking number"
            value={num}
            onChangeText={setNum}
            placeholder="e.g. SDX1234567KE"
          />
          <AppInput
            testID="seller-orders-ship-url"
            label="Carrier URL (optional)"
            value={url}
            onChangeText={setUrl}
            placeholder="https://carrier.com/track/SDX1234567KE"
            autoCapitalize="none"
            keyboardType="url"
          />
          <Text style={[tp.caption, { marginTop: 12, marginBottom: 8 }]}>
            EXPECTED DELIVERY (BUSINESS DAYS)
          </Text>
          <Text style={styles.etaHint}>
            Buyer sees this as a target date. Cap is 5 days for same-county deliveries.
          </Text>
          <View style={styles.etaRow}>
            {[1, 2, 3, 4, 5].map((d) => (
              <TouchableOpacity
                key={d}
                testID={`seller-ship-eta-${d}`}
                onPress={() => setEta(eta === d ? null : d)}
                style={[
                  styles.etaChip,
                  eta === d ? styles.etaChipActive : styles.etaChipInactive,
                ]}
              >
                <Text
                  style={[
                    styles.etaLabel,
                    eta === d ? styles.etaLabelActive : styles.etaLabelInactive,
                  ]}
                >
                  {d}d
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.modalActions}>
            <TouchableOpacity
              testID="seller-orders-ship-cancel"
              onPress={onCancel}
              style={[styles.modalBtn, styles.modalBtnGhost]}
            >
              <Text style={styles.modalGhostLabel}>CANCEL</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <AppButton
                testID="seller-orders-ship-submit"
                label="Confirm ship"
                onPress={() => onSubmit(num.trim(), url.trim(), eta)}
                loading={busy}
                disabled={!num.trim() || busy}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

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
  filterRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: 8,
  },
  newOrderBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.primary,
  },
  newOrderLabel: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 0.5,
    color: colors.primaryFg,
  },
  newOrderCta: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.primaryFg,
  },
  newOrderCtaLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.primary,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipInactive: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  filterLabelActive: { color: colors.primaryFg },
  filterLabelInactive: { color: colors.primary },
  list: { paddingHorizontal: spacing.lg, gap: spacing.md },
  row: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowHead: { flexDirection: "row", gap: spacing.md },
  thumb: { width: 64, height: 84 },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowName: {
    flex: 1,
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.primary,
  },
  amount: {
    marginTop: 6,
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.primary,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.2,
  },
  trackingBox: {
    flexDirection: "row",
    gap: 10,
    marginTop: spacing.md,
    padding: spacing.sm,
    backgroundColor: colors.muted,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  trackingLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.mutedFg,
    textTransform: "uppercase",
  },
  trackingValue: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
  },
  trackingUrl: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    ...(Platform.OS === "web" ? { textDecorationLine: "underline" as any } : {}),
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: spacing.md,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 40,
  },
  actionGhost: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  actionGhostLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.primary,
    textTransform: "uppercase",
  },
  actionPrimary: { backgroundColor: colors.primary },
  actionPrimaryLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.primaryFg,
    textTransform: "uppercase",
  },
  deliveredHint: { flexDirection: "row", gap: 6, alignItems: "center" },
  deliveryHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.muted,
  },
  deliveryHintText: { flex: 1, fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
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
    alignItems: "center",
  },
  modalBtn: {
    flex: 1,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnGhost: { borderWidth: 1, borderColor: colors.border },
  etaHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    marginBottom: 8,
  },
  etaRow: {
    flexDirection: "row",
    gap: 8,
  },
  etaChip: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  etaChipInactive: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  etaChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  etaLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  etaLabelInactive: { color: colors.primary },
  etaLabelActive: { color: colors.primaryFg },
  modalGhostLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.primary,
  },
});

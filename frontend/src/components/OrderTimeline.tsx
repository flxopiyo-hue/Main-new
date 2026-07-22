// Vertical delivery timeline shown on the buyer's order detail screen.
// Four stops: Paid → Packing → Shipped → Delivered — plus optional
// confirmation checkmark (buyer-confirmed) and a dispute flag if the
// buyer reported a problem within the 48h escrow window.
//
// Kept in its own component so the seller order screen can render the
// same visual on their side later without duplicating the layout.

import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Order } from "@/src/lib/api";
import { colors, fonts } from "@/src/lib/theme";

interface Step {
  key: "paid" | "in_fulfillment" | "shipped" | "delivered";
  label: string;
  at?: string | null;
  icon: keyof typeof Feather.glyphMap;
}

const STATE_ORDER: Step["key"][] = ["paid", "in_fulfillment", "shipped", "delivered"];

function fmt(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

export function OrderTimeline({ order }: { order: Order }) {
  const current = STATE_ORDER.indexOf(order.status as Step["key"]);
  const confirmed = !!order.buyer_confirmed_at;
  const disputed = !!order.dispute_raised_at;

  const steps: Step[] = [
    {
      key: "paid",
      label: "Payment received",
      at: order.created_at,
      icon: "credit-card",
    },
    {
      key: "in_fulfillment",
      label: "Seller packing",
      at: null, // acknowledged_at isn't surfaced on OrderOut yet
      icon: "package",
    },
    {
      key: "shipped",
      label: order.carrier
        ? `Shipped via ${order.carrier}`
        : "Shipped",
      at: order.shipped_at,
      icon: "truck",
    },
    {
      key: "delivered",
      label: disputed
        ? "Reported a problem"
        : confirmed
          ? "Delivery confirmed by you"
          : "Delivered",
      at: order.delivered_at,
      icon: disputed ? "alert-triangle" : confirmed ? "check-circle" : "map-pin",
    },
  ];

  return (
    <View style={styles.wrap} testID="order-timeline">
      {steps.map((step, i) => {
        const past = i < current || i === current;
        const isCurrent = i === current;
        const isDelivered = step.key === "delivered";
        const specialColor = disputed && isDelivered
          ? colors.error
          : confirmed && isDelivered
            ? "#059669"
            : past
              ? colors.primary
              : colors.border;
        const showConnector = i < steps.length - 1;
        return (
          <View key={step.key} style={styles.row}>
            <View style={styles.iconCol}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: past ? specialColor : colors.surface, borderColor: specialColor },
                ]}
              >
                <Feather
                  name={step.icon}
                  size={14}
                  color={past ? colors.primaryFg : colors.mutedFg}
                />
              </View>
              {showConnector ? (
                <View
                  style={[
                    styles.connector,
                    { backgroundColor: past && i + 1 <= current ? colors.primary : colors.border },
                  ]}
                />
              ) : null}
            </View>
            <View style={styles.textCol}>
              <Text
                style={[
                  styles.stepLabel,
                  isCurrent ? styles.stepLabelActive : past ? null : styles.stepLabelPending,
                ]}
                numberOfLines={2}
              >
                {step.label}
              </Text>
              {step.at ? (
                <Text style={styles.stepMeta}>{fmt(step.at)}</Text>
              ) : isCurrent && !past ? null : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 8 },
  row: { flexDirection: "row", alignItems: "flex-start", minHeight: 56 },
  iconCol: { alignItems: "center", width: 32 },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  connector: {
    flex: 1,
    width: 2,
    minHeight: 20,
    marginTop: 2,
    marginBottom: 2,
  },
  textCol: {
    flex: 1,
    marginLeft: 12,
    paddingTop: 4,
    paddingBottom: 12,
  },
  stepLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.primary,
  },
  stepLabelActive: {
    fontFamily: fonts.bodySemi,
    color: colors.primary,
  },
  stepLabelPending: {
    color: colors.mutedFg,
    fontFamily: fonts.body,
  },
  stepMeta: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    marginTop: 2,
  },
});

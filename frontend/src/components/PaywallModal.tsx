// Modal shown when the backend returns HTTP 402 (paywall). The Free
// tier hits this when:
//   • The buyer has already used all 7 try-ons in the last 7 days.
//   • The buyer tries to add a 3rd body profile.
//   • The buyer requests multi-angle output on the try-on flow.
//
// One-tap upgrade CTA that routes to /subscription. We keep the modal
// intentionally minimal — no dark patterns, no scarcity animations —
// just the reason we blocked them and the price of unblocking.

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, fonts, spacing } from "@/src/lib/theme";

interface Props {
  visible: boolean;
  feature?: string;
  message?: string;
  onClose: () => void;
}

const FEATURE_META: Record<string, { title: string; icon: keyof typeof Feather.glyphMap }> = {
  tryon_weekly_limit: { title: "You've hit your weekly try-on limit", icon: "clock" },
  profile_limit: { title: "You're at your profile limit", icon: "users" },
  multi_angle: { title: "Multi-angle try-ons are Premium", icon: "layers" },
};

export function PaywallModal({ visible, feature, message, onClose }: Props) {
  const meta = feature ? FEATURE_META[feature] : undefined;
  const title = meta?.title ?? "Upgrade to continue";
  const icon = meta?.icon ?? "star";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID="paywall-backdrop">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.iconWrap}>
            <Feather name={icon} size={22} color={colors.primary} />
          </View>
          <Text style={styles.eyebrow}>DRAPE PREMIUM</Text>
          <Text style={styles.title} testID="paywall-title">
            {title}
          </Text>
          {message ? (
            <Text style={styles.body} testID="paywall-message">
              {message}
            </Text>
          ) : null}
          <View style={styles.benefits}>
            <Benefit label="Unlimited try-ons" />
            <Benefit label="Up to 10 body profiles" />
            <Benefit label="AI multi-angle outfits" />
          </View>
          <TouchableOpacity
            testID="paywall-upgrade"
            onPress={() => {
              onClose();
              router.push("/subscription");
            }}
            activeOpacity={0.85}
            style={styles.upgrade}
          >
            <Text style={styles.upgradeLabel}>UPGRADE — 7 days free</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="paywall-dismiss"
            onPress={onClose}
            style={styles.dismiss}
          >
            <Text style={styles.dismissLabel}>Not now</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Benefit({ label }: { label: string }) {
  return (
    <View style={styles.benefitRow}>
      <Feather name="check" size={12} color={colors.primary} />
      <Text style={styles.benefitLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10,10,10,0.6)",
    justifyContent: "flex-end",
    alignItems: "center",
    padding: 12,
  },
  sheet: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: colors.background,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    gap: spacing.md,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  eyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.mutedFg,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: colors.primary,
    textAlign: "center",
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: colors.mutedFg,
    textAlign: "center",
  },
  benefits: {
    alignSelf: "stretch",
    gap: 8,
    marginTop: 6,
  },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  benefitLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary },
  upgrade: {
    alignSelf: "stretch",
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: colors.primary,
    marginTop: spacing.md,
  },
  upgradeLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.6,
    color: colors.primaryFg,
  },
  dismiss: { paddingVertical: 10 },
  dismissLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.4,
    color: colors.mutedFg,
    textTransform: "uppercase",
  },
});

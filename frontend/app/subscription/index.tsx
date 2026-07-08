// Drape Premium pricing screen — the buyer's paywall + upgrade CTA.
// Reached from:
//   • Profile → "Upgrade to Premium" card
//   • Any paywall modal from the try-on flow (weekly cap hit) or the
//     profiles screen (2-profile cap hit)
//   • Direct navigation to `/subscription`
//
// UX flow:
//   1. GET /subs/me → hydrate current tier + benefits.
//   2. If premium already, show "Manage subscription" instead of Upgrade.
//   3. If free, tap Upgrade → POST /subs/checkout → open the Paystack
//      hosted URL in an in-app browser (native) or same-tab (web).
//   4. Paystack redirects back to `/subscription/success?reference=X`
//      which handles verification and flips the UI.

import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface MeData {
  tier: "free" | "premium";
  status: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  plan_amount_kes: number;
  trial_days: number;
}

const BENEFITS = [
  { icon: "zap", label: "Unlimited AI try-ons every week" },
  { icon: "layers", label: "AI-styled multi-angle outfit renders" },
  { icon: "users", label: "Up to 10 body profiles for family & clients" },
  { icon: "sliders", label: "Interactive live size slider with fit narration" },
  { icon: "award", label: "Priority Support" },
] as const;

export default function SubscriptionScreen() {
  const { refresh } = useAuth();
  const toast = useToast();
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.subsMe();
      setMe(data.subscription);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const startCheckout = async () => {
    setCheckoutBusy(true);
    try {
      const res = await api.subsCheckout();
      // On web, do a full-page redirect (Paystack's hosted checkout
      // doesn't play nice with iframes). On native, open in the
      // in-app browser and wait for the redirect callback.
      if (Platform.OS === "web") {
        window.location.href = res.authorization_url;
      } else {
        const callbackUrl = `${process.env.EXPO_PUBLIC_BACKEND_URL}/subscription/success`;
        const result = await WebBrowser.openAuthSessionAsync(
          res.authorization_url,
          callbackUrl,
        );
        // Result "success" means the callback URL was reached. The
        // buyer might still have cancelled the payment — verify it.
        if (result.type === "success" && result.url) {
          const u = new URL(result.url);
          const ref = u.searchParams.get("reference") || u.searchParams.get("trxref");
          if (ref) {
            router.replace(`/subscription/success?reference=${encodeURIComponent(ref)}`);
          }
        }
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Could not start checkout", "error");
    } finally {
      setCheckoutBusy(false);
    }
  };

  const cancelSub = async () => {
    setCancelBusy(true);
    try {
      await api.subsCancel();
      toast.show("Premium will end at period close", "success");
      await load();
      await refresh?.();
    } catch (e: any) {
      toast.show(e?.message ?? "Could not cancel", "error");
    } finally {
      setCancelBusy(false);
    }
  };

  const resumeSub = async () => {
    setCancelBusy(true);
    try {
      await api.subsResume();
      toast.show("Premium will renew automatically", "success");
      await load();
      await refresh?.();
    } catch (e: any) {
      toast.show(e?.message ?? "Could not resume", "error");
    } finally {
      setCancelBusy(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.center]} edges={["top"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const isPremium = me?.tier === "premium";
  const trialEnd = me?.trial_end ? new Date(me.trial_end) : null;
  const periodEnd = me?.current_period_end ? new Date(me.current_period_end) : null;
  const now = new Date();
  const inTrial = trialEnd ? trialEnd > now : false;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="sub-back-btn"
          onPress={() => router.back()}
          style={styles.iconBtn}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption}>DRAPE PREMIUM</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            <Feather name="star" size={12} color={colors.primaryFg} />
            <Text style={styles.heroBadgeLabel}>PREMIUM</Text>
          </View>
          <Text style={styles.heroTitle} testID="sub-title">
            {isPremium ? "You're on Premium." : "Unlock the full atelier."}
          </Text>
          <Text style={styles.heroPrice}>
            KSh {me?.plan_amount_kes ?? 199}
            <Text style={styles.heroPriceHint}> / month</Text>
          </Text>
          {!isPremium ? (
            <Text style={styles.heroTrial}>
              Start with a {me?.trial_days ?? 7}-day free trial. Cancel anytime — you keep Premium
              until the current period ends.
            </Text>
          ) : (
            <Text style={styles.heroTrial}>
              {me?.cancel_at_period_end
                ? `Cancels on ${periodEnd?.toLocaleDateString() ?? "period end"}.`
                : `Renews on ${periodEnd?.toLocaleDateString() ?? "next period"}.`}
              {inTrial && trialEnd ? `  Trial ends ${trialEnd.toLocaleDateString()}.` : ""}
            </Text>
          )}
        </View>

        <View style={styles.benefits}>
          {BENEFITS.map((b) => (
            <View key={b.label} style={styles.benefitRow}>
              <View style={styles.benefitIcon}>
                <Feather name={b.icon as any} size={14} color={colors.primary} />
              </View>
              <Text style={styles.benefitLabel}>{b.label}</Text>
            </View>
          ))}
        </View>

        {!isPremium ? (
          <TouchableOpacity
            testID="sub-upgrade-btn"
            onPress={startCheckout}
            disabled={checkoutBusy}
            style={[styles.upgradeBtn, checkoutBusy && { opacity: 0.6 }]}
            activeOpacity={0.85}
          >
            {checkoutBusy ? (
              <ActivityIndicator color={colors.primaryFg} />
            ) : (
              <>
                <Feather name="lock" size={14} color={colors.primaryFg} />
                <Text style={styles.upgradeLabel}>Start 7-day trial</Text>
              </>
            )}
          </TouchableOpacity>
        ) : me?.cancel_at_period_end ? (
          <TouchableOpacity
            testID="sub-resume-btn"
            onPress={resumeSub}
            disabled={cancelBusy}
            style={[styles.upgradeBtn, cancelBusy && { opacity: 0.6 }]}
            activeOpacity={0.85}
          >
            {cancelBusy ? (
              <ActivityIndicator color={colors.primaryFg} />
            ) : (
              <>
                <Feather name="refresh-cw" size={14} color={colors.primaryFg} />
                <Text style={styles.upgradeLabel}>Resume subscription</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            testID="sub-cancel-btn"
            onPress={cancelSub}
            disabled={cancelBusy}
            style={[styles.cancelBtn, cancelBusy && { opacity: 0.6 }]}
            activeOpacity={0.85}
          >
            {cancelBusy ? (
              <ActivityIndicator color={colors.error} />
            ) : (
              <Text style={styles.cancelLabel}>Cancel subscription</Text>
            )}
          </TouchableOpacity>
        )}

        <Text style={styles.fine} testID="sub-fine">
          Payment powered by Paystack. Charged in Kenyan Shillings. You can
          cancel any time from this screen.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  iconBtn: { padding: 8, minWidth: 40 },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  hero: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 12,
  },
  heroBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.primary,
  },
  heroBadgeLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.primaryFg,
  },
  heroTitle: {
    fontFamily: fonts.heading,
    fontSize: 26,
    color: colors.primary,
  },
  heroPrice: {
    fontFamily: fonts.heading,
    fontSize: 36,
    color: colors.primary,
  },
  heroPriceHint: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.mutedFg,
  },
  heroTrial: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: colors.mutedFg,
  },
  benefits: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  benefitIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  benefitLabel: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.primary,
  },
  upgradeBtn: {
    marginTop: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    backgroundColor: colors.primary,
  },
  upgradeLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    letterSpacing: 1.5,
    color: colors.primaryFg,
    textTransform: "uppercase",
  },
  cancelBtn: {
    marginTop: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surface,
  },
  cancelLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    letterSpacing: 1.5,
    color: colors.error,
    textTransform: "uppercase",
  },
  fine: {
    marginTop: spacing.lg,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    textAlign: "center",
    lineHeight: 16,
  },
});

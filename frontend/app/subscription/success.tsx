// Paystack payment-return screen. Paystack redirects the buyer here
// after completing the hosted checkout, passing a `reference` (or
// `trxref`) query param. We POST it to /api/subs/verify which
// double-checks against Paystack and flips the user to Premium.
//
// This screen is intentionally minimal — verify, celebrate briefly,
// then bounce back into the app.

import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

type Status = "verifying" | "success" | "failed";

export default function SubscriptionSuccess() {
  const params = useLocalSearchParams<{ reference?: string; trxref?: string }>();
  const reference =
    (typeof params.reference === "string" && params.reference) ||
    (typeof params.trxref === "string" && params.trxref) ||
    "";
  const { refresh } = useAuth();
  const [status, setStatus] = useState<Status>("verifying");
  const [message, setMessage] = useState("Verifying your payment with Paystack…");

  useEffect(() => {
    if (!reference) {
      setStatus("failed");
      setMessage("Missing reference — please retry from the subscription screen.");
      return;
    }
    (async () => {
      try {
        await api.subsVerify(reference);
        await refresh?.();
        setStatus("success");
        setMessage("Payment confirmed — Premium is yours.");
      } catch (e: any) {
        setStatus("failed");
        setMessage(e?.message ?? "Verification failed — please contact support.");
      }
    })();
  }, [reference, refresh]);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.card}>
        <View
          style={[
            styles.icon,
            {
              borderColor:
                status === "success"
                  ? colors.primary
                  : status === "failed"
                    ? colors.error
                    : colors.border,
            },
          ]}
          testID={`sub-verify-icon-${status}`}
        >
          {status === "verifying" ? (
            <ActivityIndicator color={colors.primary} />
          ) : status === "success" ? (
            <Feather name="check" size={30} color={colors.primary} />
          ) : (
            <Feather name="x" size={30} color={colors.error} />
          )}
        </View>
        <Text style={tp.caption}>OROMONA PREMIUM</Text>
        <Text style={styles.title} testID="sub-verify-title">
          {status === "verifying"
            ? "Verifying"
            : status === "success"
              ? "Welcome to Premium"
              : "Something went wrong"}
        </Text>
        <Text style={styles.body} testID="sub-verify-body">
          {message}
        </Text>
        {status !== "verifying" ? (
          <TouchableOpacity
            testID="sub-verify-cta"
            style={[
              styles.cta,
              { backgroundColor: status === "success" ? colors.primary : colors.surface, borderWidth: status === "success" ? 0 : 1, borderColor: colors.border },
            ]}
            onPress={() => router.replace(status === "success" ? "/(tabs)" : "/subscription")}
            activeOpacity={0.85}
          >
            <Text
              style={[
                styles.ctaLabel,
                { color: status === "success" ? colors.primaryFg : colors.primary },
              ]}
            >
              {status === "success" ? "START SHOPPING" : "TRY AGAIN"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 480,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: spacing.md,
  },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 26,
    color: colors.primary,
    textAlign: "center",
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.mutedFg,
    textAlign: "center",
    lineHeight: 22,
  },
  cta: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    minWidth: 200,
    alignItems: "center",
  },
  ctaLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
  },
});

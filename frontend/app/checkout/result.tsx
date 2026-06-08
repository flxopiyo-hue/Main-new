import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { api } from "@/src/lib/api";
import { colors, spacing, type as tp } from "@/src/lib/theme";

interface Status {
  status: string;
  item_name: string;
  amount_cents: number;
}

export default function CheckoutResult() {
  const { session_id, cancelled } = useLocalSearchParams<{
    session_id?: string;
    cancelled?: string;
  }>();
  const [status, setStatus] = useState<Status | null>(null);
  const [polling, setPolling] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    if (!session_id) {
      setPolling(false);
      setErr("Missing session id");
      return;
    }
    const tick = async () => {
      try {
        const s = await api.paymentStatus(String(session_id));
        setStatus(s);
        if (s.status === "paid" || s.status === "cancelled" || s.status === "failed") {
          setPolling(false);
          return;
        }
      } catch (e: any) {
        setErr(e?.message ?? "Failed to check status");
      }
      attempts.current += 1;
      if (attempts.current >= 12) {
        setPolling(false);
        return;
      }
      pollRef.current = setTimeout(tick, 2000);
    };
    tick();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [session_id]);

  const isCancelled = cancelled === "1" || status?.status === "cancelled";
  const isPaid = status?.status === "paid";

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.content} testID="checkout-result">
        {polling && !isCancelled ? (
          <>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[tp.h2, styles.title]}>Confirming…</Text>
            <Text style={[tp.bodyMuted, styles.sub]}>Finalising your order.</Text>
          </>
        ) : isPaid ? (
          <>
            <View style={styles.iconCircle}>
              <Feather name="check" size={32} color={colors.primaryFg} />
            </View>
            <Text style={[tp.h1, styles.title]} testID="checkout-success">
              You&apos;re in.
            </Text>
            <Text style={[tp.bodyMuted, styles.sub]}>
              {status?.item_name} · ${(status!.amount_cents / 100).toFixed(0)} paid.
            </Text>
          </>
        ) : isCancelled ? (
          <>
            <View style={[styles.iconCircle, styles.iconCancelled]}>
              <Feather name="x" size={32} color={colors.primaryFg} />
            </View>
            <Text style={[tp.h1, styles.title]} testID="checkout-cancelled">
              Order cancelled.
            </Text>
            <Text style={[tp.bodyMuted, styles.sub]}>
              No charge was made. You can try again any time.
            </Text>
          </>
        ) : (
          <>
            <View style={[styles.iconCircle, styles.iconCancelled]}>
              <Feather name="alert-triangle" size={28} color={colors.primaryFg} />
            </View>
            <Text style={[tp.h2, styles.title]}>Still waiting…</Text>
            <Text style={[tp.bodyMuted, styles.sub]}>
              {err ?? "We couldn't confirm payment yet. Check your orders shortly."}
            </Text>
          </>
        )}
        <View style={{ height: spacing.xl }} />
        <AppButton
          testID="checkout-result-back-btn"
          label="Back to home"
          onPress={() => router.replace("/(tabs)")}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  iconCircle: {
    width: 72,
    height: 72,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  iconCancelled: { backgroundColor: colors.mutedFg },
  title: { textAlign: "center", marginBottom: spacing.sm },
  sub: { textAlign: "center", maxWidth: 320 },
});

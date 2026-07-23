// Reset-password screen — entered via a link from the password-reset
// email. The route accepts `?token=…` (both a web fallback URL and the
// `oromona://reset-password?token=…` deep-link resolve here).
//
// Flow:
//   1. Parse token from `useLocalSearchParams`.
//   2. Ask for new password + confirmation.
//   3. Call `POST /api/auth/reset-password` — server invalidates old
//      sessions via token_version bump and returns a fresh JWT so we
//      sign the user in immediately.

import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { useToast } from "@/src/components/Toast";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function ResetPassword() {
  const toast = useToast();
  const { adoptSession } = useAuth();
  const params = useLocalSearchParams<{ token?: string | string[] }>();

  const token = useMemo(() => {
    const raw = params?.token;
    if (!raw) return "";
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const missingToken = !token || token.length < 8;

  const submit = async () => {
    if (missingToken) {
      toast.show("This reset link is invalid or missing a token", "error");
      return;
    }
    if (newPassword.length < 6) {
      toast.show("Password must be at least 6 characters", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.show("Passwords don't match", "error");
      return;
    }
    setLoading(true);
    try {
      const r = await api.resetPassword(token, newPassword);
      // Backend returns a fresh AuthEnvelope; sign the user in.
      await adoptSession(r);
      toast.show("Password updated — you're signed in", "success");
      // Route based on role. Sellers get the seller portal; buyers the
      // feed. Admins go to admin.
      const role = r.user?.role;
      if (role === "seller") {
        router.replace("/(seller)");
      } else if (role === "admin") {
        router.replace("/admin");
      } else {
        router.replace("/(tabs)");
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Password reset failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="reset-back-btn"
          onPress={() => router.replace("/(auth)/login")}
          style={styles.iconBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Image
          source={require("@/assets/brand/oromona-logo-transparent.png")}
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        bottomOffset={120}
      >
        <Text style={[tp.caption]}>PASSWORD RESET</Text>
        <Text style={[tp.h1, styles.title]}>Choose a new{"\n"}password.</Text>
        <Text style={[tp.bodyMuted, styles.sub]}>
          Once saved, we&apos;ll sign you in on this device and expire any
          other sessions.
        </Text>

        {missingToken ? (
          <View style={styles.errorCard} testID="reset-missing-token">
            <Feather
              name="alert-triangle"
              size={16}
              color={colors.error}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.errorText}>
              This reset link is missing or expired. Request a new one from
              the sign-in screen.
            </Text>
          </View>
        ) : null}

        <View style={{ height: spacing.xl }} />
        <AppInput
          testID="reset-new-password-input"
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          placeholder="At least 6 characters"
        />
        <AppInput
          testID="reset-confirm-password-input"
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          placeholder="Type it again"
        />
      </KeyboardAwareScrollView>

      <View style={styles.footer}>
        <AppButton
          testID="reset-submit-btn"
          label="Update password"
          onPress={submit}
          loading={loading}
          disabled={missingToken}
        />
        <TouchableOpacity
          onPress={() => router.replace("/(auth)/login")}
          style={styles.linkBtn}
        >
          <Text style={styles.link}>
            Changed your mind? <Text style={styles.linkBold}>Back to sign in</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  headerLogo: { width: 76, height: 32 },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  title: { marginTop: spacing.md },
  sub: { marginTop: spacing.md, maxWidth: 340 },
  errorCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: spacing.md,
    marginTop: spacing.lg,
    backgroundColor: "rgba(220, 38, 38, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(220, 38, 38, 0.35)",
    borderRadius: 8,
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.error,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  linkBtn: { paddingVertical: spacing.md, alignItems: "center" },
  link: { fontFamily: fonts.body, fontSize: 14, color: colors.mutedFg },
  linkBold: { fontFamily: fonts.bodySemi, color: colors.primary },
});

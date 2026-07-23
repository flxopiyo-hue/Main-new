// Forgot-password screen — buyer/seller enters their email, we call
// `POST /api/auth/forgot-password` which sends a reset link via Resend.
// The backend always returns a generic "if that email is registered…"
// response to prevent enumeration; we mirror that on the client with a
// single confirmation UI.

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
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
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function ForgotPassword() {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [debugLink, setDebugLink] = useState<string | null>(null);

  const submit = async () => {
    const em = email.trim();
    if (!em || !em.includes("@")) {
      toast.show("Enter a valid email", "error");
      return;
    }
    setLoading(true);
    try {
      const r = await api.forgotPassword(em);
      setSent(true);
      // In preview environments (no Resend key), the backend returns the
      // reset link directly so testers can complete the flow.
      if (r.debug_reset_link) setDebugLink(r.debug_reset_link);
    } catch (e: any) {
      toast.show(e?.message ?? "Something went wrong", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="forgot-back-btn"
          onPress={() => router.back()}
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
        {sent ? (
          <View testID="forgot-sent-view">
            <View style={styles.iconCircle}>
              <Feather name="mail" size={26} color={colors.primary} />
            </View>
            <Text style={[tp.h1, styles.title]}>Check your inbox</Text>
            <Text style={[tp.bodyMuted, styles.sub]}>
              If <Text style={styles.emailStrong}>{email.trim()}</Text> is
              registered with Oromona, we&apos;ve sent a password-reset link.
              The link expires in 30 minutes.
            </Text>
            <Text style={[tp.bodyMuted, { marginTop: spacing.md, fontSize: 12 }]}>
              Didn&apos;t get it? Check your spam folder, or try again with the
              email you actually used to sign up.
            </Text>
            {debugLink ? (
              <View style={styles.debugCard}>
                <Text style={styles.debugLabel}>DEV / PREVIEW MODE</Text>
                <Text style={styles.debugText}>
                  Resend isn&apos;t configured on this environment. Open the
                  link below to complete the flow:
                </Text>
                <Text
                  testID="forgot-debug-link"
                  selectable
                  style={styles.debugLink}
                >
                  {debugLink}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <>
            <Text style={[tp.caption]}>PASSWORD RESET</Text>
            <Text style={[tp.h1, styles.title]}>Forgot your{"\n"}password?</Text>
            <Text style={[tp.bodyMuted, styles.sub]}>
              Enter the email you used to sign up. We&apos;ll email you a
              secure link to choose a new password.
            </Text>
            <View style={{ height: spacing.xl }} />
            <AppInput
              testID="forgot-email-input"
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="you@example.com"
            />
          </>
        )}
      </KeyboardAwareScrollView>

      <View style={styles.footer}>
        {sent ? (
          <AppButton
            testID="forgot-done-btn"
            label="Back to sign in"
            onPress={() => router.replace("/(auth)/login")}
          />
        ) : (
          <AppButton
            testID="forgot-submit-btn"
            label="Send reset link"
            onPress={submit}
            loading={loading}
          />
        )}
        <TouchableOpacity
          onPress={() => router.replace("/(auth)/login")}
          style={styles.linkBtn}
        >
          <Text style={styles.link}>
            Remembered it? <Text style={styles.linkBold}>Sign in</Text>
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
  emailStrong: { fontFamily: fonts.bodySemi, color: colors.primary },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  debugCard: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 8,
  },
  debugLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.mutedFg,
  },
  debugText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
    marginTop: 6,
    lineHeight: 17,
  },
  debugLink: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.primary,
    marginTop: 8,
    lineHeight: 15,
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

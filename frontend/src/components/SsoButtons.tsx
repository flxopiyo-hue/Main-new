// SSO button strip — Google + (iOS only) Apple.
//
// Rendered ABOVE the email/password inputs on the login and register
// screens. On non-iOS platforms the Apple button is hidden; Google
// works everywhere (Expo Go, native builds, web) because the Emergent
// flow only relies on a system browser + custom-scheme deep link.

import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useToast } from "@/src/components/Toast";
import { User } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { isAppleSignInAvailable } from "@/src/lib/sso";
import { colors, fonts, spacing } from "@/src/lib/theme";

type Props = {
  onSuccess?: (user: User) => void;
  disabled?: boolean;
  // Small copy tweak so "Continue with X" reads naturally on the login
  // screen ("Sign in") and the register screen ("Sign up").
  mode?: "login" | "register";
};

export function SsoButtons({ onSuccess, disabled, mode = "login" }: Props) {
  const { loginWithGoogle, loginWithApple } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<"google" | "apple" | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = await isAppleSignInAvailable();
      if (alive) setAppleAvailable(ok);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleGoogle = async () => {
    if (busy || disabled) return;
    setBusy("google");
    try {
      const u = await loginWithGoogle();
      if (u) onSuccess?.(u);
    } catch (e: any) {
      toast.show(e?.message ?? "Google sign-in failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const handleApple = async () => {
    if (busy || disabled) return;
    setBusy("apple");
    try {
      const u = await loginWithApple();
      if (u) onSuccess?.(u);
    } catch (e: any) {
      toast.show(e?.message ?? "Apple sign-in failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const label = mode === "register" ? "Sign up" : "Continue";

  return (
    <View style={styles.wrap}>
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or {label.toLowerCase()} with</Text>
        <View style={styles.dividerLine} />
      </View>

      <TouchableOpacity
        testID="sso-google-btn"
        accessibilityRole="button"
        accessibilityLabel={`${label} with Google`}
        onPress={handleGoogle}
        disabled={!!busy || disabled}
        activeOpacity={0.85}
        style={[styles.btn, styles.btnLight, (busy || disabled) && styles.btnDisabled]}
      >
        {busy === "google" ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <>
            <Ionicons name="logo-google" size={18} color="#4285F4" />
            <Text style={styles.labelDark}>{label} with Google</Text>
          </>
        )}
      </TouchableOpacity>

      {appleAvailable && Platform.OS === "ios" ? (
        <TouchableOpacity
          testID="sso-apple-btn"
          accessibilityRole="button"
          accessibilityLabel={`${label} with Apple`}
          onPress={handleApple}
          disabled={!!busy || disabled}
          activeOpacity={0.85}
          style={[styles.btn, styles.btnDark, (busy || disabled) && styles.btnDisabled]}
        >
          {busy === "apple" ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="logo-apple" size={20} color="#fff" />
              <Text style={styles.labelLight}>{label} with Apple</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.mutedFg,
    textTransform: "uppercase",
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
  },
  btnLight: { backgroundColor: colors.surface, borderColor: colors.border },
  btnDark: { backgroundColor: "#000", borderColor: "#000" },
  btnDisabled: { opacity: 0.6 },
  labelDark: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    letterSpacing: 1.2,
    color: colors.primary,
    textTransform: "uppercase",
  },
  labelLight: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    letterSpacing: 1.2,
    color: "#fff",
    textTransform: "uppercase",
  },
});

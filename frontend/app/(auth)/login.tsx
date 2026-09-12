// Login screen with role chip selector.
//
// The user picks "Shopping" (buyer mode) or "Selling" (seller mode) before
// hitting submit. The chip is purely an intent — it's forwarded to the API
// as `as_role`, and the backend either:
//
//   • flips the user's stored role (atomically, bumping `token_version`),
//   • or, if the user is targeting seller for the first time and the account
//     is missing the seller essentials (company_name + location), the API
//     responds with `needs_seller_onboarding: true`. We catch that flag and
//     route to `/seller/onboarding` so the user can complete the missing
//     fields without ever seeing a half-functional seller portal.
//
// Admins are unaffected by the chip selection — the backend keeps their role
// frozen as `admin` regardless of the chip choice.

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { StyleSheet, Image, Text, TouchableOpacity, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { SsoButtons } from "@/src/components/SsoButtons";
import { useToast } from "@/src/components/Toast";
import { useAuth } from "@/src/lib/auth";
import { diag } from "@/src/lib/boot-diag";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

type Intent = "buyer" | "seller";

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [intent, setIntent] = useState<Intent>("buyer");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    diag("login-mounted");
  }, []);

  const routeForUser = (u: { role: string }, needsSellerOnboarding = false) => {
    if (u.role === "admin") {
      router.replace("/admin");
      return;
    }
    if (needsSellerOnboarding) {
      router.replace("/seller-onboarding");
      return;
    }
    if (u.role === "seller") {
      router.replace("/(seller)");
    } else if (u.role === "courier") {
      router.replace("/(courier)");
    } else {
      router.replace("/(tabs)");
    }
  };

  const submit = async () => {
    if (!email.trim() || !password) {
      toast.show("Enter email and password", "error");
      return;
    }
    setLoading(true);
    try {
      const { user: u, needsSellerOnboarding } = await login(
        email.trim(),
        password,
        intent,
      );
      routeForUser(u, needsSellerOnboarding);
    } catch (e: any) {
      toast.show(e?.message ?? "Login failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="login-back-btn"
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
        bottomOffset={24}
      >
        <Text style={[tp.h1, styles.title]}>Welcome{"\n"}back.</Text>
        <Text style={[tp.bodyMuted, styles.sub]}>
          Sign in to continue your try-on session.
        </Text>

        {/* Role intent chips */}
        <View style={{ height: spacing.lg }} />
        <Text style={[tp.caption, styles.label]}>I am</Text>
        <View style={styles.chipRow}>
          <IntentChip
            testID="login-intent-buyer"
            label="Shopping"
            icon="shopping-bag"
            active={intent === "buyer"}
            onPress={() => setIntent("buyer")}
          />
          <IntentChip
            testID="login-intent-seller"
            label="Selling"
            icon="briefcase"
            active={intent === "seller"}
            onPress={() => setIntent("seller")}
          />
        </View>
        <Text style={[tp.bodyMuted, styles.chipHint]}>
          {intent === "seller"
            ? "Land in the Seller Portal — inventory, analytics, and orders to fulfill."
            : "Land in the marketplace — browse pieces and try them on."}
        </Text>

        <View style={{ height: spacing.lg }} />
        <SsoButtons
          mode="login"
          disabled={loading}
          onSuccess={(u) => routeForUser(u, false)}
        />

        <View style={{ height: spacing.lg }} />
        <AppInput
          testID="login-email-input"
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          placeholder="you@example.com"
        />
        <AppInput
          testID="login-password-input"
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
        />
        <TouchableOpacity
          testID="login-forgot-password-link"
          onPress={() => router.push("/(auth)/forgot-password")}
          style={styles.forgotBtn}
        >
          <Text style={styles.forgotLabel}>Forgot password?</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
      <View style={styles.footer}>
        <AppButton testID="login-submit-btn" label="Sign In" onPress={submit} loading={loading} />
        <TouchableOpacity onPress={() => router.replace("/(auth)/register")} style={styles.linkBtn}>
          <Text style={styles.link} testID="login-go-register-link">
            New here? <Text style={styles.linkBold}>Create an account</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function IntentChip({
  label,
  icon,
  active,
  onPress,
  testID,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
    >
      <Feather
        name={icon}
        size={14}
        color={active ? colors.primaryFg : colors.primary}
      />
      <Text
        style={[
          styles.chipLabel,
          active ? styles.chipLabelActive : styles.chipLabelInactive,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
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
  iconBtn: { width: 32, height: 32, alignItems: "flex-start", justifyContent: "center" },
  headerLogo: { width: 76, height: 32 },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  title: { marginTop: spacing.md },
  sub: { marginTop: spacing.md, maxWidth: 320 },
  label: { marginBottom: 8 },
  chipRow: { flexDirection: "row", gap: 12 },
  chip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    minHeight: 48,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipInactive: { backgroundColor: colors.surface, borderColor: colors.border },
  chipLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  chipLabelActive: { color: colors.primaryFg },
  chipLabelInactive: { color: colors.primary },
  chipHint: {
    marginTop: 10,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  linkBtn: { paddingVertical: spacing.md, alignItems: "center" },
  forgotBtn: { alignSelf: "flex-end", marginTop: spacing.sm },
  forgotLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
    letterSpacing: 0.5,
  },
  link: { fontFamily: fonts.body, fontSize: 14, color: colors.mutedFg },
  linkBold: { fontFamily: fonts.bodySemi, color: colors.primary },
});

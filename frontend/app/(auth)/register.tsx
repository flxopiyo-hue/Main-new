import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { useToast } from "@/src/components/Toast";
import { Role } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("buyer");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!fullName.trim() || !email.trim() || !password) {
      toast.show("Please fill in all fields", "error");
      return;
    }
    if (password.length < 6) {
      toast.show("Password must be at least 6 characters", "error");
      return;
    }
    setLoading(true);
    try {
      const user = await register(email.trim(), password, fullName.trim(), role);
      if (user.role === "buyer") {
        router.replace("/onboarding/measurements");
      } else {
        router.replace("/(tabs)");
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Registration failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="register-back-btn"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[tp.caption]}>AURAFIT</Text>
        <View style={styles.iconBtn} />
      </View>
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        bottomOffset={24}
      >
        <Text style={[tp.h1, styles.title]}>Become{"\n"}a member.</Text>
        <Text style={[tp.bodyMuted, styles.sub]}>
          Two ways to join. Shop curated pieces or list your own atelier.
        </Text>
        <View style={{ height: spacing.xl }} />

        <Text style={[tp.caption, styles.label]}>I am a</Text>
        <View style={styles.roleRow}>
          <RoleCard
            testID="register-role-buyer"
            label="Buyer"
            sub="Find clothes that fit"
            selected={role === "buyer"}
            onPress={() => setRole("buyer")}
          />
          <RoleCard
            testID="register-role-seller"
            label="Seller"
            sub="List your designs"
            selected={role === "seller"}
            onPress={() => setRole("seller")}
          />
        </View>

        <View style={{ height: spacing.xl }} />
        <AppInput
          testID="register-name-input"
          label="Full Name"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          placeholder="Avery Lin"
        />
        <AppInput
          testID="register-email-input"
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          placeholder="you@example.com"
        />
        <AppInput
          testID="register-password-input"
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="At least 6 characters"
        />
      </KeyboardAwareScrollView>
      <View style={styles.footer}>
        <AppButton
          testID="register-submit-btn"
          label="Create Account"
          onPress={submit}
          loading={loading}
        />
        <TouchableOpacity onPress={() => router.replace("/(auth)/login")} style={styles.linkBtn}>
          <Text style={styles.link} testID="register-go-login-link">
            Already a member? <Text style={styles.linkBold}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

interface RoleCardProps {
  label: string;
  sub: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}

function RoleCard({ label, sub, selected, onPress, testID }: RoleCardProps) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      style={[styles.roleCard, selected && styles.roleCardActive]}
      activeOpacity={0.85}
    >
      <Text style={[styles.roleLabel, selected && styles.roleLabelActive]}>{label}</Text>
      <Text style={[styles.roleSub, selected && styles.roleSubActive]}>{sub}</Text>
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
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  title: { marginTop: spacing.md },
  sub: { marginTop: spacing.md, maxWidth: 320 },
  label: { marginBottom: spacing.sm },
  roleRow: { flexDirection: "row", gap: spacing.md },
  roleCard: {
    flex: 1,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  roleCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  roleLabel: { fontFamily: fonts.heading, fontSize: 22, color: colors.primary },
  roleLabelActive: { color: colors.primaryFg },
  roleSub: { fontFamily: fonts.body, fontSize: 13, color: colors.mutedFg, marginTop: 4 },
  roleSubActive: { color: "#D4D4D4" },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  linkBtn: { paddingVertical: spacing.md, alignItems: "center" },
  link: { fontFamily: fonts.body, fontSize: 14, color: colors.mutedFg },
  linkBold: { fontFamily: fonts.bodySemi, color: colors.primary },
});

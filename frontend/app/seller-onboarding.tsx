// Seller onboarding — 1-screen form a buyer fills to unlock the seller
// portal. The screen is reached either:
//   a) Right after login when the user picked "Selling" but their account
//      had no company_name yet (server returned needs_seller_onboarding).
//   b) From the buyer's Profile screen when they tap "Switch to Seller
//      Mode" for the first time.
//
// On submit we call `toggleRole({ to: "seller", company_name, location })`
// which atomically populates the missing fields, flips the role, issues a
// fresh JWT (old session invalidated via token_version bump) and returns
// the updated user. We then route into /(seller).

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
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
import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function SellerOnboarding() {
  const { user, toggleRole, logout } = useAuth();
  const toast = useToast();

  const [companyName, setCompanyName] = useState(user?.company_name ?? "");
  const [city, setCity] = useState(user?.location?.city ?? "");
  const [country, setCountry] = useState(user?.location?.country ?? "");
  const [bankName, setBankName] = useState(user?.bank_details?.bank_name ?? "");
  const [accountNumber, setAccountNumber] = useState(
    user?.bank_details?.account_number ?? "",
  );
  const [mpesaPaybill, setMpesaPaybill] = useState(
    user?.bank_details?.mpesa_paybill ?? "",
  );
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!companyName.trim()) {
      toast.show("Company name is required", "error");
      return;
    }
    if (!city.trim() || !country.trim()) {
      toast.show("City and country are required", "error");
      return;
    }
    setSubmitting(true);
    try {
      await toggleRole({
        to: "seller",
        company_name: companyName.trim(),
        location: { city: city.trim(), country: country.trim() },
        bank_details: {
          bank_name: bankName.trim() || null,
          account_number: accountNumber.trim() || null,
          mpesa_paybill: mpesaPaybill.trim() || null,
        },
      });
      toast.show("Welcome to the Seller Portal", "success");
      router.replace("/(seller)");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not switch to seller mode", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    const choose = async () => {
      // If they bailed before completing onboarding their role is still
      // whatever it was — we just send them back to login / their portal.
      if (user?.role === "seller") {
        router.replace("/(seller)");
        return;
      }
      if (user?.role === "buyer") {
        router.replace("/(tabs)");
        return;
      }
      await logout();
      router.replace("/welcome");
    };
    if (Platform.OS === "web") {
      const ok = window.confirm(
        "Cancel seller onboarding? You can finish this any time from Profile → Switch to Seller Mode.",
      );
      if (ok) await choose();
      return;
    }
    Alert.alert(
      "Cancel seller onboarding?",
      "You can finish this any time from Profile → Switch to Seller Mode.",
      [
        { text: "Stay", style: "cancel" },
        { text: "Cancel", style: "destructive", onPress: choose },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="seller-onboarding-cancel-btn"
          onPress={cancel}
          style={styles.iconBtn}
        >
          <Feather name="x" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption}>SELLER ONBOARDING</Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        bottomOffset={24}
      >
        <Text style={[tp.h1, styles.title]}>Tell us about{"\n"}your atelier.</Text>
        <Text style={[tp.bodyMuted, styles.sub]}>
          We need a company name and your city so buyers know who they're
          ordering from. Payout details are optional — you can add them later
          in Settings.
        </Text>

        <View style={{ height: spacing.xl }} />

        <Text style={[tp.caption, styles.section]}>Atelier</Text>
        <AppInput
          testID="seller-onboarding-company"
          label="Company name"
          value={companyName}
          onChangeText={setCompanyName}
          placeholder="Maison Lumière"
        />
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <AppInput
              testID="seller-onboarding-city"
              label="City"
              value={city}
              onChangeText={setCity}
              placeholder="Nairobi"
            />
          </View>
          <View style={{ flex: 1 }}>
            <AppInput
              testID="seller-onboarding-country"
              label="Country"
              value={country}
              onChangeText={setCountry}
              placeholder="Kenya"
            />
          </View>
        </View>

        <Text style={[tp.caption, styles.section]}>Payouts (optional)</Text>
        <Text style={[tp.bodyMuted, { marginBottom: spacing.sm }]}>
          You can finish this any time from Settings → Payouts.
        </Text>
        <AppInput
          testID="seller-onboarding-bank"
          label="Bank name"
          value={bankName}
          onChangeText={setBankName}
          placeholder="Equity Bank"
        />
        <AppInput
          testID="seller-onboarding-account"
          label="Account number"
          value={accountNumber}
          onChangeText={setAccountNumber}
          placeholder="0123456789"
          keyboardType="number-pad"
        />
        <AppInput
          testID="seller-onboarding-paybill"
          label="M-Pesa Paybill"
          value={mpesaPaybill}
          onChangeText={setMpesaPaybill}
          placeholder="247247"
          keyboardType="number-pad"
        />
      </KeyboardAwareScrollView>

      <View style={styles.footer}>
        <AppButton
          testID="seller-onboarding-submit-btn"
          label="Enter Seller Portal"
          onPress={submit}
          loading={submitting}
        />
        {submitting ? (
          <View style={{ alignItems: "center", marginTop: spacing.sm }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
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
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: { marginTop: spacing.md },
  sub: { marginTop: spacing.md, maxWidth: 400 },
  section: { marginTop: spacing.lg, marginBottom: spacing.sm },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});

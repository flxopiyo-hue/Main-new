import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { DobPicker } from "@/src/components/DobPicker";
import { useToast } from "@/src/components/Toast";
import { Gender, Role } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const GENDERS: { key: Gender; label: string }[] = [
  { key: "female", label: "Female" },
  { key: "male", label: "Male" },
  { key: "other", label: "Other" },
  { key: "prefer_not_to_say", label: "Prefer not to say" },
];

const computeAge = (dob: Date): number => {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
};

const formatDob = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const formatDobDisplay = (d: Date): string =>
  d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

export default function Register() {
  const { registerBuyer, registerSeller } = useAuth();
  const toast = useToast();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("buyer");
  const [loading, setLoading] = useState(false);

  // Buyer-only fields
  const [gender, setGender] = useState<Gender | null>(null);
  const [dob, setDob] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  // Seller-only fields
  const [companyName, setCompanyName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("Kenya");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [mpesaPaybill, setMpesaPaybill] = useState("");
  const [mpesaTill, setMpesaTill] = useState("");

  const maxDob = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 13);
    return d;
  }, []);
  const minDob = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 120);
    return d;
  }, []);

  const derivedAge = dob ? computeAge(dob) : null;

  const onDobConfirm = (selected: Date) => {
    setDob(selected);
    setShowPicker(false);
  };

  const submit = async () => {
    if (!fullName.trim() || !email.trim() || !password) {
      toast.show("Please fill in all required fields", "error");
      return;
    }
    if (password.length < 6) {
      toast.show("Password must be at least 6 characters", "error");
      return;
    }
    setLoading(true);
    try {
      if (role === "buyer") {
        if (!gender) {
          toast.show("Please select your gender", "error");
          setLoading(false);
          return;
        }
        if (!dob) {
          toast.show("Please pick your date of birth", "error");
          setLoading(false);
          return;
        }
        if (derivedAge !== null && derivedAge < 13) {
          toast.show("You must be at least 13 years old to use Oromona", "error");
          setLoading(false);
          return;
        }
        await registerBuyer(email.trim(), password, fullName.trim(), {
          gender,
          dob: formatDob(dob),
        });
        router.replace("/onboarding/measurements");
      } else {
        if (!companyName.trim()) {
          toast.show("Company name is required", "error");
          setLoading(false);
          return;
        }
        if (!city.trim() || !country.trim()) {
          toast.show("Please enter your city and country", "error");
          setLoading(false);
          return;
        }
        const bank_details =
          bankName.trim() ||
          accountName.trim() ||
          accountNumber.trim() ||
          mpesaPaybill.trim() ||
          mpesaTill.trim()
            ? {
                bank_name: bankName.trim() || undefined,
                account_name: accountName.trim() || undefined,
                account_number: accountNumber.trim() || undefined,
                mpesa_paybill: mpesaPaybill.trim() || undefined,
                mpesa_till: mpesaTill.trim() || undefined,
              }
            : undefined;
        await registerSeller(email.trim(), password, fullName.trim(), {
          company_name: companyName.trim(),
          location: { city: city.trim(), country: country.trim() },
          bank_details,
        });
        router.replace("/(seller)");
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
        <Text style={[tp.caption]}>OROMONA</Text>
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
          label={role === "seller" ? "Your full name" : "Full Name"}
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

        {role === "buyer" ? (
          <BuyerFields
            gender={gender}
            setGender={setGender}
            dob={dob}
            derivedAge={derivedAge}
            openPicker={() => setShowPicker(true)}
          />
        ) : (
          <SellerFields
            companyName={companyName}
            setCompanyName={setCompanyName}
            city={city}
            setCity={setCity}
            country={country}
            setCountry={setCountry}
            bankName={bankName}
            setBankName={setBankName}
            accountName={accountName}
            setAccountName={setAccountName}
            accountNumber={accountNumber}
            setAccountNumber={setAccountNumber}
            mpesaPaybill={mpesaPaybill}
            setMpesaPaybill={setMpesaPaybill}
            mpesaTill={mpesaTill}
            setMpesaTill={setMpesaTill}
          />
        )}

        {role === "buyer" ? (
          <DobPicker
            visible={showPicker}
            value={dob}
            minDate={minDob}
            maxDate={maxDob}
            onConfirm={onDobConfirm}
            onCancel={() => setShowPicker(false)}
          />
        ) : null}
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

interface BuyerFieldsProps {
  gender: Gender | null;
  setGender: (g: Gender) => void;
  dob: Date | null;
  derivedAge: number | null;
  openPicker: () => void;
}

function BuyerFields({ gender, setGender, dob, derivedAge, openPicker }: BuyerFieldsProps) {
  return (
    <>
      <Text style={[tp.caption, styles.label]}>Gender</Text>
      <View style={styles.genderRow}>
        {GENDERS.map((g) => {
          const selected = gender === g.key;
          return (
            <TouchableOpacity
              key={g.key}
              testID={`register-gender-${g.key}`}
              onPress={() => setGender(g.key)}
              style={[
                styles.genderChip,
                selected ? styles.genderChipActive : styles.genderChipInactive,
              ]}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.genderLabel,
                  selected ? styles.genderLabelActive : styles.genderLabelInactive,
                ]}
              >
                {g.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ height: spacing.lg }} />
      <Text style={[tp.caption, styles.label]}>Date of birth</Text>
      <TouchableOpacity
        testID="register-dob-trigger"
        onPress={openPicker}
        activeOpacity={0.85}
        style={styles.dobField}
      >
        <Feather name="calendar" size={16} color={colors.primary} />
        <Text style={styles.dobValue}>
          {dob ? formatDobDisplay(dob) : "Pick a date"}
        </Text>
      </TouchableOpacity>
      {derivedAge !== null ? (
        <Text style={styles.dobAge} testID="register-derived-age">
          {derivedAge} years old
        </Text>
      ) : (
        <Text style={styles.dobHint}>You must be at least 13 to join Oromona</Text>
      )}
    </>
  );
}

interface SellerFieldsProps {
  companyName: string;
  setCompanyName: (s: string) => void;
  city: string;
  setCity: (s: string) => void;
  country: string;
  setCountry: (s: string) => void;
  bankName: string;
  setBankName: (s: string) => void;
  accountName: string;
  setAccountName: (s: string) => void;
  accountNumber: string;
  setAccountNumber: (s: string) => void;
  mpesaPaybill: string;
  setMpesaPaybill: (s: string) => void;
  mpesaTill: string;
  setMpesaTill: (s: string) => void;
}

function SellerFields(props: SellerFieldsProps) {
  return (
    <>
      <View style={styles.sectionDivider}>
        <Text style={[tp.caption, { color: colors.primary }]}>Atelier</Text>
      </View>
      <AppInput
        testID="register-company-input"
        label="Company / Brand name"
        value={props.companyName}
        onChangeText={props.setCompanyName}
        autoCapitalize="words"
        placeholder="Maison Lumière"
      />
      <View style={styles.rowSplit}>
        <View style={styles.flex1}>
          <AppInput
            testID="register-city-input"
            label="City"
            value={props.city}
            onChangeText={props.setCity}
            autoCapitalize="words"
            placeholder="Nairobi"
          />
        </View>
        <View style={styles.flex1}>
          <AppInput
            testID="register-country-input"
            label="Country"
            value={props.country}
            onChangeText={props.setCountry}
            autoCapitalize="words"
            placeholder="Kenya"
          />
        </View>
      </View>

      <View style={styles.sectionDivider}>
        <Text style={[tp.caption, { color: colors.primary }]}>Payouts</Text>
        <Text style={[tp.bodyMuted, { marginTop: 4, fontSize: 12 }]}>
          Optional now — you can add these later in Settings. Provide at least one method before your first payout.
        </Text>
      </View>

      <Text style={[tp.caption, styles.label, { marginTop: spacing.sm }]}>Bank</Text>
      <AppInput
        testID="register-bank-name-input"
        label="Bank name"
        value={props.bankName}
        onChangeText={props.setBankName}
        autoCapitalize="words"
        placeholder="Equity Bank"
      />
      <AppInput
        testID="register-account-name-input"
        label="Account name"
        value={props.accountName}
        onChangeText={props.setAccountName}
        autoCapitalize="words"
        placeholder="Maison Lumière Ltd"
      />
      <AppInput
        testID="register-account-number-input"
        label="Account number"
        value={props.accountNumber}
        onChangeText={props.setAccountNumber}
        keyboardType="number-pad"
        placeholder="0123456789"
      />

      <Text style={[tp.caption, styles.label, { marginTop: spacing.sm }]}>M-Pesa</Text>
      <View style={styles.rowSplit}>
        <View style={styles.flex1}>
          <AppInput
            testID="register-mpesa-paybill-input"
            label="Paybill"
            value={props.mpesaPaybill}
            onChangeText={props.setMpesaPaybill}
            keyboardType="number-pad"
            placeholder="247247"
          />
        </View>
        <View style={styles.flex1}>
          <AppInput
            testID="register-mpesa-till-input"
            label="Till number"
            value={props.mpesaTill}
            onChangeText={props.setMpesaTill}
            keyboardType="number-pad"
            placeholder="123456"
          />
        </View>
      </View>
    </>
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
  flex1: { flex: 1 },
  rowSplit: { flexDirection: "row", gap: spacing.md },
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
  sectionDivider: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
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
  genderRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  genderChip: {
    paddingHorizontal: 14,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    flexShrink: 0,
  },
  genderChipInactive: { borderColor: colors.border, backgroundColor: colors.surface },
  genderChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  genderLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  genderLabelInactive: { color: colors.primary },
  genderLabelActive: { color: colors.primaryFg },
  dobField: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dobValue: { fontFamily: fonts.body, fontSize: 17, color: colors.primary },
  dobAge: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
    marginTop: spacing.xs,
  },
  dobHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
    marginTop: spacing.xs,
  },
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

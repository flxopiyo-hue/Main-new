import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Image, Text, TouchableOpacity, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { DobPicker } from "@/src/components/DobPicker";
import { PickerField, PickerOption } from "@/src/components/PickerField";
import { SsoButtons } from "@/src/components/SsoButtons";
import { useToast } from "@/src/components/Toast";
import { api, Gender, Role } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { KENYAN_CITIES } from "@/src/lib/cities";
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
  const { registerBuyer, registerSeller, registerCourier } = useAuth();
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
  const [bankCode, setBankCode] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [mpesaPaybill, setMpesaPaybill] = useState("");
  const [mpesaTill, setMpesaTill] = useState("");

  // Courier-only fields (boda riders)
  const [courierPhone, setCourierPhone] = useState("");
  const [courierMpesa, setCourierMpesa] = useState("");

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
      } else if (role === "seller") {
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
                bank_code: bankCode.trim() || undefined,
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
      } else {
        // Courier (boda rider) — pending until admin approves.
        if (!courierPhone.trim()) {
          toast.show("Phone number is required for riders", "error");
          setLoading(false);
          return;
        }
        await registerCourier(email.trim(), password, fullName.trim(), {
          phone: courierPhone.trim(),
          mpesa_number: courierMpesa.trim() || undefined,
        });
        router.replace("/(courier)");
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
        <Text style={[tp.h1, styles.title]}>Become{"\n"}a member.</Text>
        <Text style={[tp.bodyMuted, styles.sub]}>
          Shop curated pieces or list your own atelier.
        </Text>
        <View style={{ height: spacing.xl }} />

        {role === "buyer" ? (
          <>
            <SsoButtons
              mode="register"
              disabled={loading}
              onSuccess={() => router.replace("/onboarding/measurements")}
            />
            <View style={{ height: spacing.lg }} />
          </>
        ) : null}

        {role === "buyer" ? null : (
          <View style={styles.riderBanner} testID="register-rider-banner">
            <Feather name={role === "courier" ? "truck" : "tag"} size={16} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.riderBannerTitle}>
                {role === "courier" ? "RIDER APPLICATION" : "SELLER APPLICATION"}
              </Text>
              <Text style={styles.riderBannerSub}>
                {role === "courier" ? "Deliver parcels & earn per drop" : "List your designs & get paid"}
              </Text>
            </View>
            <TouchableOpacity
              testID="register-rider-back"
              onPress={() => setRole("buyer")}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Text style={styles.riderBackLink}>BACK</Text>
            </TouchableOpacity>
          </View>
        )}

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
        ) : role === "seller" ? (
          <SellerFields
            companyName={companyName}
            setCompanyName={setCompanyName}
            city={city}
            setCity={setCity}
            country={country}
            setCountry={setCountry}
            bankName={bankName}
            setBankName={setBankName}
            bankCode={bankCode}
            setBankCode={setBankCode}
            accountName={accountName}
            setAccountName={setAccountName}
            accountNumber={accountNumber}
            setAccountNumber={setAccountNumber}
            mpesaPaybill={mpesaPaybill}
            setMpesaPaybill={setMpesaPaybill}
            mpesaTill={mpesaTill}
            setMpesaTill={setMpesaTill}
          />
        ) : (
          <CourierFields
            phone={courierPhone}
            setPhone={setCourierPhone}
            mpesa={courierMpesa}
            setMpesa={setCourierMpesa}
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
        {role === "buyer" ? (
          <View style={styles.altLinksRow}>
            <TouchableOpacity testID="register-seller-link" onPress={() => setRole("seller")}>
              <Text style={styles.riderLink}>
                <Text style={styles.linkBold}>Sell on Oromona</Text>
              </Text>
            </TouchableOpacity>
            <Text style={styles.riderLink}>·</Text>
            <TouchableOpacity testID="register-rider-link" onPress={() => setRole("courier")}>
              <Text style={styles.riderLink}>
                <Text style={styles.linkBold}>Deliver & earn as a rider</Text>
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
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
  bankCode: string;
  setBankCode: (s: string) => void;
  accountName: string;
  setAccountName: (s: string) => void;
  accountNumber: string;
  setAccountNumber: (s: string) => void;
  mpesaPaybill: string;
  setMpesaPaybill: (s: string) => void;
  mpesaTill: string;
  setMpesaTill: (s: string) => void;
}

// Common East African countries we'll offer today; Kenya is default.
const COUNTRY_OPTIONS: PickerOption[] = [
  { value: "Kenya", label: "Kenya", icon: "map" },
  { value: "Uganda", label: "Uganda", sub: "coming soon", icon: "map" },
  { value: "Tanzania", label: "Tanzania", sub: "coming soon", icon: "map" },
  { value: "Rwanda", label: "Rwanda", sub: "coming soon", icon: "map" },
];

const CITY_OPTIONS: PickerOption[] = KENYAN_CITIES.map((c) => ({
  value: c.value,
  label: c.label,
  sub: c.county,
  icon: "map-pin",
}));

function SellerFields(props: SellerFieldsProps) {
  const [banks, setBanks] = useState<PickerOption[]>([]);
  const [banksLoading, setBanksLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.publicBanks("kenya");
        if (cancelled) return;
        // Paystack often returns duplicate rows per bank for different
        // currencies (KES, USD, etc.). Prefer KES when available and
        // otherwise fall back to the first entry with a given code.
        const seen = new Map<string, (typeof r.banks)[number]>();
        for (const b of r.banks || []) {
          if (!b.code || !b.name) continue;
          const key = `${b.code}::${b.name}`;
          const existing = seen.get(key);
          if (!existing || (b.currency === "KES" && existing.currency !== "KES")) {
            seen.set(key, b);
          }
        }
        const opts: PickerOption[] = Array.from(seen.values()).map((b) => ({
          value: b.code,
          label: b.name,
          sub: b.type === "mobile_money" ? "M-Pesa / mobile money" : "Bank",
          icon: b.type === "mobile_money" ? "smartphone" : "briefcase",
        }));
        // Sort mobile money to the top (buyers use M-Pesa most in Kenya).
        opts.sort((a, b) => {
          const aM = a.icon === "smartphone" ? 0 : 1;
          const bM = b.icon === "smartphone" ? 0 : 1;
          if (aM !== bM) return aM - bM;
          return a.label.localeCompare(b.label);
        });
        setBanks(opts);
      } catch {
        // Non-fatal — user can still leave bank blank at signup and set it
        // via the payout-account screen later.
        setBanks([]);
      } finally {
        if (!cancelled) setBanksLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
          <PickerField
            testID="register-city-picker"
            label="City"
            placeholder="Choose city"
            value={props.city || null}
            options={CITY_OPTIONS}
            allowCustom
            customLabel="Add another town…"
            searchPlaceholder="Search Nairobi, Mombasa…"
            onChange={(v) => props.setCity(v)}
          />
        </View>
        <View style={styles.flex1}>
          <PickerField
            testID="register-country-picker"
            label="Country"
            placeholder="Kenya"
            value={props.country || null}
            options={COUNTRY_OPTIONS}
            onChange={(v, opt) => {
              // Block non-active countries — offered them just for future.
              if (opt.sub === "coming soon") return;
              props.setCountry(v);
            }}
          />
        </View>
      </View>

      <View style={styles.sectionDivider}>
        <Text style={[tp.caption, { color: colors.primary }]}>Payouts</Text>
        <Text style={[tp.bodyMuted, { marginTop: 4, fontSize: 12 }]}>
          All fields below are optional now — you can add them later in
          Settings → Payout account. Choose your bank from the list so we
          can verify your account number later.
        </Text>
      </View>

      <PickerField
        testID="register-bank-picker"
        label="Bank / M-Pesa"
        placeholder="Choose bank or M-Pesa"
        value={props.bankCode || null}
        options={banks}
        loading={banksLoading}
        optional
        searchPlaceholder="Search Equity, KCB, M-Pesa…"
        onChange={(code, opt) => {
          props.setBankCode(code);
          props.setBankName(opt.label);
        }}
      />
      <AppInput
        testID="register-account-name-input"
        label="Account name (optional)"
        value={props.accountName}
        onChangeText={props.setAccountName}
        autoCapitalize="words"
        placeholder="Maison Lumière Ltd"
      />
      <AppInput
        testID="register-account-number-input"
        label="Account number (optional)"
        value={props.accountNumber}
        onChangeText={props.setAccountNumber}
        keyboardType="number-pad"
        placeholder="0123456789"
      />

      <Text style={[tp.caption, styles.label, { marginTop: spacing.md }]}>
        M-Pesa (optional)
      </Text>
      <View style={styles.rowSplit}>
        <View style={styles.flex1}>
          <AppInput
            testID="register-mpesa-paybill-input"
            label="Paybill (optional)"
            value={props.mpesaPaybill}
            onChangeText={props.setMpesaPaybill}
            keyboardType="number-pad"
            placeholder="247247"
          />
        </View>
        <View style={styles.flex1}>
          <AppInput
            testID="register-mpesa-till-input"
            label="Till (optional)"
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

function CourierFields({
  phone,
  setPhone,
  mpesa,
  setMpesa,
}: {
  phone: string;
  setPhone: (s: string) => void;
  mpesa: string;
  setMpesa: (s: string) => void;
}) {
  return (
    <>
      <View style={styles.sectionDivider}>
        <Text style={[tp.caption, { color: colors.primary }]}>Rider details</Text>
        <Text style={[tp.bodyMuted, { marginTop: 4, fontSize: 12 }]}>
          Deliver parcels for Oromona sellers and earn per drop — paid to your
          M-Pesa at the end of each day. New rider accounts are reviewed by
          our team before jobs appear.
        </Text>
      </View>
      <AppInput
        testID="register-courier-phone-input"
        label="Phone number"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="07XX XXX XXX"
      />
      <AppInput
        testID="register-courier-mpesa-input"
        label="M-Pesa number (for payouts)"
        value={mpesa}
        onChangeText={setMpesa}
        keyboardType="phone-pad"
        placeholder="Same as phone if blank"
      />
    </>
  );
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
  headerLogo: { width: 76, height: 32 },
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
  riderBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  riderBannerTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.primary,
  },
  riderBannerSub: { fontFamily: fonts.body, fontSize: 11, color: colors.mutedFg, marginTop: 2 },
  riderBackLink: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.mutedFg,
    textDecorationLine: "underline",
  },
  riderLinkBtn: { alignItems: "center", marginTop: 6, paddingVertical: 4 },
  altLinksRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginTop: 6,
    paddingVertical: 4,
  },
  riderLink: { fontFamily: fonts.body, fontSize: 11, color: colors.mutedFg },
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

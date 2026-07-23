// Seller Payout Account setup — bank / mobile-money dropdown, account
// number, and save. On save, backend creates a Paystack Subaccount +
// Transfer Recipient and stores the codes on the user document.
// Escrow-released payouts (see /app/backend/core/escrow.py) then get
// pushed to this recipient via Paystack's Transfer API.
//
// East Africa scaffold: the country picker is present but only Kenya is
// active for MVP. Adding Ghana / Nigeria / South Africa is one line
// (Paystack's /bank endpoint already returns their bank lists).

import { Feather } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { useToast } from "@/src/components/Toast";
import { api } from "@/src/lib/api";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

type Bank = {
  code: string;
  name: string;
  type?: string;
  currency?: string;
};

const COUNTRIES = [
  { code: "kenya", label: "Kenya", currency: "KES", flag: "🇰🇪", active: true },
  { code: "ghana", label: "Ghana", currency: "GHS", flag: "🇬🇭", active: false },
  { code: "nigeria", label: "Nigeria", currency: "NGN", flag: "🇳🇬", active: false },
  { code: "south africa", label: "South Africa", currency: "ZAR", flag: "🇿🇦", active: false },
];

export default function PayoutAccount() {
  const toast = useToast();
  const [country, setCountry] = useState("kenya");
  const [banks, setBanks] = useState<Bank[]>([]);
  const [banksLoading, setBanksLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [bank, setBank] = useState<Bank | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<null | {
    bank_name: string;
    account_number_last4: string;
    account_holder: string;
    account_type: string;
    country: string;
  }>(null);
  const [hasRecipient, setHasRecipient] = useState(false);

  const loadBanks = useCallback(async (c: string) => {
    setBanksLoading(true);
    try {
      const r = await api.sellerBanks(c);
      setBanks(r.banks || []);
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't load banks", "error");
    } finally {
      setBanksLoading(false);
    }
  }, [toast]);

  const loadCurrent = useCallback(async () => {
    try {
      const r = await api.sellerGetPayoutAccount();
      setCurrent(r.payout_account ?? null);
      setHasRecipient(!!r.has_recipient);
    } catch {}
  }, []);

  useEffect(() => {
    loadBanks(country);
  }, [country, loadBanks]);

  useEffect(() => {
    loadCurrent();
  }, [loadCurrent]);

  const filteredBanks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return banks;
    return banks.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.code.toLowerCase().includes(q),
    );
  }, [banks, search]);

  const canSave = !!bank && accountNumber.trim().length >= 6 && !saving;

  const save = async () => {
    if (!bank) return;
    setSaving(true);
    try {
      const r = await api.sellerSetPayoutAccount({
        bank_code: bank.code,
        bank_name: bank.name,
        account_number: accountNumber.trim(),
        account_type: bank.type,
        country,
      });
      if (r.ok) {
        toast.show(`Payout account set for ${r.account_holder}`, "success");
        await loadCurrent();
        setBank(null);
        setAccountNumber("");
      } else {
        const msg = r.recipient_error || r.subaccount_error || "Could not save";
        toast.show(`Failed: ${msg}`, "error");
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't save payout account", "error");
    } finally {
      setSaving(false);
    }
  };

  const activeCountry = COUNTRIES.find((c) => c.code === country) || COUNTRIES[0];

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Payout account",
          headerTintColor: colors.primary,
          headerTitleStyle: { fontFamily: fonts.bodySemi },
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Current status card */}
        {current && hasRecipient ? (
          <View style={[styles.card, styles.cardActive]} testID="payout-current-card">
            <View style={styles.cardRow}>
              <Feather name="check-circle" size={18} color="#059669" />
              <Text style={styles.cardTitle}>Payout account active</Text>
            </View>
            <Text style={styles.cardLine}>
              {current.bank_name} · •••{current.account_number_last4}
            </Text>
            <Text style={styles.cardSub}>
              {current.account_holder} · {current.country.toUpperCase()}
            </Text>
            <Text style={styles.cardFooter}>
              Buyer confirms delivery (or 48h auto-release) → Paystack transfers to this account.
            </Text>
          </View>
        ) : current ? (
          <View style={[styles.card, styles.cardWarn]} testID="payout-current-card">
            <View style={styles.cardRow}>
              <Feather name="alert-circle" size={18} color="#B45309" />
              <Text style={styles.cardTitle}>Account saved · Paystack setup pending</Text>
            </View>
            <Text style={styles.cardLine}>
              {current.bank_name} · •••{current.account_number_last4}
            </Text>
            <Text style={styles.cardFooter}>
              Recipient not yet created on Paystack. Try saving again or reach out to support if this persists.
            </Text>
          </View>
        ) : (
          <View style={[styles.card, styles.cardMuted]} testID="payout-empty-card">
            <View style={styles.cardRow}>
              <Feather name="info" size={18} color={colors.mutedFg} />
              <Text style={styles.cardTitle}>No payout account yet</Text>
            </View>
            <Text style={styles.cardFooter}>
              Add your bank or M-Pesa below so Oromona can release funds to you when buyers confirm delivery.
            </Text>
          </View>
        )}

        {/* Country dropdown */}
        <Text style={[tp.caption, styles.label]}>COUNTRY</Text>
        <TouchableOpacity
          testID="payout-country-btn"
          style={styles.picker}
          onPress={() => setCountryPickerOpen(true)}
        >
          <Text style={styles.pickerFlag}>{activeCountry.flag}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.pickerLabel}>{activeCountry.label}</Text>
            <Text style={styles.pickerSub}>{activeCountry.currency}</Text>
          </View>
          <Feather name="chevron-down" size={18} color={colors.mutedFg} />
        </TouchableOpacity>

        {/* Bank / M-Pesa picker */}
        <Text style={[tp.caption, styles.label]}>BANK · MOBILE MONEY</Text>
        <TouchableOpacity
          testID="payout-bank-btn"
          style={styles.picker}
          onPress={() => setPickerOpen(true)}
          disabled={banksLoading}
        >
          {banksLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="dollar-sign" size={18} color={colors.mutedFg} />
          )}
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={[styles.pickerLabel, !bank && { color: colors.mutedFg }]}>
              {bank ? bank.name : banksLoading ? "Loading banks…" : "Choose bank or M-Pesa"}
            </Text>
            {bank ? (
              <Text style={styles.pickerSub}>
                {bank.code} · {(bank.type || "bank").replace("_", " ")}
              </Text>
            ) : null}
          </View>
          <Feather name="chevron-down" size={18} color={colors.mutedFg} />
        </TouchableOpacity>

        {/* Account number */}
        <View style={{ height: 4 }} />
        <AppInput
          testID="payout-account-number"
          label="Account or phone number"
          value={accountNumber}
          onChangeText={setAccountNumber}
          keyboardType="number-pad"
          placeholder="e.g. 0712345678 or 1234567890"
          autoCorrect={false}
        />
        <Text style={styles.hint}>
          For M-Pesa, use the phone number registered with Safaricom (07XX or 01XX).
          For a bank, use the account number exactly as it appears on your statement.
        </Text>

        <View style={{ height: spacing.md }} />
        <AppButton
          testID="payout-save-btn"
          label={saving ? "Saving…" : current ? "Update payout account" : "Save payout account"}
          onPress={save}
          disabled={!canSave}
          loading={saving}
        />

        <View style={{ height: spacing.md }} />
        <TouchableOpacity
          testID="payout-view-history-btn"
          onPress={() => router.push("/(seller)/payouts")}
          style={styles.secondaryLink}
        >
          <Feather name="list" size={14} color={colors.primary} />
          <Text style={styles.secondaryLinkLabel}>View payout history</Text>
        </TouchableOpacity>

        <View style={styles.helpBox}>
          <Feather name="shield" size={14} color={colors.primary} />
          <Text style={styles.helpText}>
            Oromona holds buyer payments in escrow until delivery is confirmed. Funds
            release on buyer confirmation, or automatically 48 hours after the courier
            marks delivered. 15% platform fee applies per sale.
          </Text>
        </View>
      </ScrollView>

      {/* Country picker modal */}
      <Modal visible={countryPickerOpen} transparent animationType="fade" onRequestClose={() => setCountryPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCountryPickerOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <SafeAreaView edges={["bottom"]}>
              <Text style={[tp.h3, { marginBottom: 8 }]}>Country</Text>
              {COUNTRIES.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  testID={`payout-country-${c.code}`}
                  disabled={!c.active}
                  onPress={() => {
                    setCountry(c.code);
                    setBank(null);
                    setCountryPickerOpen(false);
                  }}
                  style={[styles.sheetRow, !c.active && { opacity: 0.4 }]}
                >
                  <Text style={styles.pickerFlag}>{c.flag}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerLabel}>{c.label}</Text>
                    <Text style={styles.pickerSub}>
                      {c.currency}
                      {!c.active ? " · coming soon" : ""}
                    </Text>
                  </View>
                  {country === c.code ? (
                    <Feather name="check" size={18} color={colors.primary} />
                  ) : null}
                </TouchableOpacity>
              ))}
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Bank picker modal */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={[styles.sheet, styles.sheetTall]} onPress={() => {}}>
            <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
              <Text style={[tp.h3, { marginBottom: 8 }]}>Choose bank / M-Pesa</Text>
              <View style={styles.searchWrap}>
                <Feather name="search" size={16} color={colors.mutedFg} />
                <TextInput
                  testID="payout-bank-search"
                  placeholder="Search Equity, KCB, M-Pesa…"
                  placeholderTextColor={colors.mutedFg}
                  value={search}
                  onChangeText={setSearch}
                  style={styles.searchInput}
                />
              </View>
              <FlatList
                testID="payout-bank-list"
                data={filteredBanks}
                keyExtractor={(b) => `${b.code}-${b.type ?? ""}`}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    testID={`payout-bank-${item.code}`}
                    style={styles.sheetRow}
                    onPress={() => {
                      setBank(item);
                      setPickerOpen(false);
                      setSearch("");
                    }}
                  >
                    <View style={styles.bankIconWrap}>
                      <Feather
                        name={item.type === "mobile_money" ? "smartphone" : "briefcase"}
                        size={16}
                        color={colors.primary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerLabel}>{item.name}</Text>
                      <Text style={styles.pickerSub}>
                        {item.code}{item.type ? ` · ${item.type.replace("_", " ")}` : ""}
                      </Text>
                    </View>
                    {bank?.code === item.code ? (
                      <Feather name="check" size={16} color={colors.primary} />
                    ) : null}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  banksLoading ? (
                    <ActivityIndicator style={{ marginVertical: 32 }} color={colors.primary} />
                  ) : (
                    <Text style={styles.empty}>No banks match "{search}"</Text>
                  )
                }
              />
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  label: {
    marginTop: spacing.md,
    marginBottom: 6,
  },
  picker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  pickerFlag: { fontSize: 22, marginRight: 4 },
  pickerLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.primary,
  },
  pickerSub: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    marginTop: 4,
    lineHeight: 15,
  },
  card: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  cardActive: {
    backgroundColor: "rgba(5, 150, 105, 0.08)",
    borderColor: "rgba(5, 150, 105, 0.35)",
  },
  cardWarn: {
    backgroundColor: "rgba(180, 83, 9, 0.08)",
    borderColor: "rgba(180, 83, 9, 0.35)",
  },
  cardMuted: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.primary,
  },
  cardLine: {
    marginTop: 8,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.primary,
  },
  cardSub: {
    marginTop: 2,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
  },
  cardFooter: {
    marginTop: 10,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
    lineHeight: 17,
  },
  secondaryLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  secondaryLinkLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.primary,
  },
  helpBox: {
    marginTop: spacing.lg,
    padding: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  helpText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
    lineHeight: 17,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10,10,10,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    maxHeight: "60%",
  },
  sheetTall: {
    maxHeight: "80%",
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bankIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.primary,
    paddingVertical: 10,
  },
  empty: {
    textAlign: "center",
    marginTop: 24,
    color: colors.mutedFg,
    fontFamily: fonts.body,
    fontSize: 13,
  },
});

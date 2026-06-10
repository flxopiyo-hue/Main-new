// Add a new delivery address.

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AddressFields, validateAddress } from "@/src/components/AddressFields";
import { AppButton } from "@/src/components/AppButton";
import { useToast } from "@/src/components/Toast";
import { AddressInput, api } from "@/src/lib/api";
import { colors, spacing, type as tp } from "@/src/lib/theme";

export default function NewAddressScreen() {
  const toast = useToast();
  const [value, setValue] = useState<Partial<AddressInput>>({
    label: "home",
    country: "Kenya",
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const err = validateAddress(value);
    if (err) {
      toast.show(err, "error");
      return;
    }
    setSaving(true);
    try {
      await api.createAddress({
        label: value.label ?? "home",
        custom_label: value.custom_label,
        recipient_name: value.recipient_name!,
        phone: value.phone!,
        alt_phone: value.alt_phone,
        building_estate: value.building_estate,
        house_number: value.house_number,
        street: value.street,
        area: value.area,
        city: value.city!,
        postal_code: value.postal_code,
        country: value.country!,
        delivery_notes: value.delivery_notes,
        is_default: value.is_default,
      });
      toast.show("Address saved", "success");
      router.back();
    } catch (e: any) {
      toast.show(e?.message ?? "Could not save address", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="address-new-back-btn"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption}>NEW ADDRESS</Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} bottomOffset={32}>
        <Text style={[tp.h2, { marginTop: spacing.sm, marginBottom: spacing.sm }]}>
          Add a delivery address
        </Text>
        <Text style={[tp.bodyMuted, { marginBottom: spacing.lg }]}>
          We&apos;ll use this to ship your orders. You can save multiple and switch at checkout.
        </Text>
        <AddressFields value={value} onChange={setValue} testIDPrefix="address-new" />
      </KeyboardAwareScrollView>

      <View style={styles.footer}>
        <AppButton
          testID="address-new-submit"
          label={saving ? "Saving…" : "Save address"}
          onPress={submit}
          loading={saving}
        />
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
  iconBtn: { width: 32, height: 32 },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});

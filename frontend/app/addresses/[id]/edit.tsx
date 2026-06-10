// Edit an existing delivery address.

import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AddressFields, validateAddress } from "@/src/components/AddressFields";
import { AppButton } from "@/src/components/AppButton";
import { useToast } from "@/src/components/Toast";
import { AddressInput, api } from "@/src/lib/api";
import { colors, spacing, type as tp } from "@/src/lib/theme";

export default function EditAddressScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const [value, setValue] = useState<Partial<AddressInput>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const a = await api.getAddress(id);
        setValue({
          label: a.label,
          custom_label: a.custom_label ?? undefined,
          recipient_name: a.recipient_name,
          phone: a.phone,
          alt_phone: a.alt_phone ?? undefined,
          building_estate: a.building_estate ?? undefined,
          house_number: a.house_number ?? undefined,
          street: a.street ?? undefined,
          area: a.area ?? undefined,
          city: a.city,
          postal_code: a.postal_code ?? undefined,
          country: a.country,
          delivery_notes: a.delivery_notes ?? undefined,
          is_default: a.is_default,
        });
      } catch (e: any) {
        toast.show(e?.message ?? "Address not found", "error");
        router.back();
      } finally {
        setLoading(false);
      }
    })();
  }, [id, toast]);

  const submit = async () => {
    if (!id) return;
    const err = validateAddress(value);
    if (err) {
      toast.show(err, "error");
      return;
    }
    setSaving(true);
    try {
      await api.updateAddress(id, value);
      toast.show("Updated", "success");
      router.back();
    } catch (e: any) {
      toast.show(e?.message ?? "Could not save", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption}>EDIT ADDRESS</Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} bottomOffset={32}>
        <AddressFields value={value} onChange={setValue} testIDPrefix="address-edit" />
      </KeyboardAwareScrollView>

      <View style={styles.footer}>
        <AppButton
          testID="address-edit-submit"
          label={saving ? "Saving…" : "Save changes"}
          onPress={submit}
          loading={saving}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
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

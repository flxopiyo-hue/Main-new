// Shared address form fields (used by /addresses/new, /addresses/[id]/edit,
// and the inline checkout address sheet).

import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { AppInput } from "@/src/components/AppInput";
import { AddressInput, AddressLabel } from "@/src/lib/api";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const LABEL_OPTIONS: { key: AddressLabel; icon: string; label: string }[] = [
  { key: "home", icon: "🏠", label: "Home" },
  { key: "office", icon: "💼", label: "Office" },
  { key: "parents", icon: "👪", label: "Parents" },
  { key: "other", icon: "✨", label: "Other" },
];

interface Props {
  value: Partial<AddressInput>;
  onChange: (next: Partial<AddressInput>) => void;
  testIDPrefix?: string;
}

export function AddressFields({ value, onChange, testIDPrefix = "addr" }: Props) {
  const set = <K extends keyof AddressInput>(key: K, v: AddressInput[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <View>
      <Text style={[tp.caption, styles.label]}>Save this as</Text>
      <View style={styles.row}>
        {LABEL_OPTIONS.map((opt) => {
          const active = (value.label ?? "home") === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              testID={`${testIDPrefix}-label-${opt.key}`}
              onPress={() => set("label", opt.key)}
              style={[styles.bigChip, active && styles.bigChipActive]}
              activeOpacity={0.85}
            >
              <Text style={styles.icon}>{opt.icon}</Text>
              <Text
                style={[styles.bigChipLabel, active && { color: colors.primaryFg }]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {(value.label ?? "home") === "other" ? (
        <AppInput
          testID={`${testIDPrefix}-custom-label`}
          label="Custom label"
          value={value.custom_label ?? ""}
          onChangeText={(t) => set("custom_label", t)}
          placeholder="Beach house"
        />
      ) : null}

      <AppInput
        testID={`${testIDPrefix}-recipient`}
        label="Recipient name"
        value={value.recipient_name ?? ""}
        onChangeText={(t) => set("recipient_name", t)}
        placeholder="Avery Lin"
        autoCapitalize="words"
      />

      <View style={styles.split}>
        <View style={styles.flex1}>
          <AppInput
            testID={`${testIDPrefix}-phone`}
            label="Mobile number"
            value={value.phone ?? ""}
            onChangeText={(t) => set("phone", t)}
            keyboardType="phone-pad"
            placeholder="+254 712 345 678"
          />
        </View>
        <View style={styles.flex1}>
          <AppInput
            testID={`${testIDPrefix}-alt-phone`}
            label="Home number (optional)"
            value={value.alt_phone ?? ""}
            onChangeText={(t) => set("alt_phone", t)}
            keyboardType="phone-pad"
            placeholder="+254 20 1234567"
          />
        </View>
      </View>

      <Text style={[tp.caption, styles.label]}>Where to deliver</Text>
      <AppInput
        testID={`${testIDPrefix}-building`}
        label="Building / Estate name"
        value={value.building_estate ?? ""}
        onChangeText={(t) => set("building_estate", t)}
        placeholder="Sunshine Court"
      />
      <View style={styles.split}>
        <View style={styles.flex1}>
          <AppInput
            testID={`${testIDPrefix}-house`}
            label="House number"
            value={value.house_number ?? ""}
            onChangeText={(t) => set("house_number", t)}
            placeholder="A-12"
          />
        </View>
        <View style={styles.flex1}>
          <AppInput
            testID={`${testIDPrefix}-area`}
            label="Area (optional)"
            value={value.area ?? ""}
            onChangeText={(t) => set("area", t)}
            placeholder="Lavington"
          />
        </View>
      </View>
      <AppInput
        testID={`${testIDPrefix}-street`}
        label="Road / Street (optional)"
        value={value.street ?? ""}
        onChangeText={(t) => set("street", t)}
        placeholder="James Gichuru Rd"
      />

      <View style={styles.split}>
        <View style={styles.flex1}>
          <AppInput
            testID={`${testIDPrefix}-city`}
            label="City"
            value={value.city ?? ""}
            onChangeText={(t) => set("city", t)}
            placeholder="Nairobi"
          />
        </View>
        <View style={styles.flex1}>
          <AppInput
            testID={`${testIDPrefix}-postal`}
            label="Postal code (optional)"
            value={value.postal_code ?? ""}
            onChangeText={(t) => set("postal_code", t)}
            keyboardType="number-pad"
            placeholder="00100"
          />
        </View>
      </View>
      <AppInput
        testID={`${testIDPrefix}-country`}
        label="Country"
        value={value.country ?? ""}
        onChangeText={(t) => set("country", t)}
        placeholder="Kenya"
      />

      <AppInput
        testID={`${testIDPrefix}-notes`}
        label="Delivery instructions (optional)"
        value={value.delivery_notes ?? ""}
        onChangeText={(t) => set("delivery_notes", t)}
        placeholder="Call guard at gate. Mateo is usually home after 4pm."
        multiline
        numberOfLines={3}
      />
    </View>
  );
}

export function validateAddress(v: Partial<AddressInput>): string | null {
  if (!v.recipient_name?.trim()) return "Recipient name is required";
  if (!v.phone?.trim()) return "Mobile number is required";
  if (!v.city?.trim()) return "City is required";
  if (!v.country?.trim()) return "Country is required";
  return null;
}

const styles = StyleSheet.create({
  label: { marginTop: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: spacing.lg },
  split: { flexDirection: "row", gap: spacing.md },
  flex1: { flex: 1, minWidth: 110 },
  bigChip: {
    flex: 1,
    minWidth: 80,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  bigChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  bigChipLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary },
  icon: { fontSize: 16 },
});

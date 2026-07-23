// Reusable labeled picker field. Renders as a tappable row that mimics
// `AppInput`'s label + value + underline, then opens a searchable modal
// list with the available options.
//
// Used by the seller-registration form (Kenyan cities, Paystack banks)
// and can be reused anywhere else in the app that needs a
// "type-ahead-friendly" single-select.

import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export interface PickerOption {
  value: string;
  label: string;
  sub?: string;
  icon?: keyof typeof Feather.glyphMap;
}

interface Props {
  label: string;
  placeholder?: string;
  value: string | null;
  onChange: (value: string, option: PickerOption) => void;
  options: PickerOption[];
  loading?: boolean;
  searchPlaceholder?: string;
  optional?: boolean;
  testID?: string;
  // When true, a free-text "Custom / Other…" row is appended that lets the
  // user provide a value not in the options list.
  allowCustom?: boolean;
  customLabel?: string;
  disabled?: boolean;
}

export function PickerField({
  label,
  placeholder,
  value,
  onChange,
  options,
  loading = false,
  searchPlaceholder = "Search…",
  optional,
  testID,
  allowCustom,
  customLabel = "Custom / Other…",
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  const displayValue = selectedOption?.label ?? value ?? "";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sub ?? "").toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [options, search]);

  const close = () => {
    setOpen(false);
    setSearch("");
    setCustomMode(false);
    setCustomValue("");
  };

  const commitCustom = () => {
    const v = customValue.trim();
    if (!v) return;
    onChange(v, { value: v, label: v });
    close();
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {optional ? <Text style={styles.optional}> (optional)</Text> : null}
      </Text>
      <TouchableOpacity
        testID={testID}
        onPress={() => setOpen(true)}
        disabled={disabled || loading}
        activeOpacity={0.7}
        style={[styles.row, disabled && { opacity: 0.5 }]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.mutedFg} />
        ) : (
          <>
            <Text
              style={[styles.value, !displayValue && { color: colors.mutedFg }]}
              numberOfLines={1}
            >
              {displayValue || placeholder || "Select…"}
            </Text>
            <Feather name="chevron-down" size={18} color={colors.mutedFg} />
          </>
        )}
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
              <View style={styles.sheetHeader}>
                <Text style={[tp.h3, { flex: 1 }]}>{label}</Text>
                <TouchableOpacity onPress={close} testID={`${testID}-close`}>
                  <Feather name="x" size={22} color={colors.primary} />
                </TouchableOpacity>
              </View>

              {customMode ? (
                <View style={styles.customBox}>
                  <Text style={[tp.caption, { marginBottom: 6 }]}>
                    Enter your {label.toLowerCase()}
                  </Text>
                  <TextInput
                    testID={`${testID}-custom-input`}
                    placeholder={placeholder ?? "Type here…"}
                    placeholderTextColor={colors.mutedFg}
                    value={customValue}
                    onChangeText={setCustomValue}
                    style={styles.customInput}
                    autoFocus
                  />
                  <View style={styles.customActions}>
                    <TouchableOpacity
                      onPress={() => setCustomMode(false)}
                      style={styles.customCancel}
                    >
                      <Text style={styles.customCancelLabel}>Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={commitCustom}
                      disabled={!customValue.trim()}
                      testID={`${testID}-custom-save`}
                      style={[
                        styles.customSave,
                        !customValue.trim() && { opacity: 0.4 },
                      ]}
                    >
                      <Text style={styles.customSaveLabel}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.searchWrap}>
                    <Feather name="search" size={16} color={colors.mutedFg} />
                    <TextInput
                      testID={`${testID}-search`}
                      placeholder={searchPlaceholder}
                      placeholderTextColor={colors.mutedFg}
                      value={search}
                      onChangeText={setSearch}
                      style={styles.searchInput}
                    />
                  </View>
                  <FlatList
                    testID={`${testID}-list`}
                    data={filtered}
                    keyExtractor={(o) => o.value}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        testID={`${testID}-option-${item.value}`}
                        style={styles.optionRow}
                        onPress={() => {
                          onChange(item.value, item);
                          close();
                        }}
                      >
                        <View style={styles.optionIcon}>
                          <Feather
                            name={item.icon ?? "map-pin"}
                            size={16}
                            color={colors.primary}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.optionLabel}>{item.label}</Text>
                          {item.sub ? (
                            <Text style={styles.optionSub}>{item.sub}</Text>
                          ) : null}
                        </View>
                        {value === item.value ? (
                          <Feather name="check" size={16} color={colors.primary} />
                        ) : null}
                      </TouchableOpacity>
                    )}
                    ListEmptyComponent={
                      <Text style={styles.empty}>
                        {loading ? "Loading…" : `No matches for "${search}"`}
                      </Text>
                    }
                    ListFooterComponent={
                      allowCustom ? (
                        <TouchableOpacity
                          testID={`${testID}-custom-btn`}
                          onPress={() => setCustomMode(true)}
                          style={[styles.optionRow, styles.customRow]}
                        >
                          <View style={styles.optionIcon}>
                            <Feather name="edit-3" size={16} color={colors.primary} />
                          </View>
                          <Text style={styles.optionLabel}>{customLabel}</Text>
                        </TouchableOpacity>
                      ) : null
                    }
                  />
                </>
              )}
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginTop: spacing.md },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.mutedFg,
    textTransform: "uppercase",
  },
  optional: {
    fontFamily: fonts.body,
    letterSpacing: 0,
    textTransform: "none",
    color: colors.mutedFg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 44,
  },
  value: { flex: 1, fontFamily: fonts.body, fontSize: 17, color: colors.primary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.lg,
    maxHeight: "80%",
    minHeight: "55%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderRadius: 8,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.primary,
    padding: 0,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  optionLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.primary },
  optionSub: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
    marginTop: 2,
  },
  empty: {
    padding: spacing.lg,
    textAlign: "center",
    color: colors.mutedFg,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  customRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.xs,
  },
  customBox: { paddingVertical: spacing.md },
  customInput: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.primary,
  },
  customActions: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  customCancel: {
    flex: 1,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  customCancelLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
    letterSpacing: 1.2,
  },
  customSave: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    backgroundColor: colors.primary,
  },
  customSaveLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primaryFg,
    letterSpacing: 1.2,
  },
});

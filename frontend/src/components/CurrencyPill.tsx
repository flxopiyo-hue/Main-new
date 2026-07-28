// Small header pill that shows the buyer's active display currency and
// opens a bottom sheet chooser. Written for the Discover header so
// buyers can flip between KES/USD/EUR/etc. without hunting through
// Profile → Settings. Preference is persisted via the same
// `/auth/preferences` endpoint used by the Profile screen.

import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { CURRENCIES, getCurrencyMeta, type Currency } from "@/src/lib/currency";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface Props {
  testID?: string;
  // Optional callback fired after a successful currency change — the
  // Discover screen uses it to trigger a re-render of price labels.
  onChanged?: (code: Currency) => void;
}

export function CurrencyPill({ testID = "currency-pill", onChanged }: Props) {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<Currency | null>(null);

  const current = getCurrencyMeta(user?.preferred_currency ?? "KES");

  const pick = async (code: Currency) => {
    if (code === current.code) {
      setOpen(false);
      return;
    }
    setSaving(code);
    try {
      await api.updatePreferences({ preferred_currency: code });
      // Refresh the auth context so every price label in the app
      // repaints in the new currency.
      await refresh();
      onChanged?.(code);
      toast.show(`Currency set to ${code}`, "success");
      setOpen(false);
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't update currency", "error");
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <TouchableOpacity
        testID={testID}
        onPress={() => setOpen(true)}
        style={styles.pill}
        activeOpacity={0.7}
        accessibilityLabel={`Display currency: ${current.code}`}
      >
        <Text style={styles.pillLabel}>{current.code}</Text>
        <Feather name="chevron-down" size={12} color={colors.primary} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        testID={`${testID}-modal`}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable onPress={() => {}} style={styles.sheetWrap}>
            <SafeAreaView edges={["bottom"]} style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <View>
                  <Text style={tp.caption}>DISPLAY CURRENCY</Text>
                  <Text style={[tp.h3, styles.sheetTitle]}>Choose how prices show</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setOpen(false)}
                  testID={`${testID}-close`}
                  hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
                >
                  <Feather name="x" size={22} color={colors.primary} />
                </TouchableOpacity>
              </View>
              <Text style={[tp.bodyMuted, styles.sheetSub]}>
                Prices are converted at indicative rates. You&apos;ll pay in the
                item&apos;s listed currency at checkout.
              </Text>
              <FlatList
                data={CURRENCIES}
                keyExtractor={(c) => c.code}
                // Explicit bounded height — without it RN-web lets the list
                // grow to full content height inside the clipped sheet, which
                // makes it refuse to scroll ("the slider won't move").
                style={styles.listBox}
                contentContainerStyle={styles.list}
                showsVerticalScrollIndicator
                renderItem={({ item }) => {
                  const active = item.code === current.code;
                  const busy = saving === item.code;
                  return (
                    <TouchableOpacity
                      testID={`${testID}-option-${item.code}`}
                      style={[styles.row, active && styles.rowActive]}
                      onPress={() => pick(item.code)}
                      activeOpacity={0.7}
                      disabled={!!saving}
                    >
                      <View style={styles.symbolWrap}>
                        <Text style={styles.symbolText}>{item.symbol}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowLabel}>{item.label}</Text>
                        <Text style={styles.rowCode}>{item.code}</Text>
                      </View>
                      {busy ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : active ? (
                        <Feather name="check" size={18} color={colors.primary} />
                      ) : null}
                    </TouchableOpacity>
                  );
                }}
              />
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 6,
  },
  pillLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    letterSpacing: 0.8,
    color: colors.primary,
    marginRight: 2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10,10,10,0.35)",
    justifyContent: "flex-end",
  },
  sheetWrap: { width: "100%" },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    maxHeight: "78%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  sheetTitle: { marginTop: 4 },
  sheetSub: {
    marginTop: 6,
    marginBottom: spacing.md,
    fontSize: 12,
  },
  list: { paddingBottom: spacing.xl },
  listBox: { maxHeight: 420, flexGrow: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowActive: {},
  symbolWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  symbolText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.primary,
  },
  rowLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.primary,
  },
  rowCode: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    letterSpacing: 1,
  },
});

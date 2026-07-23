// Modal sheet that lets the buyer pick (or add inline) a shipping address
// before opening Paystack checkout.

import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { AddressFields, validateAddress } from "@/src/components/AddressFields";
import { AppButton } from "@/src/components/AppButton";
import { useToast } from "@/src/components/Toast";
import { Address, AddressInput, api } from "@/src/lib/api";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the chosen address id once the buyer confirms. */
  onConfirm: (addr: Address) => void;
}

function labelOf(addr: Address): string {
  if (addr.label === "other" && addr.custom_label) return addr.custom_label;
  return addr.label.charAt(0).toUpperCase() + addr.label.slice(1);
}

function summary(addr: Address): string {
  const bits = [
    [addr.building_estate, addr.house_number].filter(Boolean).join(" · "),
    [addr.street, addr.area].filter(Boolean).join(", "),
    [addr.city, addr.country].filter(Boolean).join(", "),
  ].filter(Boolean);
  return bits.join(" — ");
}

export function AddressPickerSheet({ visible, onClose, onConfirm }: Props) {
  const toast = useToast();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "new">("list");
  const [draft, setDraft] = useState<Partial<AddressInput>>({
    label: "home",
    country: "Kenya",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listAddresses();
      setAddresses(list);
      const def = list.find((a) => a.is_default) ?? list[0];
      setSelectedId(def?.id ?? null);
      if (list.length === 0) setMode("new");
      else setMode("list");
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load addresses", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (visible) {
      load();
    }
  }, [visible, load]);

  const confirm = () => {
    if (!selectedId) {
      toast.show("Pick an address", "error");
      return;
    }
    const addr = addresses.find((a) => a.id === selectedId);
    if (!addr) {
      toast.show("Address not found", "error");
      return;
    }
    onConfirm(addr);
  };

  const saveNew = async () => {
    const err = validateAddress(draft);
    if (err) {
      toast.show(err, "error");
      return;
    }
    setSaving(true);
    try {
      const created = await api.createAddress({
        label: draft.label ?? "home",
        custom_label: draft.custom_label,
        recipient_name: draft.recipient_name!,
        phone: draft.phone!,
        alt_phone: draft.alt_phone,
        building_estate: draft.building_estate,
        house_number: draft.house_number,
        street: draft.street,
        area: draft.area,
        city: draft.city!,
        postal_code: draft.postal_code,
        country: draft.country!,
        delivery_notes: draft.delivery_notes,
        is_default: draft.is_default ?? addresses.length === 0,
      });
      // Use the new address immediately.
      onConfirm(created);
    } catch (e: any) {
      toast.show(e?.message ?? "Could not save address", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />

          <View style={styles.head}>
            <Text style={tp.h3}>
              {mode === "new" ? "New delivery address" : "Choose delivery address"}
            </Text>
            <TouchableOpacity testID="address-sheet-close" onPress={onClose}>
              <Feather name="x" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : mode === "new" ? (
            <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: spacing.md }}>
              <Text style={[tp.bodyMuted, { marginBottom: spacing.md }]}>
                {addresses.length === 0
                  ? "Add your first address to continue checkout."
                  : "Add another address to your address book."}
              </Text>
              <AddressFields value={draft} onChange={setDraft} testIDPrefix="address-checkout" />
            </ScrollView>
          ) : (
            <ScrollView style={{ maxHeight: 460 }}>
              {addresses.map((a) => {
                const selected = selectedId === a.id;
                return (
                  <TouchableOpacity
                    key={a.id}
                    testID={`checkout-address-${a.id}`}
                    onPress={() => setSelectedId(a.id)}
                    style={[styles.row, selected && styles.rowActive]}
                    activeOpacity={0.85}
                  >
                    <View style={styles.radioOuter}>
                      {selected ? <View style={styles.radioInner} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.rowHead}>
                        <Text style={styles.rowLabel}>{labelOf(a)}</Text>
                        {a.is_default ? <Text style={styles.defaultBadge}>DEFAULT</Text> : null}
                      </View>
                      <Text style={styles.recipient}>
                        {a.recipient_name} · {a.phone}
                      </Text>
                      <Text style={styles.summary} numberOfLines={2}>
                        {summary(a)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                testID="checkout-add-address-btn"
                onPress={() => setMode("new")}
                style={styles.addBtn}
                activeOpacity={0.85}
              >
                <Feather name="plus" size={16} color={colors.primary} />
                <Text style={styles.addLabel}>ADD NEW ADDRESS</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          <View style={styles.actions}>
            {mode === "new" && addresses.length > 0 ? (
              <TouchableOpacity
                testID="address-sheet-back"
                onPress={() => setMode("list")}
                style={[styles.btn, styles.btnGhost]}
              >
                <Text style={styles.ghostLabel}>BACK</Text>
              </TouchableOpacity>
            ) : null}
            <View style={{ flex: 1 }}>
              <AppButton
                testID={mode === "new" ? "address-sheet-save-new" : "address-sheet-confirm"}
                label={
                  mode === "new"
                    ? saving ? "Saving…" : "Save & Use"
                    : "Continue to Pay"
                }
                onPress={mode === "new" ? saveNew : confirm}
                loading={saving}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.background,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: "92%",
  },
  handle: {
    width: 48,
    height: 4,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  center: { paddingVertical: spacing.xl, alignItems: "center" },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  rowActive: { borderColor: colors.primary },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  defaultBadge: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.primaryFg,
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  recipient: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary, marginTop: 2 },
  summary: { fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg, marginTop: 2 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: "dashed",
    backgroundColor: colors.background,
  },
  addLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.primary,
    textTransform: "uppercase",
  },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  btn: {
    paddingHorizontal: spacing.md,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  ghostLabel: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 1.2, color: colors.primary },
});

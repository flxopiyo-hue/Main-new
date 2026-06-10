// Saved-addresses list & manage screen.

import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { Address, api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

function labelOf(addr: Address): string {
  if (addr.label === "other" && addr.custom_label) return addr.custom_label;
  return addr.label.charAt(0).toUpperCase() + addr.label.slice(1);
}

function summaryLines(addr: Address): string[] {
  const lines: string[] = [];
  const top = [addr.building_estate, addr.house_number].filter(Boolean).join(" · ");
  if (top) lines.push(top);
  const street = [addr.street, addr.area].filter(Boolean).join(", ");
  if (street) lines.push(street);
  lines.push([addr.city, addr.postal_code, addr.country].filter(Boolean).join(", "));
  if (addr.delivery_notes) lines.push(`Notes: ${addr.delivery_notes}`);
  return lines;
}

export default function AddressesIndex() {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listAddresses();
      setAddresses(list);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load addresses", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useFocusEffect(
    useCallback(() => {
      if (authLoading) return;
      if (!user || user.role !== "buyer") {
        router.replace("/(tabs)");
        return;
      }
      load();
    }, [authLoading, user, load]),
  );

  const makeDefault = async (addr: Address) => {
    setBusy(addr.id);
    try {
      await api.setDefaultAddress(addr.id);
      await load();
      toast.show(`${labelOf(addr)} set as default`, "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not update default", "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (addr: Address) => {
    setBusy(addr.id);
    try {
      await api.deleteAddress(addr.id);
      setAddresses((curr) => curr.filter((x) => x.id !== addr.id));
      toast.show(`Removed`, "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not delete", "error");
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = (addr: Address) => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && window.confirm(`Delete ${labelOf(addr)} address?`)) {
        remove(addr);
      }
      return;
    }
    Alert.alert("Delete address", `Delete ${labelOf(addr)} address?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove(addr) },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="addresses-back-btn"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption}>SAVED ADDRESSES</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
      >
        <Text style={[tp.h2, { marginBottom: spacing.sm }]}>Where do we ship?</Text>
        <Text style={[tp.bodyMuted, { marginBottom: spacing.lg }]}>
          Save multiple addresses for home, work, or gifts. Pick a default and switch at checkout.
        </Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : addresses.length === 0 ? (
          <Text style={[tp.bodyMuted, { textAlign: "center", marginTop: spacing.lg }]}>
            No saved addresses yet. Tap the button below to add your first one.
          </Text>
        ) : (
          addresses.map((addr) => (
            <View
              key={addr.id}
              style={[styles.card, addr.is_default && styles.cardDefault]}
              testID={`address-card-${addr.id}`}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardLabel}>{labelOf(addr)}</Text>
                {addr.is_default ? (
                  <Text style={styles.defaultBadge}>DEFAULT</Text>
                ) : null}
              </View>
              <Text style={styles.recipient}>
                {addr.recipient_name} · {addr.phone}
                {addr.alt_phone ? `  ·  ${addr.alt_phone}` : ""}
              </Text>
              {summaryLines(addr).map((line, i) => (
                <Text key={i} style={styles.line} numberOfLines={2}>
                  {line}
                </Text>
              ))}
              <View style={styles.cardActions}>
                {!addr.is_default ? (
                  <TouchableOpacity
                    testID={`address-${addr.id}-default-btn`}
                    onPress={() => makeDefault(addr)}
                    disabled={busy === addr.id}
                    style={styles.actionBtn}
                  >
                    <Text style={styles.actionLabel}>SET DEFAULT</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  testID={`address-${addr.id}-edit-btn`}
                  onPress={() => router.push(`/addresses/${addr.id}/edit`)}
                  style={styles.actionBtn}
                >
                  <Text style={styles.actionLabel}>EDIT</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`address-${addr.id}-delete-btn`}
                  onPress={() => confirmDelete(addr)}
                  disabled={busy === addr.id}
                  style={styles.actionBtn}
                >
                  {busy === addr.id ? (
                    <ActivityIndicator size="small" color={colors.error} />
                  ) : (
                    <Text style={[styles.actionLabel, { color: colors.error }]}>DELETE</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        <TouchableOpacity
          testID="addresses-add-new-btn"
          onPress={() => router.push("/addresses/new")}
          style={styles.addBtn}
          activeOpacity={0.85}
        >
          <Feather name="plus" size={18} color={colors.primary} />
          <Text style={styles.addLabel}>ADD NEW ADDRESS</Text>
        </TouchableOpacity>
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
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
  center: { paddingVertical: spacing.xl, alignItems: "center" },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardDefault: { borderColor: colors.primary },
  cardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  cardLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  defaultBadge: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.primaryFg,
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  recipient: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary, marginBottom: 4 },
  line: { fontFamily: fonts.body, fontSize: 13, color: colors.mutedFg, marginTop: 2 },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionBtn: { paddingHorizontal: spacing.sm, paddingVertical: 6 },
  actionLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.primary,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
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
});

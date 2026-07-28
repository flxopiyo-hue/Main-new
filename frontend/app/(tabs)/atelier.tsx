import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { api, Item } from "@/src/lib/api";
import { formatPrice } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function Atelier() {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.myItems();
      setItems(data);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const remove = async (id: string) => {
    try {
      await api.deleteItem(id);
      toast.show("Item removed", "success");
      load();
    } catch (e: any) {
      toast.show(e?.message ?? "Delete failed", "error");
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={tp.caption}>YOUR ATELIER</Text>
          <Text style={[tp.h2, styles.title]}>Inventory</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            testID="atelier-dashboard-btn"
            onPress={() => router.push("/(seller)")}
            style={styles.secondaryBtn}
          >
            <Feather name="layout" size={16} color={colors.primary} />
            <Text style={styles.secondaryLabel}>Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="atelier-new-drop-btn"
            onPress={() => router.push("/(seller)/new-collection")}
            style={styles.secondaryBtn}
          >
            <Feather name="layers" size={16} color={colors.primary} />
            <Text style={styles.secondaryLabel}>Drop</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="atelier-add-btn"
            onPress={() => router.push("/(seller)/add-item")}
            style={styles.addBtn}
          >
            <Feather name="plus" size={18} color={colors.primaryFg} />
            <Text style={styles.addLabel}>New</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="package" size={32} color={colors.mutedFg} />
          <Text style={[tp.h3, { textAlign: "center", marginTop: spacing.md }]}>
            No pieces yet.
          </Text>
          <Text style={[tp.bodyMuted, { textAlign: "center", marginTop: spacing.sm }]}>
            Upload your first item — buyers near your size will see it instantly.
          </Text>
        </View>
      ) : (
        <FlatList
          testID="atelier-list"
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.row} testID={`atelier-item-${item.id}`}>
              <Image
                source={{ uri: dataUriFromBase64(item.image_b64) }}
                style={styles.thumb}
                resizeMode="cover"
              />
              <View style={styles.rowBody}>
                <Text style={tp.caption}>{item.category.toUpperCase()}</Text>
                <Text style={styles.rowName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.rowPrice}>{formatPrice(item.price_cents, item.currency)}</Text>
                <Text style={styles.rowSizes} numberOfLines={1}>
                  {item.sizes.map((s) => `${s.label} (${s.available_qty})`).join(" · ")}
                </Text>
              </View>
              <TouchableOpacity
                testID={`atelier-delete-${item.id}`}
                onPress={() => remove(item.id)}
                style={styles.deleteBtn}
              >
                <Feather name="trash-2" size={16} color={colors.error} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  title: { marginTop: 6 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  addLabel: {
    color: colors.primaryFg,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  headerActions: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "60%" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  secondaryLabel: {
    color: colors.primary,
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  list: { paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  thumb: { width: 80, height: 100, backgroundColor: colors.muted },
  rowBody: { flex: 1 },
  rowName: { fontFamily: fonts.heading, fontSize: 18, color: colors.primary, marginTop: 2 },
  rowPrice: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary, marginTop: 4 },
  rowSizes: { fontFamily: fonts.body, fontSize: 11, color: colors.mutedFg, marginTop: 4 },
  deleteBtn: { padding: 8, alignSelf: "flex-start" },
});

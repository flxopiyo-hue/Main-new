// Admin → Items moderation. View all listings and remove problematic ones.

import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { AdminShell } from "@/src/components/AdminShell";
import { useToast } from "@/src/components/Toast";
import { api, Item } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPrice } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function AdminItems() {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.adminListItems();
      setItems(list);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load items", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useFocusEffect(
    useCallback(() => {
      if (!authLoading) {
        if (!user || user.role !== "admin") {
          router.replace("/(auth)/welcome");
          return;
        }
        load();
      }
    }, [authLoading, user, load]),
  );

  const doDelete = async (item: Item) => {
    setDeleting(item.id);
    try {
      await api.adminDeleteItem(item.id);
      setItems((curr) => curr.filter((x) => x.id !== item.id));
      toast.show(`Removed "${item.name}"`, "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not delete item", "error");
    } finally {
      setDeleting(null);
    }
  };

  const confirmDelete = (item: Item) => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && window.confirm(`Remove "${item.name}"?`)) {
        doDelete(item);
      }
      return;
    }
    Alert.alert(
      "Remove item",
      `Permanently remove "${item.name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => doDelete(item) },
      ],
    );
  };

  return (
    <AdminShell
      title="Items"
      subtitle="All listings across the marketplace. Tap to remove problematic items."
    >
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          testID="admin-items-list"
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
          ListEmptyComponent={
            <Text style={[tp.bodyMuted, { textAlign: "center", marginTop: spacing.xl }]}>
              No items in the marketplace yet.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.itemRow} testID={`admin-item-${item.id}`}>
              <Image
                source={{ uri: dataUriFromBase64(item.image_b64) }}
                style={styles.thumb}
                resizeMode="cover"
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                <Text style={tp.bodyMuted} numberOfLines={1}>
                  by {item.seller_name}
                </Text>
                <Text style={styles.itemMeta} numberOfLines={1}>
                  {item.category.toUpperCase()} · {item.audience.toUpperCase()}
                </Text>
                <Text style={styles.itemPrice}>
                  {formatPrice(item.price_cents, item.currency)}
                </Text>
              </View>
              <TouchableOpacity
                testID={`admin-item-${item.id}-delete`}
                onPress={() => confirmDelete(item)}
                disabled={deleting === item.id}
                style={styles.deleteBtn}
                activeOpacity={0.85}
              >
                {deleting === item.id ? (
                  <ActivityIndicator size="small" color={colors.primaryFg} />
                ) : (
                  <Feather name="trash-2" size={16} color={colors.primaryFg} />
                )}
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  thumb: { width: 72, height: 90, backgroundColor: colors.muted },
  itemName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.primary },
  itemMeta: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.mutedFg,
    marginTop: 4,
  },
  itemPrice: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary, marginTop: 4 },
  deleteBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.error,
  },
});

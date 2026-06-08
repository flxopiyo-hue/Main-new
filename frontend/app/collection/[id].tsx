import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
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
import { api, Collection, Item } from "@/src/lib/api";
import { formatPrice } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function CollectionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.getCollection(String(id));
      setCollection(res.collection);
      setItems(res.items);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load collection", "error");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !collection) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        testID="collection-list"
        data={items}
        keyExtractor={(i) => i.id}
        numColumns={2}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.heroWrap}>
            {collection.cover_image_b64 ? (
              <Image
                source={{ uri: dataUriFromBase64(collection.cover_image_b64) }}
                style={styles.hero}
                resizeMode="cover"
              />
            ) : null}
            <View style={styles.heroOverlay} />
            <SafeAreaView style={styles.heroBar} edges={["top"]}>
              <View style={styles.heroBarRow}>
                <TouchableOpacity
                  testID="collection-back-btn"
                  onPress={() => router.back()}
                  style={styles.heroIcon}
                >
                  <Feather name="arrow-left" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </SafeAreaView>
            <View style={styles.heroText}>
              <Text style={styles.dropCaption}>DROP · {collection.seller_name.toUpperCase()}</Text>
              <Text style={styles.dropTitle}>{collection.name}</Text>
              {collection.description ? (
                <Text style={styles.dropDesc}>{collection.description}</Text>
              ) : null}
              <Text style={styles.dropMeta}>
                {items.length} piece{items.length === 1 ? "" : "s"}
              </Text>
            </View>
          </View>
        }
        renderItem={({ item, index }) => (
          <TouchableOpacity
            testID={`collection-item-${item.id}`}
            onPress={() => router.push(`/item/${item.id}`)}
            style={[styles.card, index % 2 === 0 ? styles.cardLeft : styles.cardRight]}
            activeOpacity={0.85}
          >
            <Image
              source={{ uri: dataUriFromBase64(item.image_b64) }}
              style={styles.cardImage}
              resizeMode="cover"
            />
            <Text style={styles.cardSeller} numberOfLines={1}>
              {item.seller_name.toUpperCase()}
            </Text>
            <Text style={styles.cardName} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={styles.cardPrice}>{formatPrice(item.price_cents, item.currency)}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  list: { paddingBottom: spacing.xxl },
  heroWrap: {
    width: "100%",
    aspectRatio: 4 / 5,
    backgroundColor: colors.primary,
    marginBottom: spacing.lg,
  },
  hero: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  heroBar: { ...StyleSheet.absoluteFillObject, padding: spacing.md },
  heroBarRow: { flexDirection: "row" },
  heroIcon: {
    width: 40,
    height: 40,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroText: {
    position: "absolute",
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
  },
  dropCaption: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: "#E5E5E5",
    letterSpacing: 2,
    marginBottom: 8,
  },
  dropTitle: {
    fontFamily: fonts.heading,
    fontSize: 44,
    lineHeight: 46,
    color: "#FFFFFF",
    marginBottom: 8,
  },
  dropDesc: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: "#E5E5E5",
    maxWidth: 320,
    marginBottom: 8,
  },
  dropMeta: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    color: "#D4D4D4",
    textTransform: "uppercase",
  },
  card: { flex: 1, marginBottom: spacing.lg, backgroundColor: colors.surface },
  cardLeft: { marginLeft: spacing.lg, marginRight: spacing.sm / 2 },
  cardRight: { marginLeft: spacing.sm / 2, marginRight: spacing.lg },
  cardImage: { width: "100%", aspectRatio: 3 / 4, backgroundColor: colors.muted },
  cardSeller: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.mutedFg,
    marginTop: 8,
  },
  cardName: { fontFamily: fonts.heading, fontSize: 18, color: colors.primary, marginTop: 2 },
  cardPrice: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary, marginTop: 4 },
});

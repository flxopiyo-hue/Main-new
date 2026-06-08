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
import { api, Item, TryOnResult } from "@/src/lib/api";
import { dataUriFromBase64 } from "@/src/lib/images";
import { shareBase64Image } from "@/src/lib/share";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function TryOnHub() {
  const toast = useToast();
  const [history, setHistory] = useState<TryOnResult[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [h, i] = await Promise.all([api.tryOnHistory(), api.listItems()]);
      setHistory(h);
      setItems(i.slice(0, 6));
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

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={tp.caption}>VIRTUAL FITTING ROOM</Text>
        <Text style={[tp.h2, styles.title]}>Try it on.</Text>
        <Text style={[tp.bodyMuted, styles.sub]}>
          Pick a piece — we&apos;ll dress your photo with AI.
        </Text>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          testID="tryon-history-list"
          data={history}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.scroll}
          ListHeaderComponent={
            <>
              <Text style={[tp.caption, styles.section]}>Quick pick</Text>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={items}
                keyExtractor={(i) => i.id}
                contentContainerStyle={styles.itemsRow}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    testID={`tryon-quick-${item.id}`}
                    style={styles.quickItem}
                    onPress={() => router.push(`/item/${item.id}?tryon=1`)}
                  >
                    <Image
                      source={{ uri: dataUriFromBase64(item.image_b64) }}
                      style={styles.quickImage}
                      resizeMode="cover"
                    />
                    <Text style={styles.quickLabel} numberOfLines={2}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                )}
              />
              <View style={{ height: spacing.xl }} />
              <Text style={[tp.caption, styles.section]}>Your try-ons</Text>
            </>
          }
          renderItem={({ item }) => (
            <View style={styles.historyCard} testID={`tryon-history-${item.id}`}>
              <Image
                source={{ uri: dataUriFromBase64(item.result_image_b64) }}
                style={styles.historyImage}
                resizeMode="cover"
              />
              <View style={styles.historyActions}>
                {item.fit_summary ? (
                  <View style={styles.fitBanner}>
                    <Feather name="check-circle" size={14} color={colors.primaryFg} />
                    <Text style={styles.fitText}>{item.fit_summary}</Text>
                  </View>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                <TouchableOpacity
                  testID={`tryon-share-${item.id}`}
                  style={styles.shareBtn}
                  onPress={async () => {
                    try {
                      const data = await api.shareTryOn(item.id);
                      const ok = await shareBase64Image(data.image_b64, "aurafit-tryon");
                      if (!ok) toast.show("Sharing not available", "error");
                    } catch (e: any) {
                      toast.show(e?.message ?? "Could not share", "error");
                    }
                  }}
                >
                  <Feather name="share-2" size={16} color={colors.primaryFg} />
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyHistory}>
              <Feather name="camera" size={28} color={colors.mutedFg} />
              <Text style={[tp.bodyMuted, { marginTop: spacing.sm, textAlign: "center" }]}>
                No try-ons yet. Tap a piece above to begin.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { marginTop: 6 },
  sub: { marginTop: spacing.sm, maxWidth: 320 },
  scroll: { paddingBottom: spacing.xxl, paddingTop: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  section: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  itemsRow: { paddingHorizontal: spacing.lg, gap: spacing.md },
  quickItem: { width: 130 },
  quickImage: { width: 130, height: 170, backgroundColor: colors.muted },
  quickLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.primary, marginTop: 8 },
  historyCard: { paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  historyImage: { width: "100%", aspectRatio: 3 / 4, backgroundColor: colors.muted },
  fitBanner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
    padding: spacing.sm,
  },
  fitText: { color: colors.primaryFg, fontFamily: fonts.bodyMedium, fontSize: 13, flex: 1 },
  historyActions: { flexDirection: "row", alignItems: "stretch" },
  shareBtn: {
    width: 56,
    backgroundColor: "#1F1F1F",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyHistory: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
});

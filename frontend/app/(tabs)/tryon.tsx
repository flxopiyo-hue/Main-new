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

import { ActiveProfileChip } from "@/src/components/ActiveProfileChip";
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
  // "recent" shows every generation; "saved" shows only pinned ones —
  // this is the private Saved board.
  const [tab, setTab] = useState<"recent" | "saved">("recent");
  const [pinPending, setPinPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, i] = await Promise.all([
        api.tryOnHistory({ pinned: tab === "saved" }),
        api.listItems(),
      ]);
      setHistory(h);
      setItems(i.slice(0, 6));
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load", "error");
    } finally {
      setLoading(false);
    }
  }, [toast, tab]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const togglePin = async (t: TryOnResult) => {
    if (pinPending) return;
    setPinPending(t.id);
    // Optimistic update — flip the flag locally so the star fills
    // instantly, then reconcile once the server responds.
    const nextPinned = !t.pinned;
    setHistory((prev) =>
      prev.map((row) => (row.id === t.id ? { ...row, pinned: nextPinned } : row)),
    );
    try {
      await api.tryOnPin(t.id, nextPinned);
      toast.show(
        nextPinned ? "Saved to your board" : "Removed from your board",
        "success",
      );
      // On the Saved tab, removing a pin should drop it from the list.
      if (tab === "saved" && !nextPinned) {
        setHistory((prev) => prev.filter((row) => row.id !== t.id));
      }
    } catch (e: any) {
      // Revert optimistic flip on failure.
      setHistory((prev) =>
        prev.map((row) => (row.id === t.id ? { ...row, pinned: !nextPinned } : row)),
      );
      toast.show(e?.message ?? "Could not update saved board", "error");
    } finally {
      setPinPending(null);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={tp.caption}>VIRTUAL FITTING ROOM</Text>
        <Text style={[tp.h2, styles.title]}>Try it on.</Text>
        <Text style={[tp.bodyMuted, styles.sub]}>
          Pick a piece — we&apos;ll dress your photo with AI.
        </Text>
        <View style={{ marginTop: spacing.md }}>
          <ActiveProfileChip testIDPrefix="tryon-profile-chip" />
        </View>
        <TouchableOpacity
          testID="tryon-stylist-cta"
          style={[styles.byoCta, styles.stylistCta]}
          onPress={() => router.push("/stylist")}
          activeOpacity={0.85}
        >
          <View style={[styles.byoIconWrap, { backgroundColor: colors.primary }]}>
            <Feather name="feather" size={20} color={colors.primaryFg} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.byoTitle}>AI Stylist</Text>
            <Text style={styles.byoSub} numberOfLines={2}>
              Looks picked for your skin tone &amp; shape — casual, office, events, dates.
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          testID="tryon-byo-cta"
          style={styles.byoCta}
          onPress={() => router.push("/tryon/byo")}
          activeOpacity={0.85}
        >
          <View style={styles.byoIconWrap}>
            <Feather name="upload-cloud" size={20} color={colors.primaryFg} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.byoTitle}>Try your own garment</Text>
            <Text style={styles.byoSub} numberOfLines={2}>
              Upload a photo of any clothing item — we&apos;ll render it on the active profile.
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.primary} />
        </TouchableOpacity>
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
              {/* Recent vs Saved tabs — Saved is the private board of
                  pinned try-ons. */}
              <View style={styles.tabsRow}>
                <TouchableOpacity
                  testID="tryon-tab-recent"
                  onPress={() => setTab("recent")}
                  style={[styles.tabBtn, tab === "recent" && styles.tabBtnActive]}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[styles.tabLabel, tab === "recent" && styles.tabLabelActive]}
                  >
                    RECENT
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="tryon-tab-saved"
                  onPress={() => setTab("saved")}
                  style={[styles.tabBtn, tab === "saved" && styles.tabBtnActive]}
                  activeOpacity={0.85}
                >
                  <Feather
                    name="bookmark"
                    size={14}
                    color={tab === "saved" ? colors.primaryFg : colors.primary}
                  />
                  <Text
                    style={[styles.tabLabel, tab === "saved" && styles.tabLabelActive]}
                  >
                    SAVED
                  </Text>
                </TouchableOpacity>
              </View>
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
                  testID={`tryon-pin-${item.id}`}
                  style={[styles.actionBtn, item.pinned && styles.actionBtnActive]}
                  onPress={() => togglePin(item)}
                  disabled={pinPending === item.id}
                  accessibilityLabel={item.pinned ? "Remove from Saved" : "Save to board"}
                >
                  <Feather
                    name="bookmark"
                    size={16}
                    color={colors.primaryFg}
                    // Filled bookmark when pinned (Feather doesn't ship a
                    // pre-filled variant; overriding the fill via style
                    // isn't supported, so we lean on the amber background
                    // to signal "on").
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`tryon-share-${item.id}`}
                  style={styles.actionBtn}
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
              <Feather
                name={tab === "saved" ? "bookmark" : "camera"}
                size={28}
                color={colors.mutedFg}
              />
              <Text style={[tp.bodyMuted, { marginTop: spacing.sm, textAlign: "center" }]}>
                {tab === "saved"
                  ? "No saved looks yet. Tap the bookmark on any try-on to pin it here."
                  : "No try-ons yet. Tap a piece above to begin."}
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
  actionBtn: {
    width: 56,
    backgroundColor: "#1F1F1F",
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
    borderLeftColor: "#0F0F0F",
  },
  actionBtnActive: {
    backgroundColor: colors.primary,
  },
  tabsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  tabBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    height: 34,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.4,
    color: colors.primary,
  },
  tabLabelActive: { color: colors.primaryFg },
  emptyHistory: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
  byoCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  byoIconWrap: {
    width: 40,
    height: 40,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  byoTitle: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  byoSub: { fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg, marginTop: 2 },
  stylistCta: { borderColor: colors.primary, marginTop: spacing.lg },
});

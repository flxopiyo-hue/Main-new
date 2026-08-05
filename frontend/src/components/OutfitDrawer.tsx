// OutfitDrawer — a bottom sheet that previews the staged outfit and lets the
// user generate the multi-garment AI try-on.
//
// Items are displayed innermost → outermost (LAYER_ORDER) with the styling
// rules listed beneath. "Try outfit on" calls /api/tryon/outfit and navigates
// to /outfit/result so the user sees the composed multi-angle image.

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { PaywallModal } from "@/src/components/PaywallModal";
import { useToast } from "@/src/components/Toast";
import { api, isPaywallError } from "@/src/lib/api";
import { dataUriFromBase64 } from "@/src/lib/images";
import {
  deriveOutfitRules,
  layerLabel,
  sortByLayer,
  useOutfit,
} from "@/src/lib/outfit";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface DrawerProps {
  visible: boolean;
  onClose: () => void;
}

export function OutfitDrawer({ visible, onClose }: DrawerProps) {
  const toast = useToast();
  const items = useOutfit((s) => s.items);
  const remove = useOutfit((s) => s.remove);
  const clear = useOutfit((s) => s.clear);
  const [generating, setGenerating] = useState(false);
  // Paywall modal state — fires when the backend returns 402 for a Free
  // user requesting multi-angle output.
  const [paywallInfo, setPaywallInfo] = useState<{ feature?: string; message?: string } | null>(null);

  const sorted = useMemo(() => sortByLayer(items), [items]);
  const rules = useMemo(() => deriveOutfitRules(sorted), [sorted]);

  const tryOnOutfit = async (multi: boolean) => {
    if (items.length === 0) return;
    setGenerating(true);
    try {
      const result = await api.tryOnOutfit({
        item_ids: sorted.map((i) => i.id),
        use_profile_photo: true,
        angles: multi ? ["front", "side", "back"] : ["front"],
      });
      onClose();
      router.push({
        pathname: "/outfit/result",
        params: { id: result.id },
      });
    } catch (e: any) {
      if (isPaywallError(e)) {
        // Keep the drawer open behind the modal so the buyer can retry
        // single-angle immediately after dismissing.
        setPaywallInfo({ feature: e.feature, message: e.message });
      } else {
        const msg = e?.message ?? "Outfit try-on failed";
        if (msg.toLowerCase().includes("body photo")) {
          toast.show("Add a front photo in your profile first", "error");
          router.push("/onboarding/measurements");
        } else {
          toast.show(msg, "error");
        }
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      // "none" — RN-web's slide/fade animations can miss their
      // animationend event and leave the sheet stuck off-screen or
      // half-faded, making the Generate buttons untappable. Instant
      // presentation is deterministic on web and native.
      animationType="none"
      onRequestClose={onClose}
      testID="outfit-drawer-modal"
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={["bottom"]} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={tp.caption}>YOUR OUTFIT</Text>
              <Text style={[tp.h2, { marginTop: 4 }]}>
                {items.length} piece{items.length === 1 ? "" : "s"}
              </Text>
            </View>
            {items.length > 0 ? (
              <TouchableOpacity
                testID="outfit-drawer-clear"
                onPress={() => {
                  clear();
                  toast.show("Outfit cleared", "success");
                }}
              >
                <Text style={styles.clearLabel}>Clear all</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="layers" size={32} color={colors.mutedFg} />
              <Text style={[tp.bodyMuted, styles.emptyText]}>
                Tap{" "}
                <Text style={styles.emptyAccent}>+ Outfit</Text>
                {" "}on any piece to stage a look. We&apos;ll layer them in the right
                order — shirt under jacket, tie at the neck, belt cinching the
                top, socks above the shoes.
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              <Text style={styles.subhead}>Layered, skin → out</Text>
              {sorted.map((item, idx) => (
                <View key={item.id} style={styles.row} testID={`outfit-row-${item.id}`}>
                  <Text style={styles.rowIndex}>{String(idx + 1).padStart(2, "0")}</Text>
                  <Image
                    source={{ uri: dataUriFromBase64(item.image_b64) }}
                    style={styles.rowThumb}
                    resizeMode="cover"
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowType}>
                      {layerLabel(item.garment_type).toUpperCase()}
                    </Text>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.rowSeller} numberOfLines={1}>
                      {item.seller_name}
                    </Text>
                  </View>
                  <TouchableOpacity
                    testID={`outfit-remove-${item.id}`}
                    onPress={() => remove(item.id)}
                    style={styles.rowRemove}
                  >
                    <Feather name="x" size={18} color={colors.mutedFg} />
                  </TouchableOpacity>
                </View>
              ))}

              {rules.length > 0 ? (
                <View style={styles.rulesBlock} testID="outfit-rules">
                  <Text style={styles.subhead}>Styling rules applied</Text>
                  {rules.map((r, i) => (
                    <View key={i} style={styles.ruleRow}>
                      <Feather name="check" size={14} color={colors.primary} />
                      <Text style={styles.ruleText}>{r}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          )}

          {items.length > 0 ? (
            <View style={styles.actions}>
              <AppButton
                testID="outfit-tryon-front-btn"
                label={generating ? "Generating…" : "Try Outfit On · Front"}
                variant="secondary"
                onPress={() => tryOnOutfit(false)}
                loading={generating}
              />
              <View style={{ height: spacing.sm }} />
              <AppButton
                testID="outfit-tryon-multi-btn"
                label="Try Outfit · Front · Side · Back"
                onPress={() => tryOnOutfit(true)}
                loading={generating}
              />
            </View>
          ) : (
            <View style={styles.actions}>
              <AppButton
                testID="outfit-drawer-close"
                label="Got it"
                variant="secondary"
                onPress={onClose}
              />
            </View>
          )}

          {generating ? (
            <View style={styles.generatingOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color={colors.primaryFg} />
              <Text style={styles.generatingText}>Composing your outfit…</Text>
            </View>
          ) : null}
        </SafeAreaView>
      </View>
      <PaywallModal
        visible={!!paywallInfo}
        feature={paywallInfo?.feature}
        message={paywallInfo?.message}
        onClose={() => setPaywallInfo(null)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    paddingTop: spacing.sm,
    maxHeight: "88%",
  },
  handle: {
    alignSelf: "center",
    width: 56,
    height: 4,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  clearLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.4,
    color: colors.mutedFg,
    textTransform: "uppercase",
  },
  empty: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
    alignItems: "center",
    gap: spacing.md,
  },
  emptyText: { textAlign: "center", maxWidth: 320 },
  emptyAccent: { fontFamily: fonts.bodySemi, color: colors.primary },
  list: { flexGrow: 0, flexShrink: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  subhead: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.4,
    color: colors.mutedFg,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowIndex: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.mutedFg,
    width: 24,
  },
  rowThumb: {
    width: 48,
    height: 64,
    backgroundColor: colors.muted,
  },
  rowType: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primary,
  },
  rowName: { fontFamily: fonts.body, fontSize: 13, color: colors.primary, marginTop: 2 },
  rowSeller: { fontFamily: fonts.body, fontSize: 11, color: colors.mutedFg, marginTop: 1 },
  rowRemove: { padding: 6 },
  rulesBlock: { marginTop: spacing.lg },
  ruleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: 4,
  },
  ruleText: { fontFamily: fonts.body, fontSize: 13, color: colors.primary, flex: 1 },
  actions: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  generatingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,10,10,0.55)",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  generatingText: {
    fontFamily: fonts.bodyMedium,
    color: colors.primaryFg,
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
});

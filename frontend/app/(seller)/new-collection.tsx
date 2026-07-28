import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { useToast } from "@/src/components/Toast";
import { api, Item } from "@/src/lib/api";
import { dataUriFromBase64 } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function NewCollection() {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.myItems();
      setItems(data);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load inventory", "error");
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id: string) => {
    setSelectedIds((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!name.trim()) return toast.show("Name your drop", "error");
    if (selectedIds.size === 0) return toast.show("Add at least one piece", "error");
    setSaving(true);
    try {
      await api.createCollection({
        name: name.trim(),
        description: description.trim(),
        item_ids: Array.from(selectedIds),
      });
      toast.show("Drop published", "success");
      router.replace("/(tabs)/atelier");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not publish", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="new-collection-back-btn"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption}>NEW DROP</Text>
        <View style={styles.iconBtn} />
      </View>
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        bottomOffset={120}
      >
        <Text style={[tp.h2, { marginBottom: spacing.lg }]}>Curate a drop</Text>
        <AppInput
          testID="new-collection-name-input"
          label="Drop name"
          value={name}
          onChangeText={setName}
          placeholder="Spring '26 Edit"
        />
        <AppInput
          testID="new-collection-desc-input"
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="A short story behind the drop"
          multiline
        />

        <Text style={[tp.caption, { marginTop: spacing.md, marginBottom: spacing.sm }]}>
          Pieces in this drop
        </Text>
        {items.length === 0 ? (
          <Text style={tp.bodyMuted}>You don&apos;t have any pieces yet. Publish items first.</Text>
        ) : (
          <View style={styles.grid}>
            {items.map((it) => {
              const on = selectedIds.has(it.id);
              return (
                <TouchableOpacity
                  key={it.id}
                  testID={`new-collection-pick-${it.id}`}
                  onPress={() => toggle(it.id)}
                  activeOpacity={0.85}
                  style={styles.tile}
                >
                  <View style={styles.tileImageWrap}>
                    <Image
                      source={{ uri: dataUriFromBase64(it.image_b64) }}
                      style={styles.tileImage}
                      resizeMode="cover"
                    />
                    {on ? (
                      <View style={styles.checkOverlay}>
                        <Feather name="check" size={18} color={colors.primaryFg} />
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.tileName} numberOfLines={2}>
                    {it.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        <View style={{ height: 80 }} />
      </KeyboardAwareScrollView>
      <View style={styles.footer}>
        <Text style={[tp.bodyMuted, { marginBottom: spacing.sm }]}>
          {selectedIds.size} selected
        </Text>
        <AppButton
          testID="new-collection-submit-btn"
          label="Publish Drop"
          onPress={submit}
          loading={saving}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: { width: 40, height: 32, justifyContent: "center" },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -spacing.sm / 2 },
  tile: { width: "50%", paddingHorizontal: spacing.sm / 2, marginBottom: spacing.md },
  tileImageWrap: { position: "relative" },
  tileImage: { width: "100%", aspectRatio: 3 / 4, backgroundColor: colors.muted },
  checkOverlay: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  tileName: { fontFamily: fonts.body, fontSize: 13, color: colors.primary, marginTop: 6 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});

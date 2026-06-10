// Active-profile chip with a tap-to-switch bottom sheet. Drops in at the top
// of Discover and Try-On to drive shopping context (Me / Mateo / Maya …).

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
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

import { useToast } from "@/src/components/Toast";
import { ProfileSummary } from "@/src/lib/api";
import { useProfiles } from "@/src/lib/profiles";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface Props {
  /** When provided, overrides the default "Shopping for" label. */
  contextLabel?: string;
  testIDPrefix?: string;
}

function profileGenderIcon(p: ProfileSummary): keyof typeof Feather.glyphMap {
  if (p.audience === "kid") {
    return p.gender === "female" ? "heart" : "smile";
  }
  return p.is_self ? "user" : p.gender === "female" ? "user" : "user";
}

function profileSubLine(p: ProfileSummary): string {
  if (p.is_self) return "Your body profile";
  const bits: string[] = [];
  if (p.audience === "kid") bits.push("Kid");
  else bits.push("Adult");
  if (p.gender && p.gender !== "prefer_not_to_say") {
    bits.push(p.gender === "male" ? "Boy" : p.gender === "female" ? "Girl" : "Other");
  }
  if (p.age != null) bits.push(`${p.age} yrs`);
  return bits.join(" · ");
}

export function ActiveProfileChip({ contextLabel = "Shopping for", testIDPrefix = "profile-chip" }: Props) {
  const { active, profiles, loading, setActive } = useProfiles();
  const toast = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  const activeName = active?.profile.name ?? "Me";

  const onSelect = async (id: string) => {
    if (id === active?.profile_id) {
      setSheetOpen(false);
      return;
    }
    setSwitching(id);
    try {
      await setActive(id);
      setSheetOpen(false);
    } catch (e: any) {
      toast.show(e?.message ?? "Could not switch profile", "error");
    } finally {
      setSwitching(null);
    }
  };

  return (
    <>
      <TouchableOpacity
        testID={testIDPrefix}
        style={styles.chip}
        onPress={() => setSheetOpen(true)}
        activeOpacity={0.85}
      >
        <Feather name="users" size={14} color={colors.primary} />
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.chipContext} numberOfLines={1}>
            {contextLabel.toUpperCase()}
          </Text>
          <Text style={styles.chipName} numberOfLines={1} testID={`${testIDPrefix}-name`}>
            {activeName}
          </Text>
        </View>
        <Feather name="chevron-down" size={16} color={colors.mutedFg} />
      </TouchableOpacity>

      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSheetOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={[tp.h3, { marginBottom: spacing.sm }]}>Switch profile</Text>
            <Text style={[tp.bodyMuted, { marginBottom: spacing.md }]}>
              Pick who you’re shopping for. Each profile drives Discover filters and Try-On photos.
            </Text>

            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ paddingBottom: spacing.md }}>
                {profiles.map((p) => {
                  const isActive = p.id === active?.profile_id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      testID={`profile-pick-${p.id}`}
                      style={[styles.row, isActive && styles.rowActive]}
                      onPress={() => onSelect(p.id)}
                      activeOpacity={0.85}
                      disabled={switching !== null}
                    >
                      <View style={styles.avatar}>
                        <Feather
                          name={profileGenderIcon(p)}
                          size={18}
                          color={isActive ? colors.primaryFg : colors.primary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.rowName, isActive && { color: colors.primaryFg }]}>
                          {p.name}
                        </Text>
                        <Text style={[styles.rowSub, isActive && { color: "#D4D4D4" }]} numberOfLines={1}>
                          {profileSubLine(p)}
                        </Text>
                      </View>
                      {switching === p.id ? (
                        <ActivityIndicator size="small" color={isActive ? colors.primaryFg : colors.primary} />
                      ) : isActive ? (
                        <Feather name="check" size={18} color={colors.primaryFg} />
                      ) : null}
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity
                  testID="profile-add-new-btn"
                  style={styles.addBtn}
                  onPress={() => {
                    setSheetOpen(false);
                    router.push("/profiles/new");
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="plus" size={18} color={colors.primary} />
                  <Text style={styles.addLabel}>Add loved one</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  testID="profile-manage-btn"
                  onPress={() => {
                    setSheetOpen(false);
                    router.push("/profiles");
                  }}
                  style={styles.manageBtn}
                >
                  <Text style={styles.manageLabel}>Manage profiles →</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  chipContext: {
    fontFamily: fonts.bodyMedium,
    fontSize: 9,
    letterSpacing: 1.3,
    color: colors.mutedFg,
    textTransform: "uppercase",
  },
  chipName: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
  },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.background,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: "85%",
  },
  modalHandle: {
    width: 48,
    height: 4,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  center: { paddingVertical: spacing.xl, alignItems: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  rowActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  rowName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.primary },
  rowSub: { fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg, marginTop: 2 },
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
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.primary,
    textTransform: "uppercase",
  },
  manageBtn: { paddingVertical: spacing.md, alignItems: "center" },
  manageLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.mutedFg,
    letterSpacing: 0.6,
  },
});

// Manage all body profiles (self + loved ones).

import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { LovedOne, api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { useProfiles } from "@/src/lib/profiles";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function ProfilesIndex() {
  const { user, loading: authLoading } = useAuth();
  const { active, refresh, setActive } = useProfiles();
  const toast = useToast();
  const [lovedOnes, setLovedOnes] = useState<LovedOne[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listLovedOnes();
      setLovedOnes(list);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load profiles", "error");
    } finally {
      setLoading(false);
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

  const remove = async (lo: LovedOne) => {
    setDeleting(lo.id);
    try {
      await api.deleteLovedOne(lo.id);
      setLovedOnes((curr) => curr.filter((x) => x.id !== lo.id));
      await refresh();
      toast.show(`${lo.name} removed`, "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not delete profile", "error");
    } finally {
      setDeleting(null);
    }
  };

  const confirmDelete = (lo: LovedOne) => {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(`Remove ${lo.name}?`)) {
        remove(lo);
      }
      return;
    }
    Alert.alert("Remove profile", `Remove ${lo.name}? This won't affect your orders.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => remove(lo) },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="profiles-back-btn"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption}>BODY PROFILES</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[tp.h2, { marginBottom: spacing.sm }]}>Who you’re shopping for</Text>
        <Text style={[tp.bodyMuted, { marginBottom: spacing.lg }]}>
          Switch between profiles any time. Each has its own photos, dimensions, and Discover
          filter.
        </Text>

        {/* Self card */}
        <View style={[styles.card, active?.profile_id === "self" && styles.cardActive]}>
          <View style={styles.cardLeft}>
            <View style={[styles.avatar, active?.profile_id === "self" && styles.avatarLight]}>
              <Feather
                name="user"
                size={18}
                color={active?.profile_id === "self" ? colors.primary : colors.primaryFg}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.name, active?.profile_id === "self" && { color: colors.primaryFg }]}
              >
                Me
              </Text>
              <Text
                style={[
                  styles.sub,
                  active?.profile_id === "self" && { color: "#D4D4D4" },
                ]}
              >
                Your body profile
              </Text>
            </View>
          </View>
          {active?.profile_id === "self" ? (
            <Text style={styles.activeBadge}>ACTIVE</Text>
          ) : (
            <TouchableOpacity
              testID="profile-self-activate"
              onPress={async () => {
                await setActive("self");
                toast.show("Switched to Me", "success");
              }}
            >
              <Text style={styles.activateLink}>Switch</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Loved ones */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : lovedOnes.length === 0 ? (
          <Text style={[tp.bodyMuted, { marginTop: spacing.lg, textAlign: "center" }]}>
            No loved ones yet — add a child, partner, or gift recipient.
          </Text>
        ) : (
          lovedOnes.map((lo) => {
            const isActive = active?.profile_id === lo.id;
            return (
              <TouchableOpacity
                key={lo.id}
                style={[styles.card, isActive && styles.cardActive]}
                testID={`loved-one-card-${lo.id}`}
                onPress={() => router.push({ pathname: "/profiles/new", params: { id: lo.id } })}
                activeOpacity={0.85}
              >
                <View style={styles.cardLeft}>
                  <View style={[styles.avatar, isActive && styles.avatarLight]}>
                    <Feather
                      name={lo.audience === "kid" ? "smile" : "user"}
                      size={18}
                      color={isActive ? colors.primary : colors.primaryFg}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.name, isActive && { color: colors.primaryFg }]}
                      numberOfLines={1}
                    >
                      {lo.name}
                    </Text>
                    <Text
                      style={[styles.sub, isActive && { color: "#D4D4D4" }]}
                      numberOfLines={1}
                    >
                      {lo.audience === "kid" ? "Kid" : "Adult"}
                      {lo.gender && lo.gender !== "prefer_not_to_say"
                        ? ` · ${lo.gender === "male" ? "Boy/M" : lo.gender === "female" ? "Girl/F" : "Other"}`
                        : ""}
                      {lo.age != null ? ` · ${lo.age} yrs` : ""}
                    </Text>
                  </View>
                </View>
                <View style={styles.cardActions}>
                  {isActive ? (
                    <Text style={[styles.activeBadge, { color: colors.primaryFg }]}>ACTIVE</Text>
                  ) : (
                    <TouchableOpacity
                      testID={`loved-one-${lo.id}-activate`}
                      onPress={async (e) => {
                        e.stopPropagation();
                        await setActive(lo.id);
                        toast.show(`Switched to ${lo.name}`, "success");
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.activateLink}>Switch</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    testID={`loved-one-${lo.id}-edit`}
                    onPress={(e) => {
                      e.stopPropagation();
                      router.push({ pathname: "/profiles/new", params: { id: lo.id } });
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    style={styles.iconAction}
                    accessibilityLabel={`Edit ${lo.name}`}
                  >
                    <Feather
                      name="edit-2"
                      size={16}
                      color={isActive ? colors.primaryFg : colors.primary}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID={`loved-one-${lo.id}-delete`}
                    onPress={(e) => {
                      e.stopPropagation();
                      confirmDelete(lo);
                    }}
                    disabled={deleting === lo.id}
                    style={styles.iconAction}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    accessibilityLabel={`Delete ${lo.name}`}
                  >
                    {deleting === lo.id ? (
                      <ActivityIndicator size="small" color={colors.error} />
                    ) : (
                      <Feather name="trash-2" size={16} color={colors.error} />
                    )}
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        <TouchableOpacity
          testID="profiles-add-new-btn"
          style={styles.addBtn}
          onPress={() => router.push("/profiles/new")}
          activeOpacity={0.85}
        >
          <Feather name="plus" size={18} color={colors.primary} />
          <Text style={styles.addLabel}>ADD LOVED ONE</Text>
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
  cardActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  cardLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  cardActions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  avatarLight: { backgroundColor: "#F5F5F4" },
  name: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.primary },
  sub: { fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg, marginTop: 2 },
  activeBadge: {
    fontFamily: fonts.bodySemi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.primary,
  },
  activateLink: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
    letterSpacing: 0.6,
  },
  deleteBtn: { padding: 8 },
  iconAction: { padding: 6, minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center" },
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

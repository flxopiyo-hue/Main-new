// Admin → User management. Search + filter + suspend/unsuspend.

import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { AdminShell } from "@/src/components/AdminShell";
import { useToast } from "@/src/components/Toast";
import { api, Role, User } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const FILTERS: { key: "all" | Role; label: string }[] = [
  { key: "all", label: "All" },
  { key: "buyer", label: "Buyers" },
  { key: "seller", label: "Sellers" },
  { key: "admin", label: "Admins" },
];

export default function AdminUsers() {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [filter, setFilter] = useState<"all" | Role>("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.adminListUsers({
        role: filter === "all" ? undefined : filter,
        q: q.trim() || undefined,
      });
      setUsers(list);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load users", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, q, toast]);

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

  const toggleSuspended = async (u: User) => {
    setUpdating(u.id);
    try {
      const fresh = await api.adminPatchUser(u.id, { suspended: !u.suspended });
      setUsers((curr) => curr.map((x) => (x.id === fresh.id ? fresh : x)));
      toast.show(
        fresh.suspended ? `${fresh.email} suspended` : `${fresh.email} restored`,
        "success",
      );
    } catch (e: any) {
      toast.show(e?.message ?? "Could not update user", "error");
    } finally {
      setUpdating(null);
    }
  };

  return (
    <AdminShell title="Users" subtitle="Search, filter, and suspend or restore accounts.">
      <View style={styles.controls}>
        <View style={styles.searchWrap}>
          <Feather name="search" size={16} color={colors.mutedFg} />
          <TextInput
            testID="admin-users-search"
            value={q}
            onChangeText={setQ}
            onSubmitEditing={load}
            placeholder="Search by name, email, or company…"
            placeholderTextColor={colors.mutedFg}
            autoCapitalize="none"
            style={styles.searchInput}
          />
          {q ? (
            <TouchableOpacity onPress={() => { setQ(""); setTimeout(load, 50); }}>
              <Feather name="x" size={16} color={colors.mutedFg} />
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                testID={`admin-users-filter-${f.key}`}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          testID="admin-users-list"
          data={users}
          keyExtractor={(u) => u.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={[tp.bodyMuted, { textAlign: "center", marginTop: spacing.xl }]}>
              No users match.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.userCard} testID={`admin-user-${item.id}`}>
              <View style={styles.userTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>
                    {item.company_name || item.full_name}
                  </Text>
                  <Text style={tp.bodyMuted} numberOfLines={1}>{item.email}</Text>
                  {item.location ? (
                    <Text style={[tp.bodyMuted, { marginTop: 2 }]}>
                      <Feather name="map-pin" size={11} color={colors.mutedFg} />{" "}
                      {item.location.city}, {item.location.country}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.rolePill, item.suspended && styles.suspendedPill]}>
                  <Text style={[styles.rolePillText, item.suspended && styles.suspendedPillText]}>
                    {item.suspended ? "SUSPENDED" : item.role.toUpperCase()}
                  </Text>
                </View>
              </View>
              <View style={styles.userActions}>
                {item.role !== "admin" ? (
                  <TouchableOpacity
                    testID={`admin-user-${item.id}-toggle`}
                    onPress={() => toggleSuspended(item)}
                    disabled={updating === item.id}
                    style={[
                      styles.actionBtn,
                      item.suspended ? styles.restoreBtn : styles.suspendBtn,
                    ]}
                    activeOpacity={0.85}
                  >
                    {updating === item.id ? (
                      <ActivityIndicator size="small" color={colors.primaryFg} />
                    ) : (
                      <Text style={styles.actionLabel}>
                        {item.suspended ? "RESTORE" : "SUSPEND"}
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <Text style={[tp.bodyMuted, { fontStyle: "italic" }]}>Cannot modify admin</Text>
                )}
              </View>
            </View>
          )}
        />
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  controls: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.primary,
  },
  filterRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 12,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.primary,
  },
  chipLabelActive: { color: colors.primaryFg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  userCard: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginTop: spacing.md,
  },
  userTop: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  userName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.primary },
  rolePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.muted,
  },
  rolePillText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.primary,
  },
  suspendedPill: { backgroundColor: colors.error },
  suspendedPillText: { color: colors.primaryFg },
  userActions: {
    marginTop: spacing.md,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  actionBtn: {
    paddingHorizontal: spacing.md,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 110,
  },
  suspendBtn: { backgroundColor: colors.primary },
  restoreBtn: { backgroundColor: colors.success },
  actionLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.primaryFg,
  },
});

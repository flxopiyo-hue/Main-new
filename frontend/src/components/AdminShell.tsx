// Reusable header + bottom tab navigation for the admin section.

import { Feather } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface Props {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}

const TABS: { path: string; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { path: "/admin", label: "Dashboard", icon: "grid" },
  { path: "/admin/users", label: "Users", icon: "users" },
  { path: "/admin/items", label: "Items", icon: "package" },
  { path: "/admin/orders", label: "Orders", icon: "shopping-bag" },
  { path: "/admin/couriers", label: "Riders", icon: "truck" },
  { path: "/admin/delivery", label: "Fees", icon: "map-pin" },
];

export function AdminShell({ title, subtitle, children, trailing }: Props) {
  const pathname = usePathname();
  const { logout, user } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.replace("/(auth)/welcome");
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={tp.caption} testID="admin-brand">OROMONA · ADMIN</Text>
          <Text style={[tp.h2, styles.title]} testID="admin-title">
            {title}
          </Text>
          {subtitle ? (
            <Text style={[tp.bodyMuted, { marginTop: 2 }]} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {trailing ?? (
          <TouchableOpacity
            testID="admin-logout-btn"
            onPress={handleLogout}
            style={styles.iconBtn}
          >
            <Feather name="log-out" size={20} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>
      {user ? (
        <Text style={styles.userLine} numberOfLines={1}>
          Signed in as <Text style={styles.userBold}>{user.email}</Text>
        </Text>
      ) : null}
      <View style={styles.content}>{children}</View>
      <View style={styles.bottomBar}>
        {TABS.map((t) => {
          const active = pathname === t.path;
          return (
            <TouchableOpacity
              key={t.path}
              testID={`admin-tab-${t.label.toLowerCase()}`}
              style={styles.tabBtn}
              onPress={() => router.replace(t.path as any)}
              activeOpacity={0.85}
            >
              <Feather
                name={t.icon}
                size={20}
                color={active ? colors.primary : colors.mutedFg}
              />
              <Text
                style={[styles.tabLabel, active && styles.tabLabelActive]}
                numberOfLines={1}
              >
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  title: { marginTop: 6 },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  userLine: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
  },
  userBold: { fontFamily: fonts.bodySemi, color: colors.primary },
  content: { flex: 1 },
  bottomBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
  },
  tabBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  tabLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: colors.mutedFg,
  },
  tabLabelActive: { color: colors.primary },
});

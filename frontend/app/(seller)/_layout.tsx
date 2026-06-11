import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/lib/auth";
import { colors, fonts } from "@/src/lib/theme";

/**
 * Seller-only tab navigator. Strict RBAC: anyone who isn't a seller is
 * bounced out. The seller portal lives in its own route group `/(seller)`
 * which contains EXACTLY four navigable tabs per spec:
 *
 *    Inventory · Analytics · Orders · Settings
 *
 * The Add-Item wizard is reachable via a button on Inventory but is NOT
 * a tab (it's a one-off task, not a destination). Buyer surfaces
 * (Discover, Try-On canvas, Atelier, etc.) are not imported anywhere in
 * this subtree.
 */
export default function SellerTabsLayout() {
  const insets = useSafeAreaInsets();
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Redirect href="/welcome" />;
  if (user.role === "admin") return <Redirect href="/admin" />;
  if (user.role !== "seller") return <Redirect href="/(tabs)" />;

  const bottomInset = Math.max(insets.bottom, Platform.OS === "ios" ? 8 : 10);
  const barHeight = 80 + bottomInset;

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: "#A3A3A3",
        tabBarShowLabel: true,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          fontFamily: fonts.bodyMedium,
          fontSize: 10,
          lineHeight: 14,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          marginTop: 2,
        },
        tabBarItemStyle: { paddingTop: 8, paddingBottom: 4 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          height: barHeight,
          paddingTop: 6,
          paddingBottom: bottomInset,
        },
        tabBarIcon: ({ color, focused }) => {
          let icon: keyof typeof Feather.glyphMap = "grid";
          if (route.name === "index") icon = "grid";
          if (route.name === "analytics") icon = "bar-chart-2";
          if (route.name === "orders") icon = "package";
          if (route.name === "settings") icon = "settings";
          return <Feather name={icon} size={focused ? 22 : 20} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Inventory" }} />
      <Tabs.Screen name="analytics" options={{ title: "Analytics" }} />
      <Tabs.Screen name="orders" options={{ title: "Orders" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />

      {/* Non-tab routes that still belong inside the seller stack so the
          bottom tab bar shows while they're open. `href: null` keeps them
          off the visible tab strip. */}
      <Tabs.Screen
        name="add-item"
        options={{ title: "Add Item", href: null }}
      />
      <Tabs.Screen
        name="payouts"
        options={{ title: "Payouts", href: null }}
      />
    </Tabs>
  );
}

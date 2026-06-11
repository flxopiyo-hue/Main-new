import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/lib/auth";
import { colors, fonts } from "@/src/lib/theme";

/**
 * Role-aware tab bar.
 *
 * Buyer  → Discover · Try On · Atelier (saved/queue) · Profile
 * Seller → Inventory · Add Item · Payouts · Profile
 *          (sellers never see Discover/Try-On — they're for shoppers.)
 *
 * We always declare every Tabs.Screen so expo-router stays happy with the
 * underlying files; tabs that aren't relevant for the current role are
 * hidden via `href: null` so they don't appear in the bottom bar and
 * deep-links to them just no-op silently.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isSeller = user?.role === "seller";

  // Compute a tab bar tall enough to comfortably hold a 22px icon and an
  // uppercase 10px label without cropping. The bar still honours the
  // device's safe-area inset so the iOS home indicator never collides with
  // the labels.
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
          marginBottom: 0,
        },
        tabBarItemStyle: {
          paddingTop: 8,
          paddingBottom: 4,
        },
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
          // Buyer tabs
          if (route.name === "index") icon = "compass";
          if (route.name === "tryon") icon = "camera";
          if (route.name === "atelier") icon = "package";
          // Seller tabs
          if (route.name === "inventory") icon = "grid";
          if (route.name === "add-item") icon = "plus-square";
          if (route.name === "payouts") icon = "credit-card";
          // Shared
          if (route.name === "profile") icon = "user";
          return <Feather name={icon} size={focused ? 22 : 20} color={color} />;
        },
      })}
    >
      {/* --- Buyer tabs (hidden when seller) --- */}
      <Tabs.Screen
        name="index"
        options={{ title: "Discover", href: isSeller ? null : "/" }}
      />
      <Tabs.Screen
        name="tryon"
        options={{ title: "Try On", href: isSeller ? null : "/tryon" }}
      />
      <Tabs.Screen
        name="atelier"
        options={{ title: "Atelier", href: isSeller ? null : "/atelier" }}
      />

      {/* --- Seller tabs (hidden when buyer/admin) --- */}
      <Tabs.Screen
        name="inventory"
        options={{
          title: "Inventory",
          href: isSeller ? "/inventory" : null,
        }}
      />
      <Tabs.Screen
        name="add-item"
        options={{
          title: "Add Item",
          href: isSeller ? "/add-item" : null,
        }}
      />
      <Tabs.Screen
        name="payouts"
        options={{
          title: "Payouts",
          href: isSeller ? "/payouts" : null,
        }}
      />

      {/* --- Shared --- */}
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}

import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/lib/auth";
import { colors, fonts } from "@/src/lib/theme";

/**
 * Buyer-only tab navigator.
 *
 * Strict RBAC: any non-buyer who lands here is bounced to their correct
 * portal. Sellers go to `/(seller)`, admins to `/admin`, anonymous to
 * `/welcome`. The seller portal lives in a SEPARATE route group
 * (`/(seller)`) so no buyer screen module is ever imported into the
 * seller bundle — deep-links to /tryon, /atelier, etc. while logged in
 * as a seller resolve here and immediately redirect.
 */
export default function BuyerTabsLayout() {
  const insets = useSafeAreaInsets();
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Redirect href="/welcome" />;
  if (user.role === "admin") return <Redirect href="/admin" />;
  if (user.role === "seller") return <Redirect href="/(seller)" />;

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
          if (route.name === "index") icon = "compass";
          if (route.name === "tryon") icon = "camera";
          if (route.name === "atelier") icon = "package";
          if (route.name === "profile") icon = "user";
          return <Feather name={icon} size={focused ? 22 : 20} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Discover" }} />
      <Tabs.Screen name="tryon" options={{ title: "Try On" }} />
      <Tabs.Screen name="atelier" options={{ title: "Atelier" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
      {/* Legacy redirect files — keep them hidden from the buyer tab bar.
          They exist purely to bounce stale deep-links into /(seller). */}
      <Tabs.Screen name="inventory" options={{ href: null }} />
      <Tabs.Screen name="add-item" options={{ href: null }} />
      <Tabs.Screen name="payouts" options={{ href: null }} />
    </Tabs>
  );
}

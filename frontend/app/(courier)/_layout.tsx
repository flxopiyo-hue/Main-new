// Courier (boda rider) portal — tab navigator. Strict RBAC: only
// courier-role accounts get in; everyone else is bounced to their home.

import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/lib/auth";
import { colors, fonts } from "@/src/lib/theme";

export default function CourierTabsLayout() {
  const insets = useSafeAreaInsets();
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Redirect href="/welcome" />;
  if (user.role === "admin") return <Redirect href="/admin" />;
  if (user.role === "seller") return <Redirect href="/(seller)" />;
  if (user.role !== "courier") return <Redirect href="/(tabs)" />;

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
          let icon: keyof typeof Feather.glyphMap = "truck";
          if (route.name === "index") icon = "truck";
          if (route.name === "earnings") icon = "dollar-sign";
          return <Feather name={icon} size={focused ? 22 : 20} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Jobs" }} />
      <Tabs.Screen name="earnings" options={{ title: "Earnings" }} />
      {/* Job detail lives inside the courier stack but off the tab strip. */}
      <Tabs.Screen name="job/[id]" options={{ title: "Job", tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
    </Tabs>
  );
}

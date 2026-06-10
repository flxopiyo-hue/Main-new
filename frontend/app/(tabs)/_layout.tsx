import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/lib/auth";
import { colors, fonts } from "@/src/lib/theme";

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
      <Tabs.Screen
        name="atelier"
        options={{
          title: "Atelier",
          href: isSeller ? "/atelier" : null,
        }}
      />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}

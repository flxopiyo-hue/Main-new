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

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: "#A3A3A3",
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontFamily: fonts.bodyMedium,
          fontSize: 10,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          marginBottom: Platform.OS === "ios" ? 0 : 4,
        },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          height: 64 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
        },
        tabBarIcon: ({ color }) => {
          let icon: keyof typeof Feather.glyphMap = "grid";
          if (route.name === "index") icon = "compass";
          if (route.name === "tryon") icon = "camera";
          if (route.name === "atelier") icon = "package";
          if (route.name === "profile") icon = "user";
          return <Feather name={icon} size={20} color={color} />;
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

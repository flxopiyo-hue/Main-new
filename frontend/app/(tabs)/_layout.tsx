import { Feather } from "@expo/vector-icons";
import { Redirect, router, Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/lib/auth";
import { exitPreview, usePreviewAsBuyer } from "@/src/lib/previewMode";
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
 *
 * Exception: when `previewAsBuyer` is true (set via the seller's
 * HeaderMenu → "View as buyer"), we let sellers in for a read-only
 * preview so they can sanity-check their listings as a shopper would
 * see them. A persistent banner above the tab bar makes it obvious
 * they're in preview mode and offers a one-tap exit.
 */
export default function BuyerTabsLayout() {
  const insets = useSafeAreaInsets();
  const { user, loading } = useAuth();
  const previewAsBuyer = usePreviewAsBuyer();

  if (loading) return null;
  if (!user) return <Redirect href="/welcome" />;
  if (user.role === "admin") return <Redirect href="/admin" />;
  if (user.role === "seller" && !previewAsBuyer) return <Redirect href="/(seller)" />;

  const bottomInset = Math.max(insets.bottom, Platform.OS === "ios" ? 8 : 10);
  const barHeight = 80 + bottomInset;

  return (
    <View style={{ flex: 1 }}>
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
      </Tabs>
      {user.role === "seller" && previewAsBuyer ? (
        <TouchableOpacity
          testID="preview-banner-exit"
          onPress={() => {
            exitPreview();
            router.replace("/(seller)");
          }}
          activeOpacity={0.85}
          style={[styles.previewBanner, { bottom: barHeight + 6 }]}
        >
          <Feather name="eye" size={14} color={colors.primaryFg} />
          <Text style={styles.previewLabel}>
            Previewing as buyer · Tap to exit
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  previewBanner: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    backgroundColor: colors.primary,
    borderRadius: 24,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 6,
  },
  previewLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.primaryFg,
    textTransform: "uppercase",
  },
});

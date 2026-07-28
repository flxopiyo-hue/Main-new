// Compact top-right header menu used on both buyer (Discover) and seller
// (Inventory) home screens. Surfaces the actions that previously lived
// buried in the Profile tab:
//
//   • "View as buyer" — sellers can preview their portal as a shopper
//     without switching their actual role (does NOT mint a new JWT).
//   • "Switch to Buyer mode" / "Switch to Seller mode" — flips the user
//     role on the server (mints a new token) and routes to the matching
//     home stack.
//   • "Sign out" — clears the token and bounces to /welcome.
//
// Implementation note: we render the dropdown via React Native Modal so
// it floats above everything (including the bottom tab bar). The trigger
// is a circular icon button with the user's first initial so it doubles
// as an avatar.

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useToast } from "@/src/components/Toast";
import { useAuth } from "@/src/lib/auth";
import { enterPreview } from "@/src/lib/previewMode";
import { colors, fonts, spacing } from "@/src/lib/theme";

interface Props {
  testID?: string;
}

export function HeaderMenu({ testID }: Props) {
  const { user, toggleRole, logout } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const initial = (user.full_name || user.email || "?")[0]?.toUpperCase() ?? "?";
  const isSeller = user.role === "seller";

  const close = () => setOpen(false);

  const onViewAsBuyer = () => {
    close();
    enterPreview();
    // Navigates into the buyer tab navigator. The buyer layout reads
    // the previewMode module and skips its seller→/(seller) redirect
    // for the duration of the session.
    router.replace("/(tabs)");
  };

  const onSwitchRole = async () => {
    close();
    const target: "buyer" | "seller" = isSeller ? "buyer" : "seller";
    setBusy(true);
    try {
      // Sellers that started life as buyers may not have onboarded as
      // sellers yet — we forward them through onboarding when switching
      // *to* seller. Switching back to buyer is always safe.
      if (target === "seller") {
        const hasSellerData =
          !!user.company_name && !!user.location?.city && !!user.location?.country;
        if (!hasSellerData) {
          router.push("/seller-onboarding");
          return;
        }
      }
      await toggleRole({ to: target });
      toast.show(
        target === "seller" ? "Switched to Seller mode" : "Switched to Buyer mode",
        "success",
      );
      router.replace(target === "seller" ? "/(seller)" : "/(tabs)");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not switch", "error");
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    close();
    await logout();
    router.replace("/(auth)/welcome");
  };

  return (
    <>
      <TouchableOpacity
        testID={testID ?? "header-menu-btn"}
        onPress={() => setOpen(true)}
        style={styles.trigger}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Open profile menu"
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={styles.triggerLabel}>{initial}</Text>
        )}
      </TouchableOpacity>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <Pressable style={styles.backdrop} onPress={close} testID="header-menu-backdrop">
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.headerRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarLabel}>{initial}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName} numberOfLines={1}>
                  {user.full_name || user.email}
                </Text>
                <Text style={styles.userRole}>
                  {user.role.toUpperCase()} MODE
                </Text>
              </View>
            </View>

            {isSeller ? (
              <MenuItem
                testID="header-menu-view-as-buyer"
                icon="eye"
                label="View as buyer"
                hint="Preview shop without switching"
                onPress={onViewAsBuyer}
              />
            ) : null}

            <MenuItem
              testID="header-menu-toggle-role"
              icon={isSeller ? "shopping-bag" : "briefcase"}
              label={isSeller ? "Switch to Buyer mode" : "Switch to Seller mode"}
              hint={isSeller ? "Shop with your buyer profile" : "Open your atelier dashboard"}
              onPress={onSwitchRole}
            />

            <MenuItem
              testID="header-menu-profile"
              icon="user"
              label="Profile & settings"
              onPress={() => {
                close();
                if (isSeller) router.push("/(seller)/settings");
                else router.push("/(tabs)/profile");
              }}
            />

            <View style={styles.divider} />

            <MenuItem
              testID="header-menu-signout"
              icon="log-out"
              label="Sign out"
              destructive
              onPress={onSignOut}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onPress,
  destructive,
  testID,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  hint?: string;
  onPress: () => void;
  destructive?: boolean;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      style={styles.item}
      activeOpacity={0.7}
    >
      <View style={[styles.itemIcon, destructive && { borderColor: colors.error }]}>
        <Feather
          name={icon}
          size={16}
          color={destructive ? colors.error : colors.primary}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.itemLabel,
            destructive && { color: colors.error },
          ]}
        >
          {label}
        </Text>
        {hint ? <Text style={styles.itemHint}>{hint}</Text> : null}
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedFg} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  triggerLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.primary,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10,10,10,0.45)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 80,
    paddingRight: 12,
  },
  sheet: {
    width: 320,
    maxWidth: "100%",
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLabel: {
    fontFamily: fonts.heading,
    fontSize: 20,
    color: colors.primaryFg,
  },
  userName: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.primary,
  },
  userRole: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.mutedFg,
    marginTop: 2,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  itemLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.primary,
  },
  itemHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
});

// OutfitPill — floating call-to-action shown on Discover when at least one
// piece is staged. Tap → opens the OutfitDrawer.

import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useOutfit } from "@/src/lib/outfit";
import { colors, fonts, spacing } from "@/src/lib/theme";

interface PillProps {
  onPress: () => void;
  testID?: string;
}

export function OutfitPill({ onPress, testID = "outfit-pill" }: PillProps) {
  const count = useOutfit((s) => s.items.length);
  if (count === 0) return null;
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <Pressable testID={testID} onPress={onPress} style={styles.pill}>
        <Feather name="layers" size={14} color={colors.primaryFg} />
        <Text style={styles.label}>
          Outfit · {count} piece{count === 1 ? "" : "s"}
        </Text>
        <Feather name="chevron-right" size={16} color={colors.primaryFg} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 14,
    backgroundColor: colors.primary,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.4,
    color: colors.primaryFg,
    textTransform: "uppercase",
  },
});

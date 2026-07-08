// Small check-mark chip shown next to a seller's name once they cross
// the paid-orders threshold (see `core/seller_verify.py`). Kept as a
// standalone component so we can drop it into card headers, item
// detail, and admin lists with a single import.
//
// Two visual sizes:
//   • "sm" — 14×14, no label, used on Discover card overlays where real
//            estate is tight (only the checkmark shows).
//   • "md" — pill with "VERIFIED" label, used on Item Detail.

import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, fonts } from "@/src/lib/theme";

interface Props {
  verified?: boolean;
  size?: "sm" | "md";
  testID?: string;
}

export function VerifiedBadge({ verified, size = "md", testID }: Props) {
  if (!verified) return null;
  if (size === "sm") {
    return (
      <View
        testID={testID ?? "verified-badge-sm"}
        style={styles.dot}
        accessibilityLabel="Verified seller"
      >
        <Feather name="check" size={9} color={colors.primaryFg} />
      </View>
    );
  }
  return (
    <View
      testID={testID ?? "verified-badge"}
      style={styles.pill}
      accessibilityLabel="Verified seller"
    >
      <Feather name="check" size={10} color={colors.primaryFg} />
      <Text style={styles.pillLabel}>VERIFIED</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.primary,
  },
  pillLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.primaryFg,
  },
});

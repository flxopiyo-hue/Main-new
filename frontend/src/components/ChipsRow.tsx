// Categorical chip row (horizontal scroll, sticky). Matches design guidelines.

import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";

import { colors, fonts, spacing } from "@/src/lib/theme";

interface Chip {
  key: string;
  label: string;
}

interface Props {
  chips: Chip[];
  active: string | null;
  onPress: (key: string | null) => void;
  testIDPrefix?: string;
}

export function ChipsRow({ chips, active, onPress, testIDPrefix = "chip" }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.row}
      contentContainerStyle={styles.content}
    >
      {chips.map((c) => {
        const selected = active === c.key;
        return (
          <TouchableOpacity
            key={c.key}
            testID={`${testIDPrefix}-${c.key}`}
            onPress={() => onPress(selected ? null : c.key)}
            activeOpacity={0.8}
            style={[styles.chip, selected ? styles.chipActive : styles.chipInactive]}
          >
            <Text style={[styles.label, selected ? styles.labelActive : styles.labelInactive]}>
              {c.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 56,
    backgroundColor: colors.background,
  },
  content: {
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    alignItems: "center",
  },
  chip: {
    height: 36,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 0,
    flexShrink: 0,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipInactive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  labelActive: { color: colors.primaryFg },
  labelInactive: { color: colors.primary },
});

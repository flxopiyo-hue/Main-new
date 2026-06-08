// Reusable AuraFit primary/secondary button. Sharp corners, uppercase label.

import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, ViewStyle } from "react-native";

import { colors, spacing, type as tp } from "@/src/lib/theme";

interface Props {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  style?: ViewStyle;
  fullWidth?: boolean;
}

export function AppButton({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  testID,
  style,
  fullWidth = true,
}: Props) {
  const isPrimary = variant === "primary";
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[
        styles.base,
        isPrimary ? styles.primary : styles.secondary,
        fullWidth && styles.fullWidth,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.primaryFg : colors.primary} />
      ) : (
        <Text
          style={[
            tp.buttonLabel,
            { color: isPrimary ? colors.primaryFg : colors.primary },
          ]}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  fullWidth: { alignSelf: "stretch" },
  disabled: { opacity: 0.45 },
});

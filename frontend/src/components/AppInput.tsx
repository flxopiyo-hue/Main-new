// Underline-style text input following the editorial design language.

import React from "react";
import { StyleSheet, Text, TextInput, TextInputProps, View } from "react-native";

import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface Props extends TextInputProps {
  label: string;
  errorText?: string | null;
  testID?: string;
}

export function AppInput({ label, errorText, style, testID, ...rest }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={[tp.caption, styles.label]}>{label}</Text>
      <TextInput
        {...rest}
        testID={testID}
        placeholderTextColor={colors.mutedFg}
        style={[styles.input, style]}
      />
      {errorText ? (
        <Text style={styles.error} testID={testID ? `${testID}-error` : undefined}>
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: { marginBottom: spacing.sm },
  input: {
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.primary,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.error,
    marginTop: spacing.xs,
  },
});

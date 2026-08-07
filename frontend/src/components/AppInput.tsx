// Underline-style text input following the editorial design language.
//
// When `secureTextEntry` is set, an eye toggle is rendered inside the
// field so users can show/hide their password (login, register, reset).

import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface Props extends TextInputProps {
  label: string;
  errorText?: string | null;
  testID?: string;
}

export function AppInput({ label, errorText, style, testID, secureTextEntry, ...rest }: Props) {
  const [showSecret, setShowSecret] = useState(false);
  const isSecret = !!secureTextEntry;
  return (
    <View style={styles.wrap}>
      <Text style={[tp.caption, styles.label]}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          {...rest}
          testID={testID}
          secureTextEntry={isSecret && !showSecret}
          placeholderTextColor={colors.mutedFg}
          style={[styles.input, isSecret && styles.inputWithToggle, style]}
        />
        {isSecret ? (
          <TouchableOpacity
            testID={testID ? `${testID}-toggle` : undefined}
            onPress={() => setShowSecret((v) => !v)}
            style={styles.toggleBtn}
            accessibilityRole="button"
            accessibilityLabel={showSecret ? "Hide password" : "Show password"}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather
              name={showSecret ? "eye-off" : "eye"}
              size={18}
              color={colors.mutedFg}
            />
          </TouchableOpacity>
        ) : null}
      </View>
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
  inputRow: { position: "relative", justifyContent: "center" },
  input: {
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.primary,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  inputWithToggle: { paddingRight: 40 },
  toggleBtn: {
    position: "absolute",
    right: 0,
    height: "100%",
    minWidth: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.error,
    marginTop: spacing.xs,
  },
});


// Re-usable circular heart toggle. Optimistic UI; loading hidden for snappy feel.

import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { StyleSheet, TouchableOpacity } from "react-native";

import { api } from "@/src/lib/api";
import { colors } from "@/src/lib/theme";

interface Props {
  itemId: string;
  initial?: boolean;
  size?: number;
  light?: boolean; // when on dark bg
  onChange?: (active: boolean) => void;
  testID?: string;
}

export function HeartButton({
  itemId,
  initial = false,
  size = 22,
  light = false,
  onChange,
  testID,
}: Props) {
  const [active, setActive] = useState(initial);
  useEffect(() => setActive(initial), [initial]);

  const toggle = async () => {
    const next = !active;
    setActive(next);
    onChange?.(next);
    try {
      if (next) await api.addWishlist(itemId);
      else await api.removeWishlist(itemId);
    } catch {
      // revert
      setActive(!next);
      onChange?.(!next);
    }
  };

  const tint = active ? "#FF3B30" : light ? "#FFFFFF" : colors.primary;
  return (
    <TouchableOpacity
      testID={testID ?? `heart-${itemId}`}
      onPress={toggle}
      style={[
        styles.btn,
        { width: size + 16, height: size + 16, backgroundColor: light ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.92)" },
      ]}
      activeOpacity={0.7}
      hitSlop={8}
    >
      <Feather name="heart" size={size} color={tint} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
});

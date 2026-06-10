import { Stack } from "expo-router";
import React from "react";
import { colors } from "@/src/lib/theme";

export default function AddressesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}

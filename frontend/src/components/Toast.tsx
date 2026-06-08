// Subtle toast surface mounted via context, no Alert usage anywhere.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts, spacing } from "@/src/lib/theme";

type Tone = "info" | "error" | "success";

interface ToastValue {
  show: (message: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<Tone>("info");
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (m: string, t: Tone = "info") => {
      setMsg(m);
      setTone(t);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }).start(() => setMsg(null));
      }, 2800);
    },
    [opacity],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {msg ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrap,
            { top: insets.top + spacing.md, opacity },
          ]}
        >
          <View
            style={[
              styles.toast,
              tone === "error" && styles.error,
              tone === "success" && styles.success,
            ]}
            testID="app-toast"
          >
            <Text style={styles.text}>{msg}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
  },
  toast: {
    maxWidth: "92%",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: 0,
  },
  error: { backgroundColor: colors.error },
  success: { backgroundColor: colors.success },
  text: {
    color: colors.primaryFg,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    textAlign: "center",
  },
});

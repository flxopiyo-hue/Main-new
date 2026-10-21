import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet, View, Platform, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useFonts } from "expo-font";

import { ToastProvider } from "@/src/components/Toast";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { AuthProvider } from "@/src/lib/auth";
import { diag, installBootDiag } from "@/src/lib/boot-diag";
import { OutfitProvider } from "@/src/lib/outfit";
import { ProfileProvider } from "@/src/lib/profiles";
import { colors } from "@/src/lib/theme";
import { useIconFonts } from "@/src/hooks/use-icon-fonts";

installBootDiag();
diag("layout-module-eval");

SplashScreen.preventAutoHideAsync().catch(() => {
  // Not a fatal — some environments (older web) throw here.
});

// Custom fonts bundled directly with the app. We deliberately DO NOT use
// `@expo-google-fonts/*` packages — they've historically hung on Expo Go
// over slow networks and are incompatible with SDK 57 in some edge cases,
// leaving the app on a blank screen. Loading the .ttfs from
// `assets/fonts/` guarantees they're embedded in the JS bundle.
const FONT_MAP = {
  CormorantGaramond_500Medium: require("@/assets/fonts/CormorantGaramond_500Medium.ttf"),
  CormorantGaramond_500Medium_Italic: require("@/assets/fonts/CormorantGaramond_500Medium_Italic.ttf"),
  CormorantGaramond_700Bold: require("@/assets/fonts/CormorantGaramond_700Bold.ttf"),
  Manrope_400Regular: require("@/assets/fonts/Manrope_400Regular.ttf"),
  Manrope_500Medium: require("@/assets/fonts/Manrope_500Medium.ttf"),
  Manrope_600SemiBold: require("@/assets/fonts/Manrope_600SemiBold.ttf"),
  Manrope_700Bold: require("@/assets/fonts/Manrope_700Bold.ttf"),
} as const;

// Safety-net timeout — if fonts (or the CDN-hosted icon fonts) haven't
// resolved after this window, we render the app anyway with the system
// fallback typeface. Better than a permanently blank welcome screen.
const FONT_READY_TIMEOUT_MS = 4000;

export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();
  const [fontsLoaded, fontsError] = useFonts(FONT_MAP);
  const [timedOut, setTimedOut] = useState(false);
  // On large NATIVE screens (tablets / unfolded foldables) centre the
  // phone-first UI in a comfortable column instead of stretching it edge
  // to edge. Phones (<700dp) and the web build are left untouched.
  const { width } = useWindowDimensions();
  const isLargeNative = Platform.OS !== "web" && width >= 700;

  useEffect(() => {
    const handle = setTimeout(() => setTimedOut(true), FONT_READY_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, []);

  const ready =
    ((iconsLoaded || iconsError) && (fontsLoaded || fontsError)) || timedOut;

  useEffect(() => {
    diag("fonts-state", {
      iconsLoaded,
      iconsError: iconsError ? String(iconsError.message ?? iconsError) : null,
      fontsLoaded,
      fontsError: fontsError ? String(fontsError.message ?? fontsError) : null,
      timedOut,
    });
  }, [iconsLoaded, iconsError, fontsLoaded, fontsError, timedOut]);

  useEffect(() => {
    if (ready) {
      diag("ready-hide-splash");
      // Swallow errors — hideAsync can throw if splash was never presented.
      SplashScreen.hideAsync()
        .then(() => diag("splash-hidden"))
        .catch((e) => diag("splash-hide-failed", { message: String(e?.message ?? e) }));
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ErrorBoundary>
            <AuthProvider>
              <ProfileProvider>
                <OutfitProvider>
                  <ToastProvider>
                    <View style={styles.root}>
                      <StatusBar style="dark" />
                      <View style={isLargeNative ? styles.letterbox : styles.root}>
                        <View style={isLargeNative ? styles.frame : styles.root}>
                          <Stack
                            screenOptions={{
                              headerShown: false,
                              contentStyle: { backgroundColor: colors.background },
                            }}
                          />
                        </View>
                      </View>
                    </View>
                  </ToastProvider>
                </OutfitProvider>
              </ProfileProvider>
            </AuthProvider>
          </ErrorBoundary>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  // Large-screen letterbox: muted backdrop behind the centred app column.
  letterbox: { flex: 1, backgroundColor: colors.muted, alignItems: "center" },
  frame: {
    flex: 1,
    width: "100%",
    maxWidth: 560,
    backgroundColor: colors.background,
    alignSelf: "center",
    overflow: "hidden",
  },
});

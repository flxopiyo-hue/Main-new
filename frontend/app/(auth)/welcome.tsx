import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { fonts, spacing } from "@/src/lib/theme";

// Palette matched to the OROMONA logo:
//   • Deep maroon    #1F0A08  (the logo's own background)
//   • Warm ochre     #C88A3D  (the golden hero mid-tone)
//   • Rich amber     #7A3B18  (transitional band)
// The composition below stacks 3 gradients so the eye reads
//   maroon → ochre → maroon, matching the visual weight of a
//   framed editorial photograph without needing an actual photograph.
const MAROON_DEEP = "#1F0A08";
const MAROON_MID = "#3B160F";
const AMBER = "#7A3B18";
const OCHRE = "#C88A3D";
const OCHRE_WARM = "#B87326";

const IVORY = "#FFF7EE";

export default function Welcome() {
  return (
    <View style={styles.root} testID="welcome-screen">
      {/* Layer 1 — base warm ochre glow, biased centre. */}
      <LinearGradient
        colors={[MAROON_MID, AMBER, OCHRE, OCHRE_WARM, MAROON_MID]}
        locations={[0, 0.22, 0.5, 0.75, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* Layer 2 — very subtle plaster/paper grain to add materiality
          without adding an actual photograph. Low-opacity overlay so the
          underlying gradient still carries the colour. */}
      <Image
        source={require("@/assets/brand/plaster-texture.png")}
        style={styles.grain}
        resizeMode="cover"
        pointerEvents="none"
      />
      {/* Layer 3 — dark maroon vignette top so the logo pops. */}
      <LinearGradient
        colors={[MAROON_DEEP, "rgba(31,10,8,0.75)", "rgba(31,10,8,0)"]}
        locations={[0, 0.35, 1]}
        style={styles.topFade}
        pointerEvents="none"
      />
      {/* Layer 3 — dark bottom fade so CTAs stay crisp. */}
      <LinearGradient
        colors={["rgba(0,0,0,0)", "rgba(15,6,4,0.85)"]}
        locations={[0, 1]}
        style={styles.bottomFade}
        pointerEvents="none"
      />

      <SafeAreaView style={styles.content} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <Image
            source={require("@/assets/brand/oromona-logo-transparent.png")}
            style={styles.logoMark}
            resizeMode="contain"
          />
        </View>

        <View style={styles.middle}>
          <Text style={styles.title}>
            Fits on{"\n"}
            <Text style={styles.titleItalic}>1st Try.</Text>
          </Text>
          <Text style={styles.sub}>
            Try on. See the fit. Buy with confidence.
          </Text>
        </View>

        <View style={styles.bottom}>
          <AppButton
            testID="welcome-create-account-btn"
            label="Create Account"
            onPress={() => router.push("/(auth)/register")}
          />
          <View style={{ height: spacing.md }} />
          <AppButton
            testID="welcome-sign-in-btn"
            label="I already have an account"
            variant="secondary"
            labelColor={IVORY}
            onPress={() => router.push("/(auth)/login")}
            style={styles.secondaryBtn}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MAROON_DEEP },
  grain: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.22,
    // `mixBlendMode` is a WEB-ONLY CSS property; on React Native's New
    // Architecture (Fabric) shipping SDK 57 an unknown style prop can
    // trigger a silent render failure on Android — this is what caused
    // the "blank amber page" bug tester devices were seeing. `typeof
    // window` is truthy on native too (RN polyfills it) so we MUST gate
    // on `Platform.OS === "web"` explicitly.
    ...(Platform.OS === "web" ? { mixBlendMode: "overlay" as any } : {}),
  },
  topFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "42%",
  },
  bottomFade: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "40%",
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: "space-between",
  },
  top: {
    alignItems: "center",
    paddingTop: spacing.md,
  },
  logoMark: {
    width: 260,
    height: 260,
    marginBottom: -22,
  },
  middle: { paddingTop: 0 },
  title: {
    fontFamily: fonts.heading,
    color: IVORY,
    fontSize: 62,
    lineHeight: 64,
    letterSpacing: -2,
  },
  titleItalic: { fontFamily: fonts.headingItalic },
  sub: {
    fontFamily: fonts.body,
    color: "rgba(255,247,238,0.94)",
    fontSize: 16,
    lineHeight: 22,
    marginTop: spacing.md,
    maxWidth: 340,
  },
  bottom: { paddingBottom: spacing.md },
  secondaryBtn: {
    backgroundColor: "transparent",
    borderColor: IVORY,
  },
});

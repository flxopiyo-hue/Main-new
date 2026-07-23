import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Image, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { fonts, spacing } from "@/src/lib/theme";

// Editorial portrait shot on an ochre studio backdrop — Vogue-Africa /
// Lagos-fashion-week aesthetic. Sets the tone: international app, designed
// with an East-African sensibility (warm earth tones, confident styling).
const HERO =
  "https://images.unsplash.com/photo-1527203561188-dae1bc1a417f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzZ8MHwxfHNlYXJjaHwxfHxhZnJpY2FuJTIwZmFzaGlvbiUyMGVkaXRvcmlhbHxlbnwwfHx8b3JhbmdlfDE3ODA5OTcxMTF8MA&ixlib=rb-4.1.0&q=85";

// Elegant off-white — used for headline text and the secondary button label
// so it stays legible against the ochre backdrop.
const IVORY = "#FFF7EE";

// Deep maroon that matches the OROMONA logo's own background. Blending it
// at the top of the hero gives the golden monogram/wordmark a natural
// contrast so it reads cleanly even at small sizes.
const MAROON_TOP = "#1F0A08";

export default function Welcome() {
  return (
    <View style={styles.root} testID="welcome-screen">
      <Image source={{ uri: HERO }} style={styles.hero} resizeMode="cover" />

      {/* Top-of-frame dark maroon fade — lets the golden logo pop.
          Solid dark at the very top → fully transparent by ~40% of the
          screen height. */}
      <LinearGradient
        colors={[MAROON_TOP, "rgba(31,10,8,0.85)", "rgba(31,10,8,0)"]}
        locations={[0, 0.45, 1]}
        style={styles.topFade}
        pointerEvents="none"
      />

      {/* Bottom-of-frame dark fade — keeps CTAs crisp over the model's
          shoulder without darkening her face. */}
      <LinearGradient
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"]}
        locations={[0, 1]}
        style={styles.bottomFade}
        pointerEvents="none"
      />

      <SafeAreaView style={styles.content} edges={["top", "bottom"]}>
        {/* Big centred logo positioned above the model's head. */}
        <View style={styles.top}>
          <Image
            source={require("@/assets/brand/oromona-logo-transparent.png")}
            style={styles.logoMark}
            resizeMode="contain"
          />
        </View>

        {/* Headline + short tagline. */}
        <View style={styles.middle}>
          <Text style={styles.title}>
            Fits on{"\n"}
            <Text style={styles.titleItalic}>1st Try.</Text>
          </Text>
          <Text style={styles.sub}>
            Try on. See the fit. Buy with confidence.
          </Text>
        </View>

        {/* CTAs. */}
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
  root: { flex: 1, backgroundColor: "#0E0B08" },
  hero: { ...StyleSheet.absoluteFillObject },
  // Dark maroon fade covering the top ~40% of the screen so the golden
  // logo sits on a brand-consistent canvas.
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
    height: "45%",
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: "space-between",
  },
  // Top area — centres the logo horizontally above the model's head.
  top: {
    alignItems: "center",
    paddingTop: spacing.md,
  },
  logoMark: {
    width: 240,
    height: 240,
    // Slight negative marginBottom so the wordmark inside the PNG sits
    // right against the "Fits on 1st Try" headline without extra gap.
    marginBottom: -18,
  },
  middle: { paddingTop: 0 },
  title: {
    fontFamily: fonts.heading,
    color: IVORY,
    fontSize: 60,
    lineHeight: 62,
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

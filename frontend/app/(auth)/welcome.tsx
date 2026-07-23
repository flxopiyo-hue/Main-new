import { router } from "expo-router";
import { Image, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { fonts, spacing, type as tp } from "@/src/lib/theme";

// Editorial portrait shot on an ochre studio backdrop — Vogue-Africa /
// Lagos-fashion-week aesthetic. Sets the tone: international app, designed
// with an East-African sensibility (warm earth tones, confident styling).
const HERO =
  "https://images.unsplash.com/photo-1527203561188-dae1bc1a417f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzZ8MHwxfHNlYXJjaHwxfHxhZnJpY2FuJTIwZmFzaGlvbiUyMGVkaXRvcmlhbHxlbnwwfHx8b3JhbmdlfDE3ODA5OTcxMTF8MA&ixlib=rb-4.1.0&q=85";

export default function Welcome() {
  return (
    <View style={styles.root} testID="welcome-screen">
      <Image source={{ uri: HERO }} style={styles.hero} resizeMode="cover" />
      <View style={styles.scrim} />
      <SafeAreaView style={styles.content} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <Image
            source={require("@/assets/brand/oromona-logo-transparent.png")}
            style={styles.logoMark}
            resizeMode="contain"
          />
          <Text style={styles.brandSub}>Nairobi · Made for everywhere</Text>
        </View>
        <View style={styles.middle}>
          <Text style={styles.title}>
            It{"\n"}
            <Text style={styles.titleItalic}>fits me.</Text>
          </Text>
          <Text style={styles.sub}>
            Capture your measurements. Try clothes on with AI — front, side and back —
            from designers across Kenya and beyond. Only buy what truly fits you.
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
            onPress={() => router.push("/(auth)/login")}
            style={styles.secondaryBtn}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

// Suppress eslint unused-import on tp — keep imported in case we add muted text later.
void tp;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0E0B08" },
  hero: { ...StyleSheet.absoluteFillObject },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    // Bottom-weighted gradient-ish overlay (darker at bottom for legibility).
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: "space-between",
  },
  top: { paddingTop: spacing.md, alignItems: "flex-start" },
  logoMark: {
    width: 148,
    height: 148,
    marginLeft: -14,
    marginBottom: -20,
  },
  brand: {
    fontFamily: fonts.heading,
    color: "#FFF7EE",
    letterSpacing: 6,
    fontSize: 22,
  },
  brandSub: {
    fontFamily: fonts.body,
    color: "rgba(255,247,238,0.78)",
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginTop: 6,
  },
  middle: { paddingTop: spacing.xxl },
  title: {
    fontFamily: fonts.heading,
    color: "#FFF7EE",
    fontSize: 60,
    lineHeight: 62,
    letterSpacing: -2,
  },
  titleItalic: { fontFamily: fonts.headingItalic },
  sub: {
    fontFamily: fonts.body,
    color: "rgba(255,247,238,0.92)",
    fontSize: 15.5,
    lineHeight: 23,
    marginTop: spacing.lg,
    maxWidth: 380,
  },
  bottom: { paddingBottom: spacing.md },
  secondaryBtn: {
    backgroundColor: "transparent",
    borderColor: "#FFF7EE",
  },
});

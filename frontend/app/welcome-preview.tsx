// Hero preview page — renders the welcome-screen layout three times
// side-by-side (or stacked vertically) using each candidate hero image.
// Purely a design-review tool; not linked from anywhere in the app.

import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import {
  Image,
  ImageSourcePropType,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { fonts, spacing } from "@/src/lib/theme";

const IVORY = "#FFF7EE";
const MAROON_TOP = "#1F0A08";

const HERO_A = require("@/assets/brand/hero-option-A-0.png") as ImageSourcePropType;
const HERO_B = require("@/assets/brand/hero-option-B-0.png") as ImageSourcePropType;
const HERO_C = require("@/assets/brand/hero-option-C-0.png") as ImageSourcePropType;
const LOGO = require("@/assets/brand/oromona-logo-transparent.png") as ImageSourcePropType;

interface Variant {
  key: "A" | "B" | "C";
  label: string;
  hero: ImageSourcePropType;
}

const VARIANTS: Variant[] = [
  { key: "A", label: "Option A · Bold editorial (Vogue-Africa)", hero: HERO_A },
  { key: "B", label: "Option B · Modern minimal (global luxury)", hero: HERO_B },
  {
    key: "C",
    label: "Option C · Split-screen before/after try-on demo",
    hero: HERO_C,
  },
];

function WelcomeMock({ hero }: { hero: ImageSourcePropType }) {
  return (
    <View style={styles.mock}>
      <Image source={hero} style={styles.hero} resizeMode="cover" />
      <LinearGradient
        colors={[MAROON_TOP, "rgba(31,10,8,0.85)", "rgba(31,10,8,0)"]}
        locations={[0, 0.45, 1]}
        style={styles.topFade}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"]}
        locations={[0, 1]}
        style={styles.bottomFade}
        pointerEvents="none"
      />
      <SafeAreaView style={styles.content} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <Image source={LOGO} style={styles.logoMark} resizeMode="contain" />
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
            label="Create Account"
            onPress={() => {}}
            testID="preview-create"
          />
          <View style={{ height: spacing.md }} />
          <AppButton
            label="I already have an account"
            variant="secondary"
            labelColor={IVORY}
            onPress={() => {}}
            style={styles.secondaryBtn}
            testID="preview-signin"
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

export default function WelcomePreview() {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#111" }}
      contentContainerStyle={{ paddingBottom: 24 }}
    >
      {VARIANTS.map((v) => (
        <View key={v.key} style={styles.section}>
          <Text style={styles.sectionLabel}>{v.label}</Text>
          <View style={styles.frame}>
            <WelcomeMock hero={v.hero} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// Base mock size = the same 390×844 device viewport. When rendered on
// desktop web the ScrollView will just stack them; on phones they render
// full-bleed one after the other.
const MOCK_W = 340;
const MOCK_H = MOCK_W * (844 / 390);

const styles = StyleSheet.create({
  section: {
    paddingVertical: 20,
    alignItems: "center",
    gap: 10,
  },
  sectionLabel: {
    color: "#F2E8D5",
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  frame: {
    width: MOCK_W,
    height: MOCK_H,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#2A2016",
    backgroundColor: "#0E0B08",
  },
  // Everything below is a scaled-down copy of the welcome-screen styles.
  mock: { flex: 1, backgroundColor: "#0E0B08" },
  hero: { ...StyleSheet.absoluteFillObject },
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
    paddingHorizontal: 18,
    justifyContent: "space-between",
  },
  top: { alignItems: "center", paddingTop: 12 },
  logoMark: {
    width: 200,
    height: 200,
    marginBottom: -14,
  },
  middle: { paddingTop: 0 },
  title: {
    fontFamily: fonts.heading,
    color: IVORY,
    fontSize: 52,
    lineHeight: 54,
    letterSpacing: -2,
  },
  titleItalic: { fontFamily: fonts.headingItalic },
  sub: {
    fontFamily: fonts.body,
    color: "rgba(255,247,238,0.94)",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
    maxWidth: 300,
  },
  bottom: { paddingBottom: 8 },
  secondaryBtn: {
    backgroundColor: "transparent",
    borderColor: IVORY,
  },
});

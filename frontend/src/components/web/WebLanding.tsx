import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { fonts } from "@/src/lib/theme";
import { useBreakpoint, WEB_MAX_WIDTH, webColors } from "@/src/lib/web";
import { WebFooter } from "@/src/components/web/WebFooter";
import { WebNav } from "@/src/components/web/WebNav";

// Marketing landing shown at the web root (oromona.com) for visitors who
// aren't signed in. Warm editorial style matched to the existing static
// oromona.com page. Web-only — the native app redirects to /welcome.
export function WebLanding() {
  const { isDesktop, isPhone } = useBreakpoint();

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <WebNav active="home" />

        {/* Hero */}
        <View style={styles.section}>
          <View style={[styles.hero, !isDesktop && styles.heroStack]}>
            <View style={styles.heroCopy}>
              <Text style={styles.kicker}>Made in Nairobi · Sized to you</Text>
              <Text style={[styles.h1, isPhone && styles.h1Phone]}>The boutique that fits you.</Text>
              <Text style={styles.lede}>
                Kenya-crafted fashion, sized to your body. Try it on with AI, get styled by AI,
                and have it delivered — with escrow protection until you say it fits.
              </Text>
              <View style={[styles.ctaRow, isPhone && styles.ctaRowStack]}>
                <TouchableOpacity
                  testID="landing-shop-btn"
                  style={styles.primaryBtn}
                  onPress={() => router.push("/store")}
                  activeOpacity={0.9}
                >
                  <Text style={styles.primaryBtnLabel}>Shop the collection</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="landing-create-account-btn"
                  style={styles.ghostBtn}
                  onPress={() => router.push("/(auth)/register")}
                  activeOpacity={0.9}
                >
                  <Text style={styles.ghostBtnLabel}>Create account</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.finePrint}>
                Free to browse · AI try-on · Escrow-protected checkout
              </Text>
            </View>

            {/* Phone visual */}
            <View style={styles.heroVisual}>
              <View style={styles.phone}>
                <LinearGradient
                  colors={["#14110E", "#4A2E1E", "#C86B4A"]}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={styles.phoneScreen}
                >
                  <Text style={styles.pLogo}>OROMONA</Text>
                  <Text style={styles.pLine}>
                    Fits on{"\n"}
                    <Text style={styles.pLineEm}>1st Try.</Text>
                  </Text>
                  <Text style={styles.pSub}>Try on. See the fit. Buy with confidence.</Text>
                </LinearGradient>
              </View>
            </View>
          </View>
        </View>

        {/* Features */}
        <View style={styles.section}>
          <View style={[styles.features, isPhone && styles.featuresPhone]}>
            <Feature icon="✨" title="AI Try-On" body="Photorealistic try-on on your body — front, side and back." />
            <Feature icon="📏" title="Real Fit" body="Match every listing to your measurements with a live fit score." />
            <Feature icon="🧵" title="Kenyan Ateliers" body="Local designers and small labels, verified and paid securely." />
            <Feature icon="🛵" title="Escrow Delivery" body="Boda-tracked to your door. Money moves only when it fits." />
          </View>
        </View>

        {/* How it works */}
        <View style={styles.section}>
          <Text style={styles.h2}>How it works</Text>
          <View style={[styles.steps, !isDesktop && styles.stepsStack]}>
            <Step num="01" title="Set your size" body="Add a few measurements once — or let AI estimate from a photo." />
            <Step num="02" title="Try it on" body="Tap any piece to see it rendered on you, in your exact size." />
            <Step num="03" title="Delivered to your door" body="Pay securely. A rider brings it. Confirm the fit, and the seller gets paid." />
          </View>
        </View>

        {/* CTA band */}
        <View style={styles.section}>
          <View style={[styles.ctaBand, isPhone && styles.ctaBandStack]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.ctaBandTitle}>Ready to see it on you first?</Text>
              <Text style={styles.ctaBandSub}>Free to browse. Free to try on. Escrow-protected checkout.</Text>
            </View>
            <TouchableOpacity
              testID="landing-cta-shop-btn"
              style={styles.ctaBandBtn}
              onPress={() => router.push("/store")}
              activeOpacity={0.9}
            >
              <Text style={styles.ctaBandBtnLabel}>Browse the collection</Text>
            </TouchableOpacity>
          </View>
        </View>

        <WebFooter />
      </ScrollView>
    </View>
  );
}

function Feature({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}>
        <Text style={styles.featureIconText}>{icon}</Text>
      </View>
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureBody}>{body}</Text>
    </View>
  );
}

function Step({ num, title, body }: { num: string; title: string; body: string }) {
  return (
    <View style={styles.step}>
      <Text style={styles.stepNum}>{num}</Text>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepBody}>{body}</Text>
    </View>
  );
}

const CONTENT = {
  width: "100%" as const,
  maxWidth: WEB_MAX_WIDTH,
  alignSelf: "center" as const,
  paddingHorizontal: 20,
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: webColors.bg },
  scroll: { flex: 1, backgroundColor: webColors.bg },
  content: { paddingBottom: 0 },
  section: { ...CONTENT, paddingTop: 40 },

  // Hero
  hero: { flexDirection: "row", alignItems: "center", gap: 48 },
  heroStack: { flexDirection: "column", gap: 32 },
  heroCopy: { flex: 1.15 },
  heroVisual: { flex: 1, alignItems: "center" },
  kicker: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 4,
    textTransform: "uppercase",
    color: webColors.accent,
    marginBottom: 12,
  },
  h1: {
    fontFamily: fonts.heading,
    fontSize: 64,
    lineHeight: 66,
    letterSpacing: -1,
    color: webColors.ink,
    marginBottom: 18,
  },
  h1Phone: { fontSize: 44, lineHeight: 46 },
  lede: {
    fontFamily: fonts.body,
    fontSize: 18,
    lineHeight: 27,
    color: webColors.muted,
    maxWidth: 520,
    marginBottom: 28,
  },
  ctaRow: { flexDirection: "row", gap: 14, alignItems: "center", flexWrap: "wrap" },
  ctaRowStack: { flexDirection: "column", alignItems: "stretch" },
  primaryBtn: { backgroundColor: webColors.ink, paddingHorizontal: 26, paddingVertical: 16 },
  primaryBtnLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: webColors.inkFg,
    textAlign: "center",
  },
  ghostBtn: {
    borderWidth: 1,
    borderColor: webColors.ink,
    paddingHorizontal: 26,
    paddingVertical: 16,
    backgroundColor: "transparent",
  },
  ghostBtnLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: webColors.ink,
    textAlign: "center",
  },
  finePrint: { fontFamily: fonts.body, fontSize: 12, color: webColors.muted, marginTop: 14 },

  // Phone visual
  phone: {
    width: 300,
    height: 620,
    backgroundColor: webColors.dark,
    borderRadius: 40,
    padding: 12,
  },
  phoneScreen: {
    flex: 1,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  pLogo: {
    fontFamily: fonts.bodyBold,
    fontSize: 18,
    letterSpacing: 8,
    color: "#F5D9BF",
    marginBottom: 10,
  },
  pLine: {
    fontFamily: fonts.heading,
    fontSize: 44,
    lineHeight: 46,
    color: "#FFFFFF",
    textAlign: "center",
    marginVertical: 12,
  },
  pLineEm: { fontFamily: fonts.headingItalic, color: "#F5D9BF" },
  pSub: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: "rgba(255,255,255,0.88)",
    textAlign: "center",
  },

  // Features
  h2: { fontFamily: fonts.heading, fontSize: 36, color: webColors.ink, marginBottom: 24 },
  features: { flexDirection: "row", gap: 20, flexWrap: "wrap" },
  featuresPhone: { flexDirection: "column" },
  feature: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 200,
    backgroundColor: webColors.card,
    borderWidth: 1,
    borderColor: webColors.border,
    padding: 24,
  },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(200,107,74,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  featureIconText: { fontSize: 20 },
  featureTitle: { fontFamily: fonts.heading, fontSize: 22, color: webColors.ink, marginBottom: 6 },
  featureBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: webColors.muted },

  // Steps
  steps: { flexDirection: "row", gap: 20 },
  stepsStack: { flexDirection: "column" },
  step: { flex: 1, backgroundColor: webColors.card, borderWidth: 1, borderColor: webColors.border, padding: 24 },
  stepNum: { fontFamily: fonts.heading, fontSize: 34, color: webColors.accent, marginBottom: 8 },
  stepTitle: { fontFamily: fonts.bodySemi, fontSize: 17, color: webColors.ink, marginBottom: 6 },
  stepBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: webColors.muted },

  // CTA band
  ctaBand: {
    backgroundColor: webColors.ink,
    padding: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
  },
  ctaBandStack: { flexDirection: "column", alignItems: "flex-start" },
  ctaBandTitle: { fontFamily: fonts.heading, fontSize: 30, color: webColors.inkFg, marginBottom: 8 },
  ctaBandSub: { fontFamily: fonts.body, fontSize: 15, color: "rgba(255,255,255,0.75)" },
  ctaBandBtn: { backgroundColor: webColors.bg, paddingHorizontal: 24, paddingVertical: 16 },
  ctaBandBtnLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: webColors.ink,
  },
});

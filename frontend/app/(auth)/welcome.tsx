import { router } from "expo-router";
import { Image, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { fonts, spacing, type as tp } from "@/src/lib/theme";

const HERO =
  "https://images.unsplash.com/photo-1668952135120-7d997b1b3778?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODl8MHwxfHNlYXJjaHwxfHxmYXNoaW9uJTIwZWRpdG9yaWFsJTIwbW9kZWwlMjBzdHVkaW98ZW58MHx8fHwxNzgwOTIzMjg3fDA&ixlib=rb-4.1.0&q=85";

export default function Welcome() {
  return (
    <View style={styles.root} testID="welcome-screen">
      <Image source={{ uri: HERO }} style={styles.hero} resizeMode="cover" />
      <View style={styles.overlay} />
      <SafeAreaView style={styles.content} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <Text style={[tp.caption, styles.brand]}>AURAFIT</Text>
        </View>
        <View style={styles.middle}>
          <Text style={styles.title}>
            Wear it{"\n"}before{"\n"}<Text style={styles.titleItalic}>you wear it.</Text>
          </Text>
          <Text style={styles.sub}>
            Capture your shape. Try clothes on instantly with AI. Discover what truly fits — across hundreds of independent designers.
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  hero: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: "space-between",
  },
  top: { paddingTop: spacing.md },
  brand: {
    color: "#FFFFFF",
    letterSpacing: 4,
    fontSize: 12,
  },
  middle: { paddingTop: spacing.xxl },
  title: {
    fontFamily: fonts.heading,
    color: "#FFFFFF",
    fontSize: 64,
    lineHeight: 66,
    letterSpacing: -2,
  },
  titleItalic: {
    fontFamily: fonts.headingItalic,
  },
  sub: {
    fontFamily: fonts.body,
    color: "#F5F5F5",
    fontSize: 16,
    lineHeight: 24,
    marginTop: spacing.lg,
    maxWidth: 380,
  },
  bottom: { paddingBottom: spacing.md },
  secondaryBtn: {
    backgroundColor: "transparent",
    borderColor: "#FFFFFF",
  },
});

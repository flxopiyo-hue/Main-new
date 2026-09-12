import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";

import { BACKEND_URL } from "@/src/lib/api";
import { fonts } from "@/src/lib/theme";
import { useBreakpoint, WEB_MAX_WIDTH, webColors } from "@/src/lib/web";
import { LogoMark } from "@/src/components/web/LogoMark";

// Site footer for the Oromona website. Product links jump within the app;
// legal links open the backend-hosted policy pages; support opens mail.
export function WebFooter() {
  const { isPhone } = useBreakpoint();

  const open = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={styles.footer}>
      <View style={styles.inner}>
        <View style={[styles.grid, isPhone && styles.gridStack]}>
          <View style={styles.brandCol}>
            <LogoMark size={30} />
            <Text style={styles.tagline}>
              The boutique that fits you. Kenya-crafted fashion, sized to your body.
            </Text>
          </View>

          <View style={styles.linkCol}>
            <Text style={styles.colTitle}>Product</Text>
            <FooterLink label="Shop the collection" onPress={() => router.push("/store")} />
            <FooterLink label="Sign in" onPress={() => router.push("/(auth)/login")} />
            <FooterLink label="Create account" onPress={() => router.push("/(auth)/register")} />
          </View>

          <View style={styles.linkCol}>
            <Text style={styles.colTitle}>Support & Legal</Text>
            <FooterLink
              label="support@oromona.com"
              onPress={() => open("mailto:support@oromona.com")}
            />
            <FooterLink
              label="Privacy Policy"
              onPress={() => open(`${BACKEND_URL}/api/legal/privacy`)}
            />
            <FooterLink
              label="Delete Account & Data"
              onPress={() => open(`${BACKEND_URL}/api/legal/delete-account`)}
            />
          </View>
        </View>

        <View style={[styles.copyRow, isPhone && styles.copyStack]}>
          <Text style={styles.copy}>© 2026 Oromona. Made in Nairobi.</Text>
          <Text style={styles.copy}>Version 1.0</Text>
        </View>
      </View>
    </View>
  );
}

function FooterLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.linkBtn}>
      <Text style={styles.link}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  footer: {
    width: "100%",
    borderTopWidth: 1,
    borderTopColor: webColors.border,
    backgroundColor: webColors.bg,
    marginTop: 40,
  },
  inner: {
    width: "100%",
    maxWidth: WEB_MAX_WIDTH,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 48,
  },
  grid: { flexDirection: "row", gap: 32 },
  gridStack: { flexDirection: "column", gap: 28 },
  brandCol: { flex: 2, gap: 12 },
  linkCol: { flex: 1, gap: 4 },
  tagline: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: webColors.muted,
    maxWidth: 360,
  },
  colTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: webColors.ink,
    marginBottom: 8,
  },
  linkBtn: { paddingVertical: 4 },
  link: { fontFamily: fonts.body, fontSize: 14, color: webColors.muted },
  copyRow: {
    marginTop: 28,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: webColors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  copyStack: { flexDirection: "column", gap: 8, alignItems: "flex-start" },
  copy: { fontFamily: fonts.body, fontSize: 13, color: webColors.muted },
});

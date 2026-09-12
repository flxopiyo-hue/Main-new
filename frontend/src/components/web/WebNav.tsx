import { router } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { fonts } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { homeRouteForUser, useBreakpoint, WEB_MAX_WIDTH, webColors } from "@/src/lib/web";
import { LogoMark } from "@/src/components/web/LogoMark";

// Top navigation bar for the Oromona website. Web-only surface — never
// rendered inside the native app.
export function WebNav({ active }: { active?: "shop" | "home" }) {
  const { user } = useAuth();
  const { isPhone } = useBreakpoint();

  return (
    <View style={styles.bar}>
      <View style={styles.inner}>
        <TouchableOpacity
          testID="web-nav-logo"
          onPress={() => router.push("/")}
          activeOpacity={0.8}
        >
          <LogoMark size={isPhone ? 30 : 34} />
        </TouchableOpacity>

        <View style={styles.right}>
          <TouchableOpacity
            testID="web-nav-shop"
            onPress={() => router.push("/store")}
            activeOpacity={0.7}
          >
            <Text style={[styles.link, active === "shop" && styles.linkActive]}>Shop</Text>
          </TouchableOpacity>

          {user ? (
            <TouchableOpacity
              testID="web-nav-account"
              onPress={() => router.push(homeRouteForUser(user) as any)}
              style={styles.cta}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaLabel}>My account</Text>
            </TouchableOpacity>
          ) : (
            <>
              {!isPhone ? (
                <TouchableOpacity
                  testID="web-nav-signin"
                  onPress={() => router.push("/(auth)/login")}
                  activeOpacity={0.7}
                >
                  <Text style={styles.link}>Sign in</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                testID="web-nav-getstarted"
                onPress={() => router.push("/(auth)/register")}
                style={styles.cta}
                activeOpacity={0.85}
              >
                <Text style={styles.ctaLabel}>Get started</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    width: "100%",
    backgroundColor: webColors.bg,
    borderBottomWidth: 1,
    borderBottomColor: webColors.border,
  },
  inner: {
    width: "100%",
    maxWidth: WEB_MAX_WIDTH,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  right: { flexDirection: "row", alignItems: "center", gap: 18 },
  link: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: webColors.muted,
  },
  linkActive: { color: webColors.ink },
  cta: {
    backgroundColor: webColors.ink,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  ctaLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: webColors.inkFg,
  },
});

// Entry point. Routes user to (tabs) when authenticated, otherwise to /welcome.

import { Redirect } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";

import { useAuth } from "@/src/lib/auth";
import { diag } from "@/src/lib/boot-diag";
import { colors } from "@/src/lib/theme";
import { WebLanding } from "@/src/components/web/WebLanding";

export default function Index() {
  const { user, loading } = useAuth();
  useEffect(() => {
    diag("index-route", { loading, hasUser: !!user, role: user?.role ?? null });
  }, [loading, user]);
  if (loading) {
    return (
      <View style={styles.center} testID="boot-loader">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!user) {
    // On the web this is the front door to oromona.com — show the
    // marketing landing (guests can then browse the public store).
    // Native apps keep the login-first flow.
    if (Platform.OS === "web") return <WebLanding />;
    return <Redirect href="/welcome" />;
  }
  if (user.role === "admin") return <Redirect href="/admin" />;
  if (user.role === "seller") return <Redirect href="/(seller)" />;
  if (user.role === "courier") return <Redirect href="/(courier)" />;
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
});

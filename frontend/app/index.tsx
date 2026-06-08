// Entry point. Routes user to (tabs) when authenticated, otherwise to /welcome.

import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuth } from "@/src/lib/auth";
import { colors } from "@/src/lib/theme";

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={styles.center} testID="boot-loader">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!user) return <Redirect href="/welcome" />;
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
});

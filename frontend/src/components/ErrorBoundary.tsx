// Root React Error Boundary — catches renders that would otherwise
// leave the app on a white screen. Required for App Store / Play
// review (Apple Guideline 2.1 — crashes must not brick a user's core
// flow) and generally a better experience than a silent failure.
//
// We deliberately keep this at the ROOT of `_layout.tsx`, wrapping the
// whole `<Stack>`. Each screen can still throw its own errors and this
// component will render the fallback in place of the screen tree.

import React from "react";
import { Feather } from "@expo/vector-icons";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, fonts, spacing } from "@/src/lib/theme";
import { diag } from "@/src/lib/boot-diag";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info?.componentStack);
    diag("error-boundary", {
      message: String(error?.message ?? error).slice(0, 800),
      componentStack: String(info?.componentStack ?? "").slice(0, 1200),
    });
  }

  reset = () => {
    this.setState({ error: null });
  };

  reload = () => {
    // Without expo-updates we can't hot-reload the JS bundle, but
    // clearing our error state unmounts and re-mounts the whole tree
    // — good enough for the vast majority of transient render errors.
    // On web we could `window.location.reload()`, which we do to be
    // safe on production web deploys.
    if (Platform.OS === "web" && typeof window !== "undefined") {
      try {
        window.location.reload();
        return;
      } catch {
        // fall through
      }
    }
    this.reset();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.iconWrap}>
            <Feather name="alert-triangle" size={28} color={colors.primary} />
          </View>
          <Text style={styles.eyebrow}>OROMONA</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            The atelier hit a snag. Try reloading — your account, saved
            try-ons and wishlist are safe.
          </Text>
          {/* Only show the raw message in dev to help debugging; in prod
              this is noise for the buyer. */}
          {__DEV__ ? (
            <Text style={styles.debug} testID="error-boundary-debug">
              {error.name}: {error.message}
            </Text>
          ) : null}
          <TouchableOpacity
            testID="error-boundary-reload"
            onPress={this.reload}
            style={styles.button}
            activeOpacity={0.85}
          >
            <Feather name="refresh-cw" size={14} color={colors.primaryFg} />
            <Text style={styles.buttonLabel}>Reload Oromona</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  eyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.mutedFg,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 26,
    textAlign: "center",
    color: colors.primary,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    color: colors.mutedFg,
    maxWidth: 320,
  },
  debug: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    textAlign: "center",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  button: {
    marginTop: spacing.lg,
    minHeight: 48,
    minWidth: 220,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
  },
  buttonLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    letterSpacing: 1.4,
    color: colors.primaryFg,
    textTransform: "uppercase",
  },
});

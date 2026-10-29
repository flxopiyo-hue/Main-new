import { StyleSheet, Text, View } from "react-native";

import { fonts } from "@/src/lib/theme";
import { webColors } from "@/src/lib/web";

// The Oromona wordmark used across the website (nav, footer, landing).
// Mirrors the existing oromona.com landing: an ink square with a
// terracotta "O", followed by the spaced wordmark.
export function LogoMark({ size = 34, light = false }: { size?: number; light?: boolean }) {
  return (
    <View style={styles.row}>
      <View
        style={[
          styles.mark,
          { width: size, height: size, backgroundColor: light ? webColors.card : webColors.ink },
        ]}
      >
        <Text style={[styles.markLetter, { color: webColors.accent, fontSize: size * 0.55 }]}>O</Text>
      </View>
      <Text
        style={[
          styles.word,
          { color: light ? webColors.card : webColors.ink, fontSize: size * 0.52, letterSpacing: size * 0.11 },
        ]}
      >
        OROMONA
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: { alignItems: "center", justifyContent: "center", borderRadius: 4 },
  markLetter: { fontFamily: fonts.heading },
  word: { fontFamily: fonts.bodyBold },
});

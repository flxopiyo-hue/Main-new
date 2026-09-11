// Icon font loader — Expo apps need @expo/vector-icons' bundled .ttf
// files registered with `expo-font` so that in dev + web + Expo Go
// (where native autolinking doesn't apply) icons render correctly.
//
// Historically we fetched these from a jsDelivr CDN when running under
// Expo Go (`ExecutionEnvironment.StoreClient`). That worked on fast
// networks but hung on some corporate/mobile networks in Kenya, leaving
// the app on a blank screen for testers.
//
// New strategy: bundle the .ttf files directly from
// `@expo/vector-icons/.../Fonts/*.ttf` via `require`. Metro embeds them
// into the JS bundle at build time, so there's no network dependency at
// startup. The layout also has a 4-second safety timeout in case any of
// these `require`s ever fails on a device.

import { useFonts } from "expo-font";

// Register ONLY the families we actually use in the app to keep the
// bundle small. Feather is our primary icon family. If a new family is
// introduced, add it here and to the `Feather` etc. imports.
const iconFontMap = {
  // Feather is what components/screens use throughout Oromona.
  Feather: require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf"),
  // A few other families ship with @expo/vector-icons — cheap insurance
  // if a screen switches its icon family later.
  Ionicons: require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf"),
  MaterialIcons: require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf"),
  MaterialCommunityIcons: require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf"),
  AntDesign: require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/AntDesign.ttf"),
} as const;

export const useIconFonts = (): readonly [boolean, Error | null] =>
  useFonts(iconFontMap);

// Top-level legacy redirect — /inventory now lives at /(seller).
import { Redirect } from "expo-router";
export default function _LegacyInventory() {
  return <Redirect href="/(seller)" />;
}

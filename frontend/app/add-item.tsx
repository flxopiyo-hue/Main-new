// Top-level legacy redirect — /add-item now lives at /(seller)/add-item.
import { Redirect } from "expo-router";
export default function _LegacyAddItem() {
  return <Redirect href="/(seller)/add-item" />;
}

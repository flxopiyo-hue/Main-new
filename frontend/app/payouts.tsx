// Top-level legacy redirect — /payouts now lives at /(seller)/payouts.
import { Redirect } from "expo-router";
export default function _LegacyPayouts() {
  return <Redirect href="/(seller)/payouts" />;
}

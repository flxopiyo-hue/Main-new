// Legacy redirect — sellers are now in /(seller). Anyone deep-linking to
// /inventory while still authed will land here for one frame and bounce.
import { Redirect } from "expo-router";
export default function _LegacyInventory() {
  return <Redirect href="/(seller)" />;
}

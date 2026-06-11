// Legacy redirect — point to the new wizard inside the seller route group.
import { Redirect } from "expo-router";
export default function LegacyNewItem() {
  return <Redirect href="/(seller)/add-item" />;
}

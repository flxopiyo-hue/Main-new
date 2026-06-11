// Legacy redirect: the old single-page `/seller/new-item` is now a 3-step
// wizard at `/(tabs)/add-item`. Any deep-link or stale push to the old path
// just bounces to the new wizard so the seller never sees a 404.

import { Redirect } from "expo-router";

export default function LegacyNewItem() {
  return <Redirect href="/add-item" />;
}

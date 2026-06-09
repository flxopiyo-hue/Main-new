// Empty layout so the /outfit segment uses the parent stack defaults.
import { Stack } from "expo-router";

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

// Save a base64 JPEG to the cache and trigger the native share sheet.
//
// SDK 54 note: `expo-file-system` moved its legacy string-URI helpers
// (`cacheDirectory`, `writeAsStringAsync`, `EncodingType`) into the
// `expo-file-system/legacy` entrypoint and made the top-level `File`/
// `Paths` API the default. Calling the old helpers from the top-level
// module now throws at runtime — that was the root cause of the
// "Share · Square / Share · Story 9:16" error users were seeing.
//
// This module now uses the new File API on native and falls back to a
// standard browser download on web (where `expo-sharing` doesn't work).

import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

/**
 * Save a base64 image to disk (native) or download it (web) and open the
 * share sheet when available. Returns `true` when the image was
 * actually shared or downloaded; `false` when neither path is
 * possible (e.g. sharing unavailable on a stripped-down device).
 * Any unexpected failure is thrown so the caller can surface a
 * meaningful toast instead of a silent no-op.
 */
export async function shareBase64Image(
  b64: string,
  filename = "oromona-tryon",
): Promise<boolean> {
  // Guard: empty/undefined payload — surface a real error message so we
  // don't leave the user staring at a spinner that did nothing.
  if (!b64 || typeof b64 !== "string") {
    throw new Error("No image data to share");
  }

  // Some backends return the "data:image/jpeg;base64," prefix — the
  // encoders below expect the raw base64 body only.
  const stripped = b64.startsWith("data:")
    ? b64.slice(b64.indexOf(",") + 1)
    : b64;

  const safeName = `${filename}-${Date.now()}.jpg`;

  // Web: expo-sharing / expo-file-system don't ship a working
  // implementation. Trigger a browser download so the user still
  // gets the image they asked for.
  if (Platform.OS === "web") {
    try {
      const bin = atob(stripped);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = safeName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the browser a beat to start the download before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (e: any) {
      throw new Error(e?.message ?? "Could not prepare image for download");
    }
  }

  // Native: write with the new File API. `Paths.cache` is the modern
  // replacement for the deprecated `FileSystem.cacheDirectory` constant.
  const file = new File(Paths.cache, safeName);
  try {
    // `create` is a no-op when the file already exists but ensures the
    // parent directory is present (matches the old writeAsStringAsync
    // behaviour). `overwrite` lets repeated shares of the same look
    // succeed without a "file already exists" throw.
    file.create({ intermediates: true, overwrite: true });
    file.write(stripped, { encoding: "base64" });
  } catch (e: any) {
    throw new Error(e?.message ?? "Could not save image for sharing");
  }

  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    // Nothing else we can do — surface `false` so the caller can toast
    // "sharing unavailable on this device" without hiding a real error.
    return false;
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: "image/jpeg",
    dialogTitle: "Share your Oromona try-on",
    UTI: "public.jpeg",
  });
  return true;
}

// Save a base64 JPEG to the cache and trigger the native share sheet.

import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function shareBase64Image(b64: string, filename = "aurafit-tryon"): Promise<boolean> {
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) return false;
  const uri = `${FileSystem.cacheDirectory}${filename}-${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(uri, b64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await Sharing.shareAsync(uri, {
    mimeType: "image/jpeg",
    dialogTitle: "Share your Drape try-on",
    UTI: "public.jpeg",
  });
  return true;
}

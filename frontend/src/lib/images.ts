// Helpers to pick photos and obtain compressed base64 strings the backend
// can forward to Gemini. Resizes images to a max edge to keep payloads small.

import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

interface PickedImage {
  uri: string;
  base64: string;
}

const MAX_EDGE = 1024;

async function compress(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_EDGE } }],
    {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    },
  );
  return result.base64 ?? "";
}

export async function pickImageFromLibrary(): Promise<PickedImage | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    quality: 1,
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const base64 = await compress(asset.uri);
  return { uri: asset.uri, base64 };
}

export async function pickImageFromCamera(): Promise<PickedImage | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    quality: 1,
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const base64 = await compress(asset.uri);
  return { uri: asset.uri, base64 };
}

export function dataUriFromBase64(b64: string, mime = "image/jpeg"): string {
  if (b64.startsWith("data:")) return b64;
  return `data:${mime};base64,${b64}`;
}

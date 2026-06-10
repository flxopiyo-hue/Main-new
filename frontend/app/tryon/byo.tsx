// BYO Garment: upload a clothing photo and render it on the active profile.

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { ActiveProfileChip } from "@/src/components/ActiveProfileChip";
import { useToast } from "@/src/components/Toast";
import { TryOnResult, api } from "@/src/lib/api";
import { dataUriFromBase64, pickImageFromCamera, pickImageFromLibrary } from "@/src/lib/images";
import { useProfiles } from "@/src/lib/profiles";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const GARMENT_TYPES: { key: string; label: string; backendType: string }[] = [
  { key: "top", label: "Top", backendType: "shirt" },
  { key: "dress", label: "Dress", backendType: "dress" },
  { key: "bottom", label: "Bottom", backendType: "trousers" },
  { key: "outerwear", label: "Outerwear", backendType: "outerwear" },
  { key: "shoes", label: "Shoes", backendType: "shoes" },
  { key: "accessory", label: "Accessory", backendType: "other" },
];

export default function BYOTryOnScreen() {
  const toast = useToast();
  const { active } = useProfiles();
  const [garmentB64, setGarmentB64] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [garmentType, setGarmentType] = useState<string>("top");
  const [result, setResult] = useState<TryOnResult | null>(null);
  const [generating, setGenerating] = useState(false);

  const pickFromLibrary = async () => {
    try {
      const picked = await pickImageFromLibrary();
      if (picked) setGarmentB64(picked.base64);
    } catch (e: any) {
      toast.show(e?.message ?? "Photo picker failed", "error");
    }
  };

  const pickFromCamera = async () => {
    try {
      const picked = await pickImageFromCamera();
      if (picked) setGarmentB64(picked.base64);
    } catch (e: any) {
      toast.show(e?.message ?? "Camera failed", "error");
    }
  };

  const generate = async () => {
    if (!garmentB64) {
      toast.show("Pick a garment photo first", "error");
      return;
    }
    if (!active?.profile.has_front_photo) {
      toast.show("Add a front photo to your active profile first", "error");
      return;
    }
    setGenerating(true);
    try {
      const mapped = GARMENT_TYPES.find((g) => g.key === garmentType);
      const res = await api.tryOnGarment({
        garment_b64: garmentB64,
        garment_type: mapped?.backendType ?? "other",
        label: label.trim() || undefined,
        use_profile_photo: true,
        profile_id: active?.profile_id ?? "self",
        angles: ["front"],
      });
      setResult(res);
      toast.show("Generated", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Try-on failed", "error");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="byo-back-btn"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption}>BYO GARMENT</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[tp.h1, { marginTop: spacing.sm }]}>Your clothes.{"\n"}On you.</Text>
        <Text style={[tp.bodyMuted, { marginTop: spacing.sm }]}>
          Upload a clear photo of any garment. We&apos;ll render it on the active profile using the
          same AI try-on engine.
        </Text>

        <View style={{ marginTop: spacing.lg }}>
          <ActiveProfileChip testIDPrefix="byo-profile-chip" />
        </View>

        {/* Garment image picker */}
        <Text style={[tp.caption, styles.label]}>Garment photo</Text>
        <View style={styles.garmentBox} testID="byo-garment-box">
          {garmentB64 ? (
            <Image
              source={{ uri: dataUriFromBase64(garmentB64) }}
              style={styles.garmentImage}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.garmentPlaceholder}>
              <Feather name="upload-cloud" size={36} color={colors.mutedFg} />
              <Text style={[tp.bodyMuted, { marginTop: 6 }]}>No garment picked</Text>
            </View>
          )}
        </View>
        <View style={styles.btnRow}>
          <TouchableOpacity
            testID="byo-pick-library"
            onPress={pickFromLibrary}
            style={styles.smallBtn}
            activeOpacity={0.85}
          >
            <Feather name="image" size={16} color={colors.primary} />
            <Text style={styles.smallBtnLabel}>FROM LIBRARY</Text>
          </TouchableOpacity>
          {Platform.OS !== "web" ? (
            <TouchableOpacity
              testID="byo-pick-camera"
              onPress={pickFromCamera}
              style={styles.smallBtn}
              activeOpacity={0.85}
            >
              <Feather name="camera" size={16} color={colors.primary} />
              <Text style={styles.smallBtnLabel}>USE CAMERA</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Garment type */}
        <Text style={[tp.caption, styles.label]}>What kind of piece?</Text>
        <View style={styles.chipsWrap}>
          {GARMENT_TYPES.map((g) => {
            const isActive = garmentType === g.key;
            return (
              <TouchableOpacity
                key={g.key}
                testID={`byo-type-${g.key}`}
                onPress={() => setGarmentType(g.key)}
                style={[styles.chip, isActive && styles.chipActive]}
                activeOpacity={0.85}
              >
                <Text
                  style={[styles.chipLabel, isActive && styles.chipLabelActive]}
                >
                  {g.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Optional label */}
        <AppInput
          testID="byo-label-input"
          label="Name this look (optional)"
          value={label}
          onChangeText={setLabel}
          placeholder="Blue Aloha shirt"
          maxLength={60}
        />

        {/* Result */}
        {result ? (
          <View style={styles.resultWrap} testID="byo-result">
            <Text style={[tp.caption, styles.label]}>Result</Text>
            <Image
              source={{ uri: dataUriFromBase64(result.result_image_b64) }}
              style={styles.resultImage}
              resizeMode="cover"
            />
          </View>
        ) : null}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>

      <View style={styles.footer}>
        <AppButton
          testID="byo-generate-btn"
          label={generating ? "Rendering…" : result ? "Re-render" : "Try it on"}
          onPress={generate}
          loading={generating}
          disabled={!garmentB64}
        />
        {generating ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[tp.bodyMuted, { marginLeft: 8 }]}>
              AI is rendering. This can take up to a minute.
            </Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: { width: 32, height: 32, justifyContent: "center" },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  label: { marginTop: spacing.lg, marginBottom: spacing.sm },
  garmentBox: {
    width: "100%",
    aspectRatio: 4 / 5,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  garmentPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  garmentImage: { width: "100%", height: "100%" },
  btnRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  smallBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  smallBtnLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.primary,
  },
  chipsWrap: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 14,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.primary,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  chipLabelActive: { color: colors.primaryFg },
  resultWrap: { marginTop: spacing.lg },
  resultImage: { width: "100%", aspectRatio: 3 / 4, backgroundColor: colors.muted },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
});

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { useToast } from "@/src/components/Toast";
import { api, Measurements } from "@/src/lib/api";
import { dataUriFromBase64, pickImageFromCamera, pickImageFromLibrary } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface PickState {
  uri: string;
  base64: string;
}

export default function MeasurementsScreen() {
  const toast = useToast();
  const [m, setM] = useState<Measurements>({});
  const [preferredSize, setPreferredSize] = useState<string | null>(null);
  const [frontPhoto, setFrontPhoto] = useState<PickState | null>(null);
  const [sidePhoto, setSidePhoto] = useState<PickState | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await api.getProfile();
        if (p.measurements) setM(p.measurements);
        if (p.preferred_size) setPreferredSize(p.preferred_size);
      } catch {
        // first-time profile
      }
    })();
  }, []);

  const pickPhoto = async (slot: "front" | "side", source: "camera" | "library") => {
    try {
      const result =
        source === "camera" ? await pickImageFromCamera() : await pickImageFromLibrary();
      if (!result) {
        toast.show("Permission denied or no image picked", "error");
        return;
      }
      if (slot === "front") setFrontPhoto(result);
      else setSidePhoto(result);
    } catch (e: any) {
      toast.show(e?.message ?? "Could not pick image", "error");
    }
  };

  const estimate = async () => {
    if (!frontPhoto || !sidePhoto) {
      toast.show("Please add front and side photos first", "error");
      return;
    }
    setEstimating(true);
    try {
      const est = await api.estimateMeasurements({
        front_photo_b64: frontPhoto.base64,
        side_photo_b64: sidePhoto.base64,
        height_cm: m.height_cm ?? undefined,
      });
      setM((curr) => ({ ...curr, ...est }));
      toast.show("Measurements estimated by AI", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Estimation failed", "error");
    } finally {
      setEstimating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateProfile({
        measurements: m,
        preferred_size: preferredSize,
        front_photo_b64: frontPhoto?.base64,
        side_photo_b64: sidePhoto?.base64,
      });
      toast.show("Profile saved", "success");
      router.replace("/(tabs)");
    } catch (e: any) {
      toast.show(e?.message ?? "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const sizeOptions = ["XS", "S", "M", "L", "XL", "XXL"];

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="onboarding-back-btn"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption}>STEP 01 / 01</Text>
        <TouchableOpacity
          testID="onboarding-skip-btn"
          onPress={() => router.replace("/(tabs)")}
          style={styles.iconBtn}
        >
          <Text style={styles.skip}>Skip</Text>
        </TouchableOpacity>
      </View>
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        bottomOffset={120}
      >
        <Text style={[tp.h1, styles.title]}>Build your{"\n"}body profile.</Text>
        <Text style={[tp.bodyMuted, styles.sub]}>
          Add two photos and we&apos;ll estimate your measurements with AI. You can also enter them manually.
        </Text>

        <View style={{ height: spacing.xl }} />
        <Text style={[tp.caption, styles.label]}>Photos</Text>
        <View style={styles.photoRow}>
          <PhotoPicker
            testIDPrefix="front-photo"
            placeholderLabel="Front View"
            photo={frontPhoto}
            onPick={(src) => pickPhoto("front", src)}
          />
          <PhotoPicker
            testIDPrefix="side-photo"
            placeholderLabel="Side View"
            photo={sidePhoto}
            onPick={(src) => pickPhoto("side", src)}
          />
        </View>
        <AppButton
          testID="onboarding-ai-estimate-btn"
          label={estimating ? "Estimating…" : "Estimate with AI"}
          variant="secondary"
          onPress={estimate}
          loading={estimating}
          style={{ marginTop: spacing.md }}
        />

        <View style={{ height: spacing.xl }} />
        <Text style={[tp.caption, styles.label]}>Measurements (cm)</Text>
        <View style={styles.grid}>
          <NumberInput testID="height-input" label="Height" value={m.height_cm} onChange={(v) => setM({ ...m, height_cm: v })} />
          <NumberInput testID="chest-input" label="Chest" value={m.chest_cm} onChange={(v) => setM({ ...m, chest_cm: v })} />
          <NumberInput testID="waist-input" label="Waist" value={m.waist_cm} onChange={(v) => setM({ ...m, waist_cm: v })} />
          <NumberInput testID="hips-input" label="Hips" value={m.hips_cm} onChange={(v) => setM({ ...m, hips_cm: v })} />
          <NumberInput testID="shoulders-input" label="Shoulders" value={m.shoulders_cm} onChange={(v) => setM({ ...m, shoulders_cm: v })} />
          <NumberInput testID="inseam-input" label="Inseam" value={m.inseam_cm} onChange={(v) => setM({ ...m, inseam_cm: v })} />
        </View>

        <View style={{ height: spacing.lg }} />
        <Text style={[tp.caption, styles.label]}>Preferred Size</Text>
        <View style={styles.sizeRow}>
          {sizeOptions.map((s) => (
            <TouchableOpacity
              key={s}
              testID={`size-pref-${s}`}
              onPress={() => setPreferredSize(preferredSize === s ? null : s)}
              style={[
                styles.sizeChip,
                preferredSize === s ? styles.sizeChipActive : styles.sizeChipInactive,
              ]}
            >
              <Text
                style={[
                  styles.sizeChipLabel,
                  preferredSize === s ? styles.sizeChipLabelActive : styles.sizeChipLabelInactive,
                ]}
              >
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ height: 120 }} />
      </KeyboardAwareScrollView>
      <View style={styles.footer}>
        <AppButton
          testID="onboarding-save-btn"
          label="Save & Continue"
          onPress={save}
          loading={saving}
        />
      </View>
    </SafeAreaView>
  );
}

interface NumberInputProps {
  label: string;
  value?: number | null;
  onChange: (v: number | undefined) => void;
  testID: string;
}

function NumberInput({ label, value, onChange, testID }: NumberInputProps) {
  return (
    <View style={styles.gridCell}>
      <AppInput
        label={label}
        testID={testID}
        keyboardType="decimal-pad"
        value={value != null ? String(value) : ""}
        onChangeText={(t) => {
          if (t === "") return onChange(undefined);
          const n = parseFloat(t.replace(",", "."));
          if (!isNaN(n)) onChange(n);
        }}
        placeholder="—"
      />
    </View>
  );
}

interface PhotoPickerProps {
  photo: PickState | null;
  placeholderLabel: string;
  onPick: (source: "camera" | "library") => void;
  testIDPrefix: string;
}

function PhotoPicker({ photo, placeholderLabel, onPick, testIDPrefix }: PhotoPickerProps) {
  return (
    <View style={styles.photoCol} testID={testIDPrefix}>
      <View style={styles.photoFrame}>
        {photo ? (
          <Image
            source={{ uri: dataUriFromBase64(photo.base64) }}
            style={styles.photoImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.photoEmpty}>
            <Feather name="user" size={32} color={colors.mutedFg} />
            <Text style={styles.photoEmptyLabel}>{placeholderLabel}</Text>
          </View>
        )}
      </View>
      <View style={styles.photoActions}>
        <TouchableOpacity
          testID={`${testIDPrefix}-camera-btn`}
          onPress={() => onPick("camera")}
          style={styles.photoActionBtn}
        >
          <Feather name="camera" size={14} color={colors.primary} />
          <Text style={styles.photoActionLabel}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID={`${testIDPrefix}-library-btn`}
          onPress={() => onPick("library")}
          style={styles.photoActionBtn}
        >
          <Feather name="image" size={14} color={colors.primary} />
          <Text style={styles.photoActionLabel}>Library</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: {
    width: 56,
    height: 32,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  skip: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.mutedFg, textAlign: "right", width: 56 },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  title: { marginTop: spacing.md },
  sub: { marginTop: spacing.md, maxWidth: 360 },
  label: { marginBottom: spacing.sm },
  photoRow: { flexDirection: "row", gap: spacing.md },
  photoCol: { flex: 1 },
  photoFrame: { aspectRatio: 3 / 4, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border },
  photoImage: { width: "100%", height: "100%" },
  photoEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  photoEmptyLabel: { fontFamily: fonts.bodyMedium, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: colors.mutedFg },
  photoActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  photoActionBtn: {
    flex: 1,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  photoActionLabel: { fontFamily: fonts.bodyMedium, fontSize: 11, letterSpacing: 1, color: colors.primary, textTransform: "uppercase" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -spacing.sm / 2 },
  gridCell: { width: "50%", paddingHorizontal: spacing.sm / 2 },
  sizeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sizeChip: {
    width: 50,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  sizeChipInactive: { borderColor: colors.border, backgroundColor: colors.surface },
  sizeChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  sizeChipLabel: { fontFamily: fonts.bodySemi, fontSize: 13, letterSpacing: 1 },
  sizeChipLabelInactive: { color: colors.primary },
  sizeChipLabelActive: { color: colors.primaryFg },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});

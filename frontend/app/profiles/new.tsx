// Add a loved-one body profile so the buyer can shop on behalf of someone else.

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { useToast } from "@/src/components/Toast";
import { Gender, ProfileAudience, api } from "@/src/lib/api";
import { dataUriFromBase64, pickImageFromCamera, pickImageFromLibrary } from "@/src/lib/images";
import { useProfiles } from "@/src/lib/profiles";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

type AdultGender = "male" | "female" | "other";

const KID_GENDERS: { key: "male" | "female"; label: string }[] = [
  { key: "male", label: "Boy" },
  { key: "female", label: "Girl" },
];

const ADULT_GENDERS: { key: AdultGender; label: string }[] = [
  { key: "male", label: "Male" },
  { key: "female", label: "Female" },
  { key: "other", label: "Other" },
];

export default function NewLovedOneScreen() {
  const toast = useToast();
  const { refresh, setActive } = useProfiles();

  const [audience, setAudience] = useState<ProfileAudience | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [name, setName] = useState("");
  const [age, setAge] = useState<string>("");
  const [heightCm, setHeightCm] = useState<string>("");
  const [chestCm, setChestCm] = useState<string>("");
  const [waistCm, setWaistCm] = useState<string>("");
  const [frontB64, setFrontB64] = useState<string | null>(null);
  const [sideB64, setSideB64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ageNum = useMemo(() => {
    const n = parseInt(age, 10);
    return Number.isFinite(n) ? n : null;
  }, [age]);

  const ageInvalid = audience === "kid" && (ageNum === null || ageNum < 0 || ageNum > 17);

  const pickPhoto = async (slot: "front" | "side") => {
    try {
      const choice =
        Platform.OS === "web"
          ? await pickImageFromLibrary()
          : await new Promise<typeof undefined | Awaited<ReturnType<typeof pickImageFromLibrary>>>(
              (resolve) => {
                // Native modal: prefer library on first tap; users can retake.
                pickImageFromLibrary().then(resolve);
              },
            );
      const picked = await choice;
      if (!picked) return;
      if (slot === "front") setFrontB64(picked.base64);
      else setSideB64(picked.base64);
    } catch (e: any) {
      toast.show(e?.message ?? "Photo selection failed", "error");
    }
  };

  const takePhoto = async (slot: "front" | "side") => {
    try {
      const picked = await pickImageFromCamera();
      if (!picked) return;
      if (slot === "front") setFrontB64(picked.base64);
      else setSideB64(picked.base64);
    } catch (e: any) {
      toast.show(e?.message ?? "Camera failed", "error");
    }
  };

  const submit = async () => {
    if (!audience) {
      toast.show("Adult or child?", "error");
      return;
    }
    if (!name.trim()) {
      toast.show("Please enter a name (or nickname)", "error");
      return;
    }
    if (audience === "kid" && (ageNum === null || ageNum < 0 || ageNum > 17)) {
      toast.show("Age must be between 0 and 17", "error");
      return;
    }
    if (!gender) {
      toast.show("Pick a gender", "error");
      return;
    }
    setSaving(true);
    try {
      const measurements: Record<string, number | undefined> = {};
      const h = parseFloat(heightCm);
      const c = parseFloat(chestCm);
      const w = parseFloat(waistCm);
      if (Number.isFinite(h)) measurements.height_cm = h;
      if (Number.isFinite(c)) measurements.chest_cm = c;
      if (Number.isFinite(w)) measurements.waist_cm = w;
      const created = await api.createLovedOne({
        name: name.trim(),
        audience,
        gender,
        age: audience === "kid" ? ageNum : ageNum ?? null,
        measurements: Object.keys(measurements).length ? measurements : undefined,
        front_photo_b64: frontB64 ?? undefined,
        side_photo_b64: sideB64 ?? undefined,
      });
      toast.show(`${created.name} added`, "success");
      // Activate the new profile immediately for a delightful UX.
      await setActive(created.id);
      await refresh();
      router.back();
    } catch (e: any) {
      toast.show(e?.message ?? "Could not save profile", "error");
    } finally {
      setSaving(false);
    }
  };

  const showGenderOptions =
    audience === "kid" ? KID_GENDERS : audience === "adult" ? ADULT_GENDERS : [];

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="loved-one-back-btn"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption}>NEW LOVED ONE</Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} bottomOffset={24}>
        <Text style={[tp.h1, { marginTop: spacing.sm }]}>Who are you{"\n"}shopping for?</Text>
        <Text style={[tp.bodyMuted, { marginTop: spacing.sm }]}>
          Add a body profile for someone else — a child, partner, or gift recipient. Each profile
          has its own photos, dimensions, and Discover filter.
        </Text>

        {/* Audience picker */}
        <Text style={[tp.caption, styles.label]}>Adult or child</Text>
        <View style={styles.row}>
          {(["adult", "kid"] as ProfileAudience[]).map((a) => {
            const active = audience === a;
            return (
              <TouchableOpacity
                key={a}
                testID={`loved-one-audience-${a}`}
                onPress={() => {
                  setAudience(a);
                  setGender(null);
                }}
                style={[styles.bigChip, active && styles.bigChipActive]}
                activeOpacity={0.85}
              >
                <Feather
                  name={a === "kid" ? "smile" : "user"}
                  size={20}
                  color={active ? colors.primaryFg : colors.primary}
                />
                <Text
                  style={[styles.bigChipLabel, active && { color: colors.primaryFg }]}
                >
                  {a === "kid" ? "Child" : "Adult"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Gender */}
        {audience ? (
          <>
            <Text style={[tp.caption, styles.label]}>Gender</Text>
            <View style={styles.row}>
              {showGenderOptions.map((g) => {
                const active = gender === g.key;
                return (
                  <TouchableOpacity
                    key={g.key}
                    testID={`loved-one-gender-${g.key}`}
                    onPress={() => setGender(g.key)}
                    style={[styles.chip, active && styles.chipActive]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                      {g.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : null}

        <AppInput
          testID="loved-one-name-input"
          label={audience === "kid" ? "Their name / nickname" : "Name"}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          placeholder={audience === "kid" ? "Mateo" : "Avery"}
        />

        <AppInput
          testID="loved-one-age-input"
          label={audience === "kid" ? "Age (years)" : "Age (optional)"}
          value={age}
          onChangeText={setAge}
          keyboardType="number-pad"
          placeholder={audience === "kid" ? "8" : "32"}
          errorText={ageInvalid && age ? "0–17 for children" : undefined}
        />

        <Text style={[tp.caption, styles.label]}>Quick dimensions (optional)</Text>
        <View style={styles.row}>
          <View style={styles.flex1}>
            <AppInput
              testID="loved-one-height-input"
              label="Height (cm)"
              value={heightCm}
              onChangeText={setHeightCm}
              keyboardType="decimal-pad"
              placeholder="130"
            />
          </View>
          <View style={styles.flex1}>
            <AppInput
              testID="loved-one-chest-input"
              label="Chest (cm)"
              value={chestCm}
              onChangeText={setChestCm}
              keyboardType="decimal-pad"
              placeholder="65"
            />
          </View>
          <View style={styles.flex1}>
            <AppInput
              testID="loved-one-waist-input"
              label="Waist (cm)"
              value={waistCm}
              onChangeText={setWaistCm}
              keyboardType="decimal-pad"
              placeholder="58"
            />
          </View>
        </View>

        <Text style={[tp.caption, styles.label]}>Photos (optional but recommended)</Text>
        <Text style={[tp.bodyMuted, { marginBottom: spacing.md }]}>
          Add a front and a side photo so the AI Try-On can dress them realistically. You can add
          these later from this profile.
        </Text>
        <View style={styles.row}>
          <PhotoSlot
            testID="loved-one-photo-front"
            label="FRONT"
            b64={frontB64}
            onPick={() => pickPhoto("front")}
            onCamera={() => takePhoto("front")}
          />
          <PhotoSlot
            testID="loved-one-photo-side"
            label="SIDE"
            b64={sideB64}
            onPick={() => pickPhoto("side")}
            onCamera={() => takePhoto("side")}
          />
        </View>

        <View style={{ height: spacing.xl }} />
      </KeyboardAwareScrollView>

      <View style={styles.footer}>
        <AppButton
          testID="loved-one-submit"
          label={saving ? "Saving…" : "Save loved one"}
          onPress={submit}
          loading={saving}
        />
      </View>
    </SafeAreaView>
  );
}

function PhotoSlot({
  testID,
  label,
  b64,
  onPick,
  onCamera,
}: {
  testID: string;
  label: string;
  b64: string | null;
  onPick: () => void;
  onCamera: () => void;
}) {
  return (
    <View style={styles.photoSlot} testID={testID}>
      {b64 ? (
        <Image source={{ uri: dataUriFromBase64(b64) }} style={styles.photoImg} resizeMode="cover" />
      ) : (
        <View style={styles.photoPlaceholder}>
          <Feather name="camera" size={22} color={colors.mutedFg} />
          <Text style={styles.photoLabel}>{label}</Text>
        </View>
      )}
      <View style={styles.photoBtns}>
        <TouchableOpacity
          testID={`${testID}-library`}
          onPress={onPick}
          style={styles.smallBtn}
          activeOpacity={0.85}
        >
          <Feather name="image" size={14} color={colors.primary} />
          <Text style={styles.smallBtnLabel}>Library</Text>
        </TouchableOpacity>
        {Platform.OS !== "web" ? (
          <TouchableOpacity
            testID={`${testID}-camera`}
            onPress={onCamera}
            style={styles.smallBtn}
            activeOpacity={0.85}
          >
            <Feather name="camera" size={14} color={colors.primary} />
            <Text style={styles.smallBtnLabel}>Camera</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
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
  iconBtn: { width: 32, height: 32, alignItems: "flex-start", justifyContent: "center" },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xl },
  label: { marginTop: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: "row", gap: spacing.md, flexWrap: "wrap" },
  flex1: { flex: 1, minWidth: 100 },
  bigChip: {
    flex: 1,
    minWidth: 130,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  bigChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  bigChipLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
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
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.primary,
  },
  chipLabelActive: { color: colors.primaryFg },
  photoSlot: {
    flex: 1,
    minWidth: 140,
    gap: 6,
  },
  photoPlaceholder: {
    aspectRatio: 3 / 4,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  photoImg: { aspectRatio: 3 / 4, width: "100%" },
  photoLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.mutedFg,
    textTransform: "uppercase",
  },
  photoBtns: { flexDirection: "row", gap: 6 },
  smallBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  smallBtnLabel: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.primary },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});

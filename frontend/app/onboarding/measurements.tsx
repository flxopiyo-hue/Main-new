import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { useToast } from "@/src/components/Toast";
import { api, Measurements } from "@/src/lib/api";
import { dataUriFromBase64, pickImageFromCamera, pickImageFromLibrary } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";
import {
  cmToDisplay,
  displayToCm,
  LengthUnit,
  placeholderFor,
} from "@/src/lib/units";

interface PickState {
  uri: string;
  base64: string;
}

type Slot = "front" | "side" | "three_quarter";

const SLOT_LABEL: Record<Slot, string> = {
  front: "Front view",
  side: "Side profile",
  three_quarter: "Three-quarter",
};

const SLOTS: Slot[] = ["front", "side", "three_quarter"];

export default function MeasurementsScreen() {
  const toast = useToast();
  const [m, setM] = useState<Measurements>({});
  const [preferredSize, setPreferredSize] = useState<string | null>(null);
  const [unit, setUnit] = useState<LengthUnit>("cm");
  const [front, setFront] = useState<PickState | null>(null);
  const [side, setSide] = useState<PickState | null>(null);
  const [threeQuarter, setThreeQuarter] = useState<PickState | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [saving, setSaving] = useState(false);

  const photos: Record<Slot, PickState | null> = useMemo(
    () => ({ front, side, three_quarter: threeQuarter }),
    [front, side, threeQuarter],
  );

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

  const pickPhoto = async (slot: Slot, source: "camera" | "library") => {
    try {
      const result =
        source === "camera" ? await pickImageFromCamera() : await pickImageFromLibrary();
      if (!result) {
        toast.show("Permission denied or no image picked", "error");
        return;
      }
      if (slot === "front") setFront(result);
      else if (slot === "side") setSide(result);
      else setThreeQuarter(result);
    } catch (e: any) {
      toast.show(e?.message ?? "Could not pick image", "error");
    }
  };

  const photoCount = [front, side, threeQuarter].filter(Boolean).length;

  const estimate = async () => {
    if (photoCount === 0) {
      toast.show("Add at least one photo to use AI estimation", "error");
      return;
    }
    if (!m.height_cm) {
      toast.show("Tip: add your height first — AI uses it as the anchor", "error");
      // continue anyway — AI can still try without height
    }
    setEstimating(true);
    try {
      const est = await api.estimateMeasurements({
        front_photo_b64: front?.base64,
        side_photo_b64: side?.base64,
        three_quarter_photo_b64: threeQuarter?.base64,
        height_cm: m.height_cm ?? undefined,
      });
      setM((curr) => ({ ...curr, ...est }));
      toast.show(
        `AI estimated ${
          [est.chest_cm, est.waist_cm, est.hips_cm, est.shoulders_cm, est.inseam_cm].filter(
            Boolean,
          ).length
        } measurements`,
        "success",
      );
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
        front_photo_b64: front?.base64,
        side_photo_b64: side?.base64,
        three_quarter_photo_b64: threeQuarter?.base64,
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

  // Simple size recommendation based on chest/bust measurement — good
  // enough for buyer onboarding; the per-item Fit Match Score refines
  // this later using the actual garment dimensions.
  const recommendedSize: string | null = useMemo(() => {
    const chest = m.chest_cm ?? m.bust_cm ?? null;
    if (!chest || chest <= 0) return null;
    if (chest < 86) return "XS";
    if (chest < 90) return "S";
    if (chest < 94) return "M";
    if (chest < 100) return "L";
    if (chest < 106) return "XL";
    return "XXL";
  }, [m.chest_cm, m.bust_cm]);

  // First time we compute a recommendation and the user hasn't picked
  // one yet — auto-select it so the CTA below reflects a real choice.
  useEffect(() => {
    if (recommendedSize && !preferredSize) {
      setPreferredSize(recommendedSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendedSize]);

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
          Snap up to three photos and we&apos;ll estimate your measurements with AI.
          Give us your height first — that&apos;s how the AI calibrates the rest.
        </Text>

        {/* PHOTOS */}
        <View style={{ height: spacing.xl }} />
        <View style={styles.sectionHead}>
          <Text style={[tp.caption, styles.label]}>Photos · {photoCount}/3</Text>
          {photoCount > 0 ? (
            <Text style={[tp.bodyMuted, { fontSize: 11 }]}>
              {photoCount === 1
                ? "Add side or three-quarter for better accuracy"
                : photoCount === 2
                  ? "One more for full coverage"
                  : "All three covered ✓"}
            </Text>
          ) : null}
        </View>
        <View style={styles.photoRow}>
          {SLOTS.map((slot) => (
            <PhotoTile
              key={slot}
              testIDPrefix={`${slot.replace("_", "-")}-photo`}
              placeholderLabel={SLOT_LABEL[slot]}
              photo={photos[slot]}
              onPick={(src) => pickPhoto(slot, src)}
            />
          ))}
        </View>

        {/* UNIT PICKER */}
        <View style={{ height: spacing.xl }} />
        <View style={styles.sectionHead}>
          <Text style={[tp.caption, styles.label]}>Measurements</Text>
          <View style={styles.unitRow} testID="unit-toggle">
            {(["cm", "in", "ft"] as LengthUnit[]).map((u) => (
              <TouchableOpacity
                key={u}
                testID={`unit-${u}`}
                onPress={() => setUnit(u)}
                style={[
                  styles.unitBtn,
                  u === unit ? styles.unitBtnActive : styles.unitBtnInactive,
                ]}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.unitLabel,
                    u === unit ? styles.unitLabelActive : styles.unitLabelInactive,
                  ]}
                >
                  {u.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.grid}>
          <UnitInput
            testID="height-input"
            label="Height"
            placeholder={placeholderFor("height", unit)}
            unit={unit}
            valueCm={m.height_cm}
            onChange={(cm) => setM({ ...m, height_cm: cm })}
          />
          <UnitInput
            testID="chest-input"
            label="Chest"
            placeholder={placeholderFor("girth", unit)}
            unit={unit}
            valueCm={m.chest_cm}
            onChange={(cm) => setM({ ...m, chest_cm: cm })}
          />
          <UnitInput
            testID="waist-input"
            label="Waist"
            placeholder={placeholderFor("girth", unit)}
            unit={unit}
            valueCm={m.waist_cm}
            onChange={(cm) => setM({ ...m, waist_cm: cm })}
          />
          <UnitInput
            testID="hips-input"
            label="Hips"
            placeholder={placeholderFor("girth", unit)}
            unit={unit}
            valueCm={m.hips_cm}
            onChange={(cm) => setM({ ...m, hips_cm: cm })}
          />
          <UnitInput
            testID="shoulders-input"
            label="Shoulders"
            placeholder={placeholderFor("girth", unit)}
            unit={unit}
            valueCm={m.shoulders_cm}
            onChange={(cm) => setM({ ...m, shoulders_cm: cm })}
          />
          <UnitInput
            testID="inseam-input"
            label="Inseam"
            placeholder={placeholderFor("girth", unit)}
            unit={unit}
            valueCm={m.inseam_cm}
            onChange={(cm) => setM({ ...m, inseam_cm: cm })}
          />
        </View>

        <AppButton
          testID="onboarding-ai-estimate-btn"
          label={
            estimating
              ? "Estimating…"
              : m.height_cm
                ? `Estimate the rest with AI · ${photoCount} photo${photoCount === 1 ? "" : "s"}`
                : "Add height + a photo to use AI"
          }
          variant="secondary"
          onPress={estimate}
          loading={estimating}
          disabled={photoCount === 0}
          style={{ marginTop: spacing.md }}
        />

        {/* SIZE */}
        <View style={{ height: spacing.xl }} />
        {recommendedSize ? (
          <View testID="onboarding-size-recommendation" style={styles.recCard}>
            <View style={styles.recIconWrap}>
              <Feather name="check-circle" size={18} color={colors.primaryFg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.recLabel}>RECOMMENDED FOR YOU</Text>
              <Text style={styles.recTitle}>
                Size {recommendedSize}
                {preferredSize === recommendedSize ? " ✓ selected" : ""}
              </Text>
              <Text style={styles.recSub}>
                Based on your{" "}
                {m.chest_cm ? "chest" : "bust"}{" "}
                {Math.round(m.chest_cm ?? m.bust_cm ?? 0)}
                cm — you can override below if you know your fit runs different.
              </Text>
            </View>
          </View>
        ) : null}
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
                recommendedSize === s && preferredSize !== s
                  ? styles.sizeChipSuggested
                  : null,
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

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

interface UnitInputProps {
  testID: string;
  label: string;
  placeholder: string;
  unit: LengthUnit;
  valueCm?: number | null;
  onChange: (cm: number | undefined) => void;
}

function UnitInput({ testID, label, placeholder, unit, valueCm, onChange }: UnitInputProps) {
  // We keep an internal "draft" string that the user is typing so cm rounding
  // doesn't fight the cursor on every keystroke. The draft is reset whenever
  // the unit changes or the parent re-pushes a new cm value (e.g. after AI estimate).
  const [draft, setDraft] = useState<string>(() => cmToDisplay(valueCm, unit));

  useEffect(() => {
    setDraft(cmToDisplay(valueCm, unit));
  }, [unit, valueCm]);

  return (
    <View style={styles.gridCell}>
      <AppInput
        label={label}
        testID={testID}
        keyboardType={unit === "ft" ? "default" : "decimal-pad"}
        value={draft}
        onChangeText={(t) => {
          setDraft(t);
          const cm = displayToCm(t, unit);
          onChange(cm ?? undefined);
        }}
        placeholder={placeholder}
      />
    </View>
  );
}

interface PhotoTileProps {
  photo: PickState | null;
  placeholderLabel: string;
  onPick: (source: "camera" | "library") => void;
  testIDPrefix: string;
}

function PhotoTile({ photo, placeholderLabel, onPick, testIDPrefix }: PhotoTileProps) {
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
            <Feather name="user" size={26} color={colors.mutedFg} />
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
          <Feather name="camera" size={12} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          testID={`${testIDPrefix}-library-btn`}
          onPress={() => onPick("library")}
          style={styles.photoActionBtn}
        >
          <Feather name="image" size={12} color={colors.primary} />
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
  iconBtn: { width: 56, height: 32, alignItems: "flex-start", justifyContent: "center" },
  skip: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.mutedFg,
    textAlign: "right",
    width: 56,
  },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  title: { marginTop: spacing.md },
  sub: { marginTop: spacing.md, maxWidth: 360 },
  label: { marginBottom: spacing.sm },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  photoRow: { flexDirection: "row", gap: spacing.sm },
  photoCol: { flex: 1 },
  photoFrame: {
    aspectRatio: 3 / 4,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoImage: { width: "100%", height: "100%" },
  photoEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  photoEmptyLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.mutedFg,
    textAlign: "center",
    paddingHorizontal: 4,
  },
  photoActions: { flexDirection: "row", gap: 6, marginTop: 6 },
  photoActionBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  unitRow: { flexDirection: "row", gap: 0, marginBottom: spacing.sm },
  unitBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    marginLeft: -1,
  },
  unitBtnInactive: { borderColor: colors.border, backgroundColor: colors.surface },
  unitBtnActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  unitLabel: { fontFamily: fonts.bodySemi, fontSize: 11, letterSpacing: 1.4 },
  unitLabelInactive: { color: colors.primary },
  unitLabelActive: { color: colors.primaryFg },
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
  sizeChipSuggested: {
    borderColor: colors.primary,
    borderWidth: 2,
    borderStyle: "dashed",
  },
  sizeChipLabel: { fontFamily: fonts.bodySemi, fontSize: 13, letterSpacing: 1 },
  sizeChipLabelInactive: { color: colors.primary },
  sizeChipLabelActive: { color: colors.primaryFg },
  recCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.primary,
    marginBottom: spacing.md,
  },
  recIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  recLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    color: colors.primaryFg,
    letterSpacing: 1.4,
    opacity: 0.7,
  },
  recTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 17,
    color: colors.primaryFg,
    marginTop: 2,
  },
  recSub: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.primaryFg,
    opacity: 0.85,
    marginTop: 4,
    lineHeight: 15,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});

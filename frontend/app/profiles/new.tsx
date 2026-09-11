// New loved-one body profile — full parity with the self-user onboarding
// flow. Shoppers register a wife / husband / child / friend the same way
// they onboarded themselves: three-angle photos, six body measurements
// (with AI-powered estimation from the photos), preferred clothing size
// and preferred shoe size.
//
// Layout mirrors app/onboarding/measurements.tsx as closely as possible
// so the two flows feel like one product. The only bits that differ are
// the header block (audience picker + name + relation + gender + age),
// because those don't apply when a user is onboarding themselves.

import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
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
import {
  BodyMeasureGuide,
  BodyMeasureKey,
  GuideGender,
} from "@/src/components/BodyMeasureGuide";
import { useToast } from "@/src/components/Toast";
import { Gender, Measurements, ProfileAudience, api } from "@/src/lib/api";
import { confirmDialog } from "@/src/lib/confirm";
import { dataUriFromBase64, pickImageFromCamera, pickImageFromLibrary } from "@/src/lib/images";
import { useProfiles } from "@/src/lib/profiles";
import { ADULT_SHOE_SIZES } from "@/src/lib/shoe-sizes";
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

// Same input rows as the self-user flow so both screens feel identical.
type MeasureRow = { key: BodyMeasureKey; label: string };
const MEASURE_ROWS: MeasureRow[] = [
  { key: "shoulders_cm", label: "Shoulders" },
  { key: "chest_cm", label: "Chest / Bust" },
  { key: "waist_cm", label: "Waist" },
  { key: "hips_cm", label: "Hips" },
  { key: "inseam_cm", label: "Inseam" },
];

const CLOTHING_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

export default function NewLovedOneScreen() {
  const toast = useToast();
  const { refresh, setActive, active } = useProfiles();

  // Route params — when `id` is set the screen operates in EDIT mode:
  // it hydrates from GET /loved-ones/{id}, PATCHes on submit, and shows
  // an extra "Delete profile" button. Otherwise it stays a pure create
  // form. Both flows share every input widget below.
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const isEdit = typeof editId === "string" && editId.length > 0;

  // --- Loved-one identity (unique to this screen) -------------------------
  const [audience, setAudience] = useState<ProfileAudience | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [age, setAge] = useState<string>("");

  // --- Same shape as self-user onboarding ---------------------------------
  const [m, setM] = useState<Measurements>({});
  const [preferredSize, setPreferredSize] = useState<string | null>(null);
  const [preferredShoeSize, setPreferredShoeSize] = useState<string | null>(null);
  const [unit, setUnit] = useState<LengthUnit>("cm");
  const [front, setFront] = useState<PickState | null>(null);
  const [side, setSide] = useState<PickState | null>(null);
  const [threeQuarter, setThreeQuarter] = useState<PickState | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Edit-mode hydration state. `hydrating=true` until we've fetched the
  // existing loved-one so the form doesn't render half-empty.
  const [hydrating, setHydrating] = useState<boolean>(isEdit);
  // Cached identity name so the header can say "Edit Avery" while the
  // form is still editable. Also used by the delete confirm dialog.
  const [originalName, setOriginalName] = useState<string>("");

  // ---------------------------------------------------------------------
  // Hydrate the form when editing. We fetch ONCE on mount — subsequent
  // renders are driven by local state only, so users can keep tweaking
  // even while the network responds slowly.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!isEdit || !editId) return;
    let cancelled = false;
    (async () => {
      try {
        const doc = await api.getLovedOne(editId);
        if (cancelled) return;
        setAudience(doc.audience);
        setGender((doc.gender as Gender) ?? null);
        setName(doc.name ?? "");
        setOriginalName(doc.name ?? "");
        setRelation(doc.relation ?? "");
        setAge(doc.age != null ? String(doc.age) : "");
        setM(doc.measurements ?? {});
        setPreferredSize(doc.preferred_size ?? null);
        setPreferredShoeSize(doc.preferred_shoe_size ?? null);
        if (doc.front_photo_b64) {
          setFront({
            uri: dataUriFromBase64(doc.front_photo_b64),
            base64: doc.front_photo_b64,
          });
        }
        if (doc.side_photo_b64) {
          setSide({
            uri: dataUriFromBase64(doc.side_photo_b64),
            base64: doc.side_photo_b64,
          });
        }
        if (doc.three_quarter_photo_b64) {
          setThreeQuarter({
            uri: dataUriFromBase64(doc.three_quarter_photo_b64),
            base64: doc.three_quarter_photo_b64,
          });
        }
      } catch (e: any) {
        toast.show(e?.message ?? "Could not load profile", "error");
        // Bail back to the list — the id in the URL is stale/invalid.
        router.replace("/profiles");
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately ignore `toast` — it's a stable identity from ToastProvider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, editId]);

  // Body-guide silhouette highlight — matches self-user onboarding.
  const [guideKey, setGuideKey] = useState<BodyMeasureKey | null>(null);
  const focusGuide = (k: BodyMeasureKey) => setGuideKey(k);
  const blurGuide = (k: BodyMeasureKey) => {
    if (guideKey === k) setGuideKey(null);
  };

  // Height (optional reference) is separate from the 5 body measurements
  // that drive the fit score. Same pattern as self-user onboarding.
  const heightCm = m.height_cm ?? null;

  const guideGender: GuideGender = useMemo(() => {
    if (audience === "kid") return "kid";
    if (gender === "male") return "male";
    return "female";
  }, [audience, gender]);

  const ageNum = useMemo(() => {
    const n = parseInt(age, 10);
    return Number.isFinite(n) ? n : null;
  }, [age]);

  const ageInvalid = audience === "kid" && (ageNum === null || ageNum < 0 || ageNum > 17);

  const slotStateFor = (s: Slot) =>
    s === "front" ? front : s === "side" ? side : threeQuarter;
  const setSlot = (s: Slot, v: PickState | null) => {
    if (s === "front") setFront(v);
    else if (s === "side") setSide(v);
    else setThreeQuarter(v);
  };

  const pickFor = async (slot: Slot, source: "library" | "camera") => {
    try {
      const picked =
        source === "camera" ? await pickImageFromCamera() : await pickImageFromLibrary();
      if (!picked) return;
      setSlot(slot, { uri: dataUriFromBase64(picked.base64), base64: picked.base64 });
    } catch (e: any) {
      toast.show(e?.message ?? "Photo selection failed", "error");
    }
  };

  const estimateFromPhotos = async () => {
    if (!front && !side && !threeQuarter) {
      toast.show("Add at least one photo to estimate measurements", "error");
      return;
    }
    setEstimating(true);
    try {
      const est = await api.estimateMeasurements({
        front_photo_b64: front?.base64,
        side_photo_b64: side?.base64,
        three_quarter_photo_b64: threeQuarter?.base64,
        height_cm: heightCm ?? undefined,
      });
      // Walk the silhouette through the estimated values one by one for delight.
      const applied: BodyMeasureKey[] = [];
      const next: Measurements = { ...m };
      for (const key of ["shoulders_cm", "chest_cm", "waist_cm", "hips_cm", "inseam_cm"] as BodyMeasureKey[]) {
        const v = (est as any)[key];
        if (typeof v === "number" && Number.isFinite(v)) {
          (next as any)[key] = v;
          applied.push(key);
        }
      }
      setM(next);
      if (applied.length === 0) {
        toast.show("AI couldn't infer measurements — please enter manually", "error");
      } else {
        toast.show(`Applied ${applied.length} measurements`, "success");
        // Sweep the highlight for a beat so the user can see them land.
        for (const k of applied) {
          setGuideKey(k);
          await new Promise((r) => setTimeout(r, 350));
        }
        setGuideKey(null);
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Could not estimate", "error");
    } finally {
      setEstimating(false);
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
      // Only include measurements that were actually set; empty object
      // reads cleanly on the backend as "no measurements yet".
      const measurements: Measurements = {};
      for (const key of ["height_cm", "shoulders_cm", "chest_cm", "waist_cm", "hips_cm", "inseam_cm"] as (keyof Measurements)[]) {
        const v = m[key];
        if (typeof v === "number" && Number.isFinite(v)) (measurements as any)[key] = v;
      }
      const payload = {
        name: name.trim(),
        audience,
        gender,
        age: audience === "kid" ? ageNum : ageNum ?? null,
        relation: relation.trim() || undefined,
        measurements: Object.keys(measurements).length ? measurements : undefined,
        preferred_size: preferredSize ?? undefined,
        preferred_shoe_size: preferredShoeSize ?? undefined,
        front_photo_b64: front?.base64,
        side_photo_b64: side?.base64,
        three_quarter_photo_b64: threeQuarter?.base64,
      };
      if (isEdit && editId) {
        const updated = await api.updateLovedOne(editId, payload);
        toast.show(`${updated.name} updated`, "success");
        await refresh();
        // If the user landed on this screen via a direct deep link there's
        // nothing to go back to — fall through to the profiles list.
        if (router.canGoBack()) router.back();
        else router.replace("/profiles");
      } else {
        const created = await api.createLovedOne(payload);
        toast.show(`${created.name} added`, "success");
        await setActive(created.id);
        await refresh();
        if (router.canGoBack()) router.back();
        else router.replace("/profiles");
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Could not save profile", "error");
    } finally {
      setSaving(false);
    }
  };

  // Delete the loved-one from the edit screen (mirrors the trash icon
  // in the list). We keep the confirm dialog identical to the list so
  // the user always sees the same "This won't affect your orders" copy.
  const handleDelete = () => {
    if (!isEdit || !editId) return;
    const displayName = originalName || name || "this profile";
    confirmDialog({
      title: "Delete profile?",
      message: `Remove ${displayName}? This won't affect your orders — you can add them back later.`,
      confirmLabel: "Delete profile",
      destructive: true,
      onConfirm: async () => {
        setDeleting(true);
        try {
          await api.deleteLovedOne(editId);
          // If the deleted profile was the active one, the backend
          // has already reset it to "self"; refresh mirrors that.
          if (active?.profile_id === editId) {
            await setActive("self");
          }
          await refresh();
          toast.show(`${displayName} removed`, "success");
          router.replace("/profiles");
        } catch (e: any) {
          toast.show(e?.message ?? "Could not delete profile", "error");
        } finally {
          setDeleting(false);
        }
      },
    });
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
        <Text style={tp.caption}>{isEdit ? "EDIT PROFILE" : "NEW BODY PROFILE"}</Text>
        <View style={styles.iconBtn} />
      </View>

      {hydrating ? (
        <View style={styles.hydrateBlock} testID="loved-one-hydrating">
          <ActivityIndicator color={colors.primary} />
          <Text style={[tp.bodyMuted, { marginTop: spacing.sm }]}>
            Loading profile…
          </Text>
        </View>
      ) : (
        <KeyboardAwareScrollView contentContainerStyle={styles.scroll} bottomOffset={24}>
          <Text style={[tp.h1, { marginTop: spacing.sm }]}>
            {isEdit ? (
              <>Edit{"\n"}{originalName || name || "profile"}</>
            ) : (
              <>Who are you{"\n"}shopping for?</>
            )}
          </Text>
          <Text style={[tp.bodyMuted, { marginTop: spacing.sm }]}>
            {isEdit
              ? "Update photos, measurements or preferred sizes any time. Changes apply to future Try-Ons immediately."
              : "Same photos, measurements, and shoe size as your own profile — so AI Try-On dresses them just as accurately."}
          </Text>

        {/* ---------- Loved-one identity block ---------- */}
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
                <Text style={[styles.bigChipLabel, active && { color: colors.primaryFg }]}>
                  {a === "kid" ? "Child" : "Adult"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

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
          testID="loved-one-relation-input"
          label="Relation (optional)"
          value={relation}
          onChangeText={setRelation}
          autoCapitalize="words"
          placeholder={audience === "kid" ? "Son" : "Wife"}
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

        {/* ---------- Photos: 3 angles, matches self-user ---------- */}
        <Text style={[tp.caption, styles.sectionHeader]}>Photos</Text>
        <Text style={[tp.bodyMuted, { marginBottom: spacing.md }]}>
          Add all three angles for the best AI Try-On results. You can add more later.
        </Text>
        <View style={styles.photosRow}>
          {SLOTS.map((slot) => {
            const state = slotStateFor(slot);
            return (
              <View key={slot} style={styles.photoSlot} testID={`loved-one-photo-${slot}`}>
                {state ? (
                  <Image source={{ uri: state.uri }} style={styles.photoImg} resizeMode="cover" />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Feather name="camera" size={22} color={colors.mutedFg} />
                    <Text style={styles.photoLabel}>{SLOT_LABEL[slot]}</Text>
                  </View>
                )}
                <View style={styles.photoBtns}>
                  <TouchableOpacity
                    testID={`loved-one-photo-${slot}-library`}
                    onPress={() => pickFor(slot, "library")}
                    style={styles.smallBtn}
                    activeOpacity={0.85}
                  >
                    <Feather name="image" size={14} color={colors.primary} />
                    <Text style={styles.smallBtnLabel}>Library</Text>
                  </TouchableOpacity>
                  {Platform.OS !== "web" ? (
                    <TouchableOpacity
                      testID={`loved-one-photo-${slot}-camera`}
                      onPress={() => pickFor(slot, "camera")}
                      style={styles.smallBtn}
                      activeOpacity={0.85}
                    >
                      <Feather name="camera" size={14} color={colors.primary} />
                      <Text style={styles.smallBtnLabel}>Camera</Text>
                    </TouchableOpacity>
                  ) : null}
                  {state ? (
                    <TouchableOpacity
                      testID={`loved-one-photo-${slot}-clear`}
                      onPress={() => setSlot(slot, null)}
                      style={styles.smallBtn}
                      activeOpacity={0.85}
                    >
                      <Feather name="x" size={14} color={colors.primary} />
                      <Text style={styles.smallBtnLabel}>Clear</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>

        {/* ---------- Measurements (identical to self-user) ---------- */}
        <View style={styles.measureHeader}>
          <View>
            <Text style={tp.caption}>MEASUREMENTS</Text>
            <Text style={[tp.bodyMuted, { marginTop: 4, fontSize: 12 }]}>
              Tap a field to see where to measure on the silhouette.
            </Text>
          </View>
          <View style={styles.unitPills}>
            {(["cm", "in"] as LengthUnit[]).map((u) => (
              <TouchableOpacity
                key={u}
                testID={`loved-one-unit-${u}`}
                onPress={() => setUnit(u)}
                style={[styles.unitPill, unit === u && styles.unitPillActive]}
                activeOpacity={0.85}
              >
                <Text
                  style={[styles.unitPillLabel, unit === u && styles.unitPillLabelActive]}
                >
                  {u.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <BodyMeasureGuide
          gender={guideGender}
          activeKey={guideKey}
          values={m}
          unit={unit}
        />

        {(front || side || threeQuarter) && (
          <>
            <View style={{ height: spacing.md }} />
            <AppButton
              testID="loved-one-estimate-btn"
              label={estimating ? "Estimating…" : "Estimate from photos with AI"}
              variant="secondary"
              onPress={estimateFromPhotos}
              loading={estimating}
            />
          </>
        )}

        {/* Height (optional reference, same as self-user) */}
        <View style={{ height: spacing.md }} />
        <AppInput
          testID="loved-one-height-input"
          label={`Height (${unit}) — optional, improves AI estimate`}
          value={
            heightCm !== null && heightCm !== undefined ? cmToDisplay(heightCm, unit) : ""
          }
          onChangeText={(v) => {
            const cm = displayToCm(v, unit);
            setM({ ...m, height_cm: cm ?? undefined });
          }}
          keyboardType="decimal-pad"
          placeholder={placeholderFor("height_cm", unit)}
          onFocus={() => focusGuide("shoulders_cm")}
          onBlur={() => blurGuide("shoulders_cm")}
        />

        {/* Five body measurements — same grid as self-user */}
        {MEASURE_ROWS.map((r) => {
          const cm = (m as any)[r.key] as number | undefined;
          return (
            <AppInput
              key={r.key}
              testID={`loved-one-${r.key}-input`}
              label={`${r.label} (${unit})`}
              value={cm !== undefined && cm !== null ? cmToDisplay(cm, unit) : ""}
              onChangeText={(v) => {
                const val = displayToCm(v, unit);
                setM({ ...m, [r.key]: val ?? undefined });
              }}
              keyboardType="decimal-pad"
              placeholder={placeholderFor(r.key, unit)}
              onFocus={() => focusGuide(r.key)}
              onBlur={() => blurGuide(r.key)}
            />
          );
        })}

        {/* Preferred clothing size */}
        <Text style={[tp.caption, styles.label]}>Preferred size (optional)</Text>
        <View style={styles.row}>
          {CLOTHING_SIZES.map((s) => {
            const active = preferredSize === s;
            return (
              <TouchableOpacity
                key={s}
                testID={`loved-one-size-${s}`}
                onPress={() => setPreferredSize(active ? null : s)}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{s}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Preferred shoe size */}
        <Text style={[tp.caption, styles.label]}>Preferred shoe size (EU)</Text>
        <View style={styles.row}>
          {ADULT_SHOE_SIZES.map((s) => {
            const active = preferredShoeSize === s.value;
            return (
              <TouchableOpacity
                key={s.value}
                testID={`loved-one-shoe-${s.value}`}
                onPress={() => setPreferredShoeSize(active ? null : s.value)}
                style={[styles.smallChip, active && styles.chipActive]}
                activeOpacity={0.85}
              >
                <Text style={[styles.smallChipLabel, active && styles.chipLabelActive]}>
                  {s.value}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ height: spacing.xl }} />
        </KeyboardAwareScrollView>
      )}

      {!hydrating ? (
        <View style={styles.footer}>
          <AppButton
            testID="loved-one-submit"
            label={saving ? "Saving…" : isEdit ? "Save changes" : "Save profile"}
            onPress={submit}
            loading={saving}
            disabled={deleting}
          />
          {isEdit ? (
            <TouchableOpacity
              testID="loved-one-delete-btn"
              onPress={handleDelete}
              disabled={deleting || saving}
              style={[styles.deleteBtn, (deleting || saving) && { opacity: 0.6 }]}
              accessibilityLabel="Delete this loved-one profile"
            >
              {deleting ? (
                <ActivityIndicator color={colors.error} size="small" />
              ) : (
                <>
                  <Feather name="trash-2" size={14} color={colors.error} />
                  <Text style={styles.deleteBtnLabel}>Delete profile</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
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
  iconBtn: { width: 32, height: 32, alignItems: "flex-start", justifyContent: "center" },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xl },
  label: { marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionHeader: { marginTop: spacing.xl, marginBottom: 4 },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
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
  smallChip: {
    paddingHorizontal: 10,
    height: 34,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  smallChipLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.primary,
  },
  photosRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  photoSlot: { flex: 1, minWidth: 100, gap: 6 },
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
    textAlign: "center",
  },
  photoBtns: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
  smallBtn: {
    flex: 1,
    minWidth: 46,
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
  measureHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  unitPills: {
    flexDirection: "row",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  unitPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.surface,
  },
  unitPillActive: { backgroundColor: colors.primary },
  unitPillLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.primary,
  },
  unitPillLabelActive: { color: colors.primaryFg },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  hydrateBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    marginTop: spacing.sm,
  },
  deleteBtnLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.error,
    textTransform: "uppercase",
  },
});

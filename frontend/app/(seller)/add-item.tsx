// Multi-step Add Item Wizard. This screen replaces the legacy `seller/new-item`
// single-page form. The seller is guided through:
//
//   1. Basics     → Photo, Title, Price (+ currency), Description
//   2. Taxonomy   → Audience, Category, Subcategory
//   3. Sizing     → Per-size dimension matrix (driven by garment_type) +
//                   Colors. Strict numeric validation: every entered
//                   measurement must be a positive number; available_qty
//                   defaults to 5 but must remain ≥ 1.
//
// Each step ships with its own validation gate. The "Next" button is
// disabled until the current step is valid, so a seller cannot reach the
// summary step with missing required data.

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { useToast } from "@/src/components/Toast";
import {
  api,
  Audience,
  CATEGORIES_BY_AUDIENCE,
  CATEGORY_LABELS,
  ColorOption,
  CurrencyCode,
  DIMENSION_KEYS_BY_TYPE,
  DIMENSION_LABELS,
  DimensionKey,
  SizeOption,
  SUBCATEGORIES_BY_CATEGORY,
} from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { CURRENCIES, parseAmountToCents, priceInputPlaceholder } from "@/src/lib/currency";
import { dataUriFromBase64, pickImageFromCamera, pickImageFromLibrary } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

/* -------------------------------------------------------------------------- */
/* Taxonomy & constants                                                       */
/* -------------------------------------------------------------------------- */

const CATEGORIES = ["shirts", "dresses", "pants", "outerwear", "shoes", "accessories"] as const;
type Category = (typeof CATEGORIES)[number];

const AUDIENCES: { key: Audience; label: string }[] = [
  { key: "women", label: "Women" },
  { key: "men", label: "Men" },
  { key: "unisex", label: "Unisex" },
  { key: "kids", label: "Kids" },
];

const ADULT_SIZE_LABELS = ["XS", "S", "M", "L", "XL", "XXL"];
const KID_SIZE_LABELS = [
  "NB", "3M", "6M", "12M", "18M", "24M",
  "2T", "3T", "4T",
  "5", "6", "7", "8", "10", "12", "14", "16",
];

// Map our seller-facing category to the backend garment_type so we can render
// only the relevant dimension inputs per size. Mirrors the inference logic on
// the backend (`models.infer_garment_type`). Sellers who pick "accessories"
// won't see body-fit measurement inputs at all.
const CATEGORY_TO_GARMENT_TYPE: Record<Category, string> = {
  shirts: "shirt",
  dresses: "dress",
  pants: "trousers",
  outerwear: "outerwear",
  shoes: "shoes",
  accessories: "other",
};

const PRESET_COLORS: ColorOption[] = [
  { name: "Black", hex: "#0A0A0A" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Camel", hex: "#C8A77B" },
  { name: "Olive", hex: "#5C6F44" },
  { name: "Navy", hex: "#1B2A4E" },
  { name: "Rose", hex: "#D4859A" },
];

const STEPS = [
  { num: 1, label: "Basics" },
  { num: 2, label: "Taxonomy" },
  { num: 3, label: "Sizing" },
] as const;

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Parse a free-form numeric string entered by the seller. Returns:
 *   - `undefined` when the input is blank (no value yet);
 *   - `NaN` when the input is present but not a valid positive number;
 *   - the parsed positive number otherwise.
 *
 * We intentionally treat zero as invalid for body measurements — a garment
 * with a 0cm chest is obviously a data-entry mistake. The same parser is
 * reused for available_qty where zero is also rejected (stock must be ≥ 1).
 */
const parsePositive = (s: string): number | undefined => {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  const n = parseFloat(trimmed.replace(",", "."));
  if (isNaN(n) || n <= 0) return NaN;
  return n;
};

/* -------------------------------------------------------------------------- */
/* Wizard root                                                                */
/* -------------------------------------------------------------------------- */

export default function AddItem() {
  const toast = useToast();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 720;

  const defaultCurrency: CurrencyCode = (user?.preferred_currency ?? "KES") as CurrencyCode;

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 — up to 5 photos (primary first). `brand_name` is optional but
  // we surface it as a first-class field so buyers can search by it later.
  const [photos, setPhotos] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency);
  const [description, setDescription] = useState("");

  // Step 2
  const [audience, setAudience] = useState<Audience>("unisex");
  const [category, setCategory] = useState<Category>("shirts");
  const [subcategory, setSubcategory] = useState<string | null>(null);

  // Step 3
  const [sizes, setSizes] = useState<Record<string, SizeOption>>({});
  const [pickedColors, setPickedColors] = useState<ColorOption[]>([]);
  const [saving, setSaving] = useState(false);

  // -----------------------------------------------------------------------
  // Per-step validation rules
  // -----------------------------------------------------------------------
  const step1Errors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (photos.length === 0) errs.image = "Add at least one product photo";
    if (!name.trim()) errs.name = "Title is required";
    const cents = parseAmountToCents(priceInput, currency);
    if (!priceInput.trim()) errs.price = "Price is required";
    else if (!cents || cents <= 0) errs.price = "Price must be a positive number";
    return errs;
  }, [photos.length, name, priceInput, currency]);

  const step2Errors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!audience) errs.audience = "Pick a target audience";
    if (!category) errs.category = "Pick a category";
    // Subcategory is optional but if the category has one we strongly
    // recommend filling it in — show as a soft warning, not a hard block.
    return errs;
  }, [audience, category]);

  const gtype = CATEGORY_TO_GARMENT_TYPE[category] ?? "other";
  const dimKeys: DimensionKey[] = (DIMENSION_KEYS_BY_TYPE[gtype] ?? []) as DimensionKey[];

  // Track invalid (non-positive / non-numeric) entries in the matrix so the
  // UI can highlight them and the Publish button can stay disabled.
  const matrixErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    const labels = Object.values(sizes);
    if (labels.length === 0) {
      errs._sizes = "Pick at least one size";
      return errs;
    }
    for (const s of labels) {
      // available_qty: required, must be >= 1
      if (!s.available_qty || s.available_qty <= 0) {
        errs[`${s.label}-available_qty`] = "Qty must be ≥ 1";
      }
      // Each body dimension that's relevant to this garment_type is treated
      // as REQUIRED — otherwise the Fit Match Score we're building next has
      // nothing to compare against. We allow zero dimensions for the
      // "accessories"/"shoes" tracks where dimKeys is [] (loop just no-ops).
      for (const k of dimKeys) {
        const raw = (s as Record<string, unknown>)[k];
        // No value entered → blank submission → error
        if (raw === undefined || raw === null || raw === "") {
          errs[`${s.label}-${k}`] = "Required";
          continue;
        }
        // Negative / zero / non-numeric → error
        if (typeof raw !== "number" || raw <= 0 || isNaN(raw)) {
          errs[`${s.label}-${k}`] = "Must be > 0";
        }
      }
    }
    return errs;
  }, [sizes, dimKeys]);

  const step1Valid = Object.keys(step1Errors).length === 0;
  const step2Valid = Object.keys(step2Errors).length === 0;
  const step3Valid = Object.keys(matrixErrors).length === 0;

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------
  const pickImage = async (source: "camera" | "library") => {
    if (photos.length >= 5) {
      toast.show("Up to 5 photos per item", "error");
      return;
    }
    const res = source === "camera" ? await pickImageFromCamera() : await pickImageFromLibrary();
    if (!res) {
      toast.show("Permission denied or no image picked", "error");
      return;
    }
    setPhotos((curr) => [...curr, res.base64]);
  };

  // Remove a photo by index. Reordering is handled via dedicated chevron
  // buttons on each thumbnail (kept simple for v1 — no drag-and-drop).
  const removePhoto = (idx: number) => {
    setPhotos((curr) => curr.filter((_, i) => i !== idx));
  };

  const movePhoto = (idx: number, dir: -1 | 1) => {
    setPhotos((curr) => {
      const next = [...curr];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return curr;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const toggleSize = (label: string) => {
    setSizes((curr) => {
      const next = { ...curr };
      if (next[label]) delete next[label];
      else next[label] = { label, available_qty: 5 };
      return next;
    });
  };

  const updateSize = (label: string, patch: Partial<SizeOption>) => {
    setSizes((curr) => (curr[label] ? { ...curr, [label]: { ...curr[label], ...patch } } : curr));
  };

  const toggleColor = (c: ColorOption) => {
    setPickedColors((arr) =>
      arr.find((x) => x.name === c.name) ? arr.filter((x) => x.name !== c.name) : [...arr, c],
    );
  };

  const next = () => {
    if (step === 1 && !step1Valid) {
      toast.show(Object.values(step1Errors)[0], "error");
      return;
    }
    if (step === 2 && !step2Valid) {
      toast.show(Object.values(step2Errors)[0], "error");
      return;
    }
    setStep((s) => (s === 3 ? 3 : ((s + 1) as 2 | 3)));
  };

  const back = () => setStep((s) => (s === 1 ? 1 : ((s - 1) as 1 | 2)));

  const submit = async () => {
    if (!step1Valid || !step2Valid || !step3Valid) {
      toast.show("Resolve form errors before publishing", "error");
      return;
    }
    const priceCents = parseAmountToCents(priceInput, currency);
    if (photos.length === 0 || !priceCents) return; // type guard

    setSaving(true);
    try {
      const [primary, ...extras] = photos;
      await api.createItem({
        name: name.trim(),
        description: description.trim(),
        brand_name: brandName.trim() || undefined,
        category,
        subcategory: subcategory ?? undefined,
        price_cents: priceCents,
        currency,
        image_b64: primary,
        extra_images: extras,
        sizes: Object.values(sizes),
        colors: pickedColors,
        audience,
      });
      toast.show("Item published", "success");
      router.replace("/(seller)");
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to publish", "error");
    } finally {
      setSaving(false);
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      {/* Header & step progress bar */}
      <View style={styles.header}>
        <TouchableOpacity
          testID="wizard-back-btn"
          onPress={() => (step === 1 ? router.replace("/(seller)") : back())}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={step === 1 ? "Back to inventory" : "Previous step"}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption}>NEW PIECE · STEP {step} / 3</Text>
        <View style={styles.iconBtn} />
      </View>

      <Stepper current={step} />

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={[styles.scroll, isWide && styles.scrollWide]}
        bottomOffset={120}
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 && (
          <StepBasics
            photos={photos}
            name={name}
            brandName={brandName}
            priceInput={priceInput}
            currency={currency}
            description={description}
            errors={step1Errors}
            onPickImage={pickImage}
            onRemovePhoto={removePhoto}
            onMovePhoto={movePhoto}
            onChangeName={setName}
            onChangeBrand={setBrandName}
            onChangePrice={setPriceInput}
            onChangeCurrency={setCurrency}
            onChangeDescription={setDescription}
          />
        )}

        {step === 2 && (
          <StepTaxonomy
            audience={audience}
            category={category}
            subcategory={subcategory}
            onChangeAudience={(a) => {
              setAudience(a);
              // If the currently-selected category isn't valid for the new
              // audience (e.g. "dresses" was picked but the seller just
              // switched to "men"), snap to the first available category
              // and clear subcategory + sizes. This guarantees the seller
              // never lands on an option they can't actually save.
              const allowed = CATEGORIES_BY_AUDIENCE[a] ?? CATEGORIES;
              if (!allowed.includes(category)) {
                const next = (allowed[0] ?? "shirts") as Category;
                setCategory(next);
                setSubcategory(null);
                setSizes({});
              }
            }}
            onChangeCategory={(c) => {
              setCategory(c);
              setSubcategory(null);
              // Reset measurement entries when the taxonomy changes — a value
              // entered for "chest" on a shirt doesn't carry over when the
              // seller switches to trousers (different dimension keys).
              setSizes({});
            }}
            onChangeSubcategory={setSubcategory}
          />
        )}

        {step === 3 && (
          <StepSizing
            audience={audience}
            category={category}
            sizes={sizes}
            dimKeys={dimKeys}
            errors={matrixErrors}
            colors={pickedColors}
            onToggleSize={toggleSize}
            onUpdateSize={updateSize}
            onToggleColor={toggleColor}
          />
        )}
      </KeyboardAwareScrollView>

      {/* Wizard footer */}
      <View style={styles.footer}>
        {step > 1 ? (
          <TouchableOpacity
            testID="wizard-prev-btn"
            onPress={back}
            style={[styles.footerBtn, styles.footerBtnGhost]}
            activeOpacity={0.85}
          >
            <Text style={[tp.buttonLabel, { color: colors.primary }]}>BACK</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {step < 3 ? (
          <TouchableOpacity
            testID="wizard-next-btn"
            onPress={next}
            disabled={
              (step === 1 && !step1Valid) ||
              (step === 2 && !step2Valid)
            }
            style={[
              styles.footerBtn,
              styles.footerBtnPrimary,
              ((step === 1 && !step1Valid) || (step === 2 && !step2Valid)) && styles.footerBtnDisabled,
            ]}
            activeOpacity={0.85}
          >
            <Text style={[tp.buttonLabel, { color: colors.primaryFg }]}>NEXT</Text>
            <Feather name="arrow-right" size={16} color={colors.primaryFg} />
          </TouchableOpacity>
        ) : (
          <View style={{ flex: 1 }}>
            <AppButton
              testID="wizard-publish-btn"
              label="Publish"
              onPress={submit}
              loading={saving}
              disabled={!step1Valid || !step2Valid || !step3Valid}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/* Stepper                                                                    */
/* -------------------------------------------------------------------------- */

function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <View style={styles.stepper} testID="wizard-stepper">
      {STEPS.map((s, idx) => {
        const isActive = s.num === current;
        const isDone = s.num < current;
        return (
          <View key={s.num} style={styles.stepperItem}>
            <View
              style={[
                styles.stepDot,
                isActive && styles.stepDotActive,
                isDone && styles.stepDotDone,
              ]}
              testID={`wizard-step-${s.num}-${isActive ? "active" : isDone ? "done" : "pending"}`}
            >
              {isDone ? (
                <Feather name="check" size={12} color={colors.primaryFg} />
              ) : (
                <Text
                  style={[
                    styles.stepDotLabel,
                    isActive && { color: colors.primaryFg },
                  ]}
                >
                  {s.num}
                </Text>
              )}
            </View>
            <Text
              style={[
                styles.stepLabel,
                isActive && { color: colors.primary },
              ]}
            >
              {s.label}
            </Text>
            {idx < STEPS.length - 1 ? <View style={styles.stepConnector} /> : null}
          </View>
        );
      })}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 1: Basics                                                             */
/* -------------------------------------------------------------------------- */

interface StepBasicsProps {
  photos: string[];
  name: string;
  brandName: string;
  priceInput: string;
  currency: CurrencyCode;
  description: string;
  errors: Record<string, string>;
  onPickImage: (source: "camera" | "library") => void;
  onRemovePhoto: (idx: number) => void;
  onMovePhoto: (idx: number, dir: -1 | 1) => void;
  onChangeName: (v: string) => void;
  onChangeBrand: (v: string) => void;
  onChangePrice: (v: string) => void;
  onChangeCurrency: (c: CurrencyCode) => void;
  onChangeDescription: (v: string) => void;
}

function StepBasics({
  photos,
  name,
  brandName,
  priceInput,
  currency,
  description,
  errors,
  onPickImage,
  onRemovePhoto,
  onMovePhoto,
  onChangeName,
  onChangeBrand,
  onChangePrice,
  onChangeCurrency,
  onChangeDescription,
}: StepBasicsProps) {
  const canAddMore = photos.length < 5;
  return (
    <View>
      <Text style={[tp.h2, styles.stepTitle]}>The basics</Text>
      <Text style={[tp.bodyMuted, styles.stepHint]}>
        Up to 5 photos, title, brand, and price — the essentials a buyer sees first.
      </Text>

      <Text style={[tp.caption, styles.label]}>
        Photos{" "}
        <Text style={{ color: colors.mutedFg, textTransform: "none" }}>
          ({photos.length}/5 · first is the cover)
        </Text>
      </Text>
      {/* Gallery grid */}
      <View style={styles.photoGrid} testID="wizard-photo-grid">
        {photos.map((b64, i) => (
          <View key={`p-${i}`} style={styles.photoSlot} testID={`wizard-photo-${i}`}>
            <Image
              source={{ uri: dataUriFromBase64(b64) }}
              style={styles.photoImg}
              resizeMode="cover"
            />
            {i === 0 ? (
              <View style={styles.coverBadge}>
                <Text style={styles.coverBadgeLabel}>COVER</Text>
              </View>
            ) : null}
            <View style={styles.photoActions}>
              {i > 0 ? (
                <TouchableOpacity
                  testID={`wizard-photo-${i}-up`}
                  onPress={() => onMovePhoto(i, -1)}
                  style={styles.photoActBtn}
                  accessibilityLabel="Move photo earlier"
                >
                  <Feather name="chevron-left" size={14} color={colors.primaryFg} />
                </TouchableOpacity>
              ) : null}
              {i < photos.length - 1 ? (
                <TouchableOpacity
                  testID={`wizard-photo-${i}-down`}
                  onPress={() => onMovePhoto(i, 1)}
                  style={styles.photoActBtn}
                  accessibilityLabel="Move photo later"
                >
                  <Feather name="chevron-right" size={14} color={colors.primaryFg} />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                testID={`wizard-photo-${i}-remove`}
                onPress={() => onRemovePhoto(i)}
                style={[styles.photoActBtn, { backgroundColor: "rgba(220,38,38,0.85)" }]}
                accessibilityLabel="Remove photo"
              >
                <Feather name="x" size={14} color={colors.primaryFg} />
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {canAddMore ? (
          <View style={[styles.photoSlot, styles.photoSlotEmpty]}>
            <View style={styles.photoEmptyInner}>
              <Feather name="image" size={22} color={colors.mutedFg} />
              <Text style={styles.photoEmptyLabel}>
                {photos.length === 0 ? "Add cover" : `Add ${photos.length === 4 ? "last" : "more"}`}
              </Text>
              <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                <TouchableOpacity
                  testID="wizard-photo-add-camera"
                  onPress={() => onPickImage("camera")}
                  style={styles.photoEmptyBtn}
                >
                  <Feather name="camera" size={12} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  testID="wizard-photo-add-library"
                  onPress={() => onPickImage("library")}
                  style={styles.photoEmptyBtn}
                >
                  <Feather name="image" size={12} color={colors.primary} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}
      </View>
      {errors.image ? <Text style={styles.fieldError}>{errors.image}</Text> : null}

      <View style={{ height: spacing.lg }} />
      <AppInput
        testID="wizard-name-input"
        label="Title"
        value={name}
        onChangeText={onChangeName}
        placeholder="Cropped Linen Shirt"
        errorText={errors.name}
      />
      <AppInput
        testID="wizard-brand-input"
        label="Brand (optional)"
        value={brandName}
        onChangeText={onChangeBrand}
        placeholder="Maison Lumière"
      />
      <AppInput
        testID="wizard-price-input"
        label={`Price (${currency})`}
        value={priceInput}
        onChangeText={onChangePrice}
        keyboardType="decimal-pad"
        placeholder={priceInputPlaceholder(currency)}
        errorText={errors.price}
      />
      <Text style={[tp.caption, styles.label]}>Currency</Text>
      <View style={styles.currencyRow}>
        {CURRENCIES.map((c) => (
          <TouchableOpacity
            key={c.code}
            testID={`wizard-currency-${c.code}`}
            onPress={() => onChangeCurrency(c.code)}
            style={[
              styles.currencyChip,
              currency === c.code ? styles.currencyChipActive : styles.currencyChipInactive,
            ]}
          >
            <Text
              style={[
                styles.currencyChipLabel,
                currency === c.code
                  ? styles.currencyChipLabelActive
                  : styles.currencyChipLabelInactive,
              ]}
            >
              {c.symbol} {c.code}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ height: spacing.lg }} />
      <AppInput
        testID="wizard-desc-input"
        label="Description"
        value={description}
        onChangeText={onChangeDescription}
        placeholder="Fabric, fit, inspiration"
        multiline
      />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 2: Taxonomy (Audience · Category · Subcategory)                       */
/* -------------------------------------------------------------------------- */

interface StepTaxonomyProps {
  audience: Audience;
  category: Category;
  subcategory: string | null;
  onChangeAudience: (a: Audience) => void;
  onChangeCategory: (c: Category) => void;
  onChangeSubcategory: (s: string | null) => void;
}

function StepTaxonomy({
  audience,
  category,
  subcategory,
  onChangeAudience,
  onChangeCategory,
  onChangeSubcategory,
}: StepTaxonomyProps) {
  const subs = SUBCATEGORIES_BY_CATEGORY[category] ?? [];
  // Restrict the visible categories to those that make sense for the
  // chosen audience. Sellers who pick "Men" don't see Dresses (and vice
  // versa). The parent component resets `category` when this list
  // changes, so we never end up showing an option that isn't selectable.
  const visibleCategories = (CATEGORIES_BY_AUDIENCE[audience] ?? CATEGORIES) as readonly Category[];

  return (
    <View>
      <Text style={[tp.h2, styles.stepTitle]}>Taxonomy</Text>
      <Text style={[tp.bodyMuted, styles.stepHint]}>
        Help shoppers find this piece by tagging it accurately.
      </Text>

      <Text style={[tp.caption, styles.label]}>Audience</Text>
      <View style={styles.catRow}>
        {AUDIENCES.map((a) => (
          <TouchableOpacity
            key={a.key}
            testID={`wizard-audience-${a.key}`}
            onPress={() => onChangeAudience(a.key)}
            style={[styles.cat, audience === a.key ? styles.catActive : styles.catInactive]}
          >
            <Text
              style={[
                styles.catLabel,
                audience === a.key ? styles.catLabelActive : styles.catLabelInactive,
              ]}
            >
              {a.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[tp.caption, styles.label]}>
        Category{" "}
        <Text style={{ color: colors.mutedFg, textTransform: "none" }}>
          ({visibleCategories.length} options for {audience})
        </Text>
      </Text>
      <View style={styles.catRow}>
        {visibleCategories.map((c) => (
          <TouchableOpacity
            key={c}
            testID={`wizard-cat-${c}`}
            onPress={() => onChangeCategory(c)}
            style={[styles.cat, category === c ? styles.catActive : styles.catInactive]}
          >
            <Text
              style={[
                styles.catLabel,
                category === c ? styles.catLabelActive : styles.catLabelInactive,
              ]}
            >
              {CATEGORY_LABELS[c] ?? c}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[tp.caption, styles.label]}>
        Subcategory{" "}
        <Text style={{ color: colors.mutedFg, textTransform: "none" }}>
          (helps shoppers find this {(CATEGORY_LABELS[category] ?? category).toLowerCase()})
        </Text>
      </Text>
      {subs.length === 0 ? (
        <Text style={[tp.bodyMuted, { marginTop: 4 }]}>
          No subcategories for this category.
        </Text>
      ) : (
        <View style={styles.catRow}>
          {subs.map((s) => (
            <TouchableOpacity
              key={s}
              testID={`wizard-sub-${s}`}
              onPress={() => onChangeSubcategory(subcategory === s ? null : s)}
              style={[
                styles.cat,
                subcategory === s ? styles.catActive : styles.catInactive,
              ]}
            >
              <Text
                style={[
                  styles.catLabel,
                  subcategory === s ? styles.catLabelActive : styles.catLabelInactive,
                ]}
              >
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 3: Sizing matrix + colors                                             */
/* -------------------------------------------------------------------------- */

interface StepSizingProps {
  audience: Audience;
  category: Category;
  sizes: Record<string, SizeOption>;
  dimKeys: DimensionKey[];
  errors: Record<string, string>;
  colors: ColorOption[];
  onToggleSize: (label: string) => void;
  onUpdateSize: (label: string, patch: Partial<SizeOption>) => void;
  onToggleColor: (c: ColorOption) => void;
}

function StepSizing({
  audience,
  sizes,
  dimKeys,
  errors,
  colors: pickedColors,
  onToggleSize,
  onUpdateSize,
  onToggleColor,
}: StepSizingProps) {
  const sizeLabels = audience === "kids" ? KID_SIZE_LABELS : ADULT_SIZE_LABELS;
  const noDims = dimKeys.length === 0;

  return (
    <View>
      <Text style={[tp.h2, styles.stepTitle]}>Sizing</Text>
      <Text style={[tp.bodyMuted, styles.stepHint]}>
        Pick sizes you stock, then fill the per-size measurements buyers will use
        for fit-matching.
      </Text>

      <Text style={[tp.caption, styles.label]}>
        Sizes & dimensions (cm){audience === "kids" ? " · kid sizes" : ""}
      </Text>
      <View style={styles.sizeRow}>
        {sizeLabels.map((s) => {
          const on = !!sizes[s];
          return (
            <TouchableOpacity
              key={s}
              testID={`wizard-size-${s}`}
              onPress={() => onToggleSize(s)}
              style={[styles.sizeChip, on ? styles.sizeChipActive : styles.sizeChipInactive]}
            >
              <Text
                style={[
                  styles.sizeChipLabel,
                  on ? styles.sizeChipLabelActive : styles.sizeChipLabelInactive,
                ]}
              >
                {s}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {errors._sizes ? (
        <Text style={styles.fieldError}>{errors._sizes}</Text>
      ) : null}

      {Object.values(sizes).map((s) => (
        <View key={s.label} style={styles.sizeDetail} testID={`wizard-size-detail-${s.label}`}>
          <View style={styles.sizeDetailHeader}>
            <Text style={styles.sizeDetailLabel}>{s.label}</Text>
            {noDims ? (
              <Text style={styles.sizeDetailHint}>
                No body-fit measurements for this category
              </Text>
            ) : null}
          </View>
          <View style={styles.sizeDetailGrid}>
            {dimKeys.map((k) => (
              <DimField
                key={k}
                testID={`wizard-size-${s.label}-${k}`}
                label={DIMENSION_LABELS[k]}
                value={(s as Record<string, unknown>)[k] as number | undefined}
                onChange={(v) =>
                  onUpdateSize(s.label, { [k]: v } as Partial<SizeOption>)
                }
                errorText={errors[`${s.label}-${k}`]}
              />
            ))}
            <DimField
              testID={`wizard-size-${s.label}-qty`}
              label="Qty"
              value={s.available_qty}
              onChange={(v) =>
                onUpdateSize(s.label, { available_qty: v ?? 0 })
              }
              errorText={errors[`${s.label}-available_qty`]}
            />
          </View>
        </View>
      ))}

      <View style={{ height: spacing.lg }} />
      <Text style={[tp.caption, styles.label]}>Colors</Text>
      <View style={styles.colorRow}>
        {PRESET_COLORS.map((c) => {
          const on = !!pickedColors.find((x) => x.name === c.name);
          return (
            <TouchableOpacity
              key={c.name}
              testID={`wizard-color-${c.name}`}
              onPress={() => onToggleColor(c)}
              style={[
                styles.colorSwatch,
                { backgroundColor: c.hex },
                on && styles.colorSwatchActive,
              ]}
            />
          );
        })}
      </View>
      <View style={{ height: spacing.xxl }} />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Dimension input field                                                      */
/* -------------------------------------------------------------------------- */

interface DimFieldProps {
  label: string;
  value?: number | null;
  onChange: (v: number | undefined) => void;
  testID: string;
  errorText?: string | null;
}

function DimField({ label, value, onChange, testID, errorText }: DimFieldProps) {
  const [raw, setRaw] = useState(value != null ? String(value) : "");

  // Sync external resets (e.g. when switching category clears sizes).
  React.useEffect(() => {
    setRaw(value != null ? String(value) : "");
  }, [value]);

  const handleChange = (t: string) => {
    setRaw(t);
    const n = parsePositive(t);
    if (n === undefined) {
      onChange(undefined);
      return;
    }
    if (isNaN(n)) {
      // Invalid → keep raw text on screen, but propagate undefined so validators see "missing"
      onChange(undefined);
      return;
    }
    onChange(n);
  };

  return (
    <View style={dimStyles.wrap}>
      <Text style={dimStyles.label}>{label}</Text>
      <TextInput
        testID={testID}
        keyboardType="decimal-pad"
        value={raw}
        onChangeText={handleChange}
        placeholder="—"
        placeholderTextColor={colors.mutedFg}
        style={[
          dimStyles.input,
          errorText ? { borderBottomColor: colors.error } : null,
        ]}
      />
      {errorText ? (
        <Text style={dimStyles.error} testID={`${testID}-error`}>
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const dimStyles = StyleSheet.create({
  wrap: { flex: 1, minWidth: "23%" },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.mutedFg,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  input: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.primary,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.error,
    marginTop: 2,
  },
});

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
  iconBtn: { width: 40, height: 32, alignItems: "flex-start", justifyContent: "center" },
  // Step indicator
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  stepperItem: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 8,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stepDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepDotDone: { backgroundColor: colors.success, borderColor: colors.success },
  stepDotLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: colors.primary,
  },
  stepLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.mutedFg,
    textTransform: "uppercase",
  },
  stepConnector: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 4,
  },
  // Scroll body
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  scrollWide: { maxWidth: 760, width: "100%", alignSelf: "center" },
  stepTitle: { marginBottom: 4 },
  stepHint: { marginBottom: spacing.lg },
  label: { marginTop: spacing.md, marginBottom: spacing.sm },
  itemImage: { width: "100%", aspectRatio: 3 / 4, backgroundColor: colors.muted },
  // Photo gallery grid (Step 1)
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  photoSlot: {
    width: "31.5%",
    aspectRatio: 3 / 4,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    position: "relative",
  },
  photoSlotEmpty: {
    alignItems: "center",
    justifyContent: "center",
    borderStyle: "dashed",
  },
  photoEmptyInner: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
  },
  photoEmptyLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.mutedFg,
    textTransform: "uppercase",
    marginTop: 4,
  },
  photoEmptyBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  photoImg: { width: "100%", height: "100%" },
  coverBadge: {
    position: "absolute",
    top: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: colors.primary,
  },
  coverBadgeLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.primaryFg,
  },
  photoActions: {
    position: "absolute",
    bottom: 4,
    right: 4,
    flexDirection: "row",
    gap: 4,
  },
  photoActBtn: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,10,10,0.7)",
  },
  itemImageEmpty: {
    width: "100%",
    aspectRatio: 3 / 4,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemImageEmptyLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.mutedFg,
    textTransform: "uppercase",
  },
  fieldErrorBorder: { borderColor: colors.error },
  fieldError: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.error,
    marginTop: 4,
  },
  imageActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  imageActionBtn: {
    flex: 1,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  imageActionLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.primary,
    textTransform: "uppercase",
  },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cat: {
    paddingHorizontal: 14,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  catInactive: { borderColor: colors.border, backgroundColor: colors.surface },
  catActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  catLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  catLabelInactive: { color: colors.primary },
  catLabelActive: { color: colors.primaryFg },
  sizeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sizeChip: { width: 50, height: 50, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  sizeChipInactive: { borderColor: colors.border, backgroundColor: colors.surface },
  sizeChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  sizeChipLabel: { fontFamily: fonts.bodySemi, fontSize: 13 },
  sizeChipLabelInactive: { color: colors.primary },
  sizeChipLabelActive: { color: colors.primaryFg },
  sizeDetail: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sizeDetailHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sizeDetailLabel: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: colors.primary,
  },
  sizeDetailHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    letterSpacing: 0.6,
    color: colors.mutedFg,
    textTransform: "uppercase",
    flexShrink: 1,
    textAlign: "right",
  },
  sizeDetailGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, rowGap: spacing.md },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  colorSwatch: { width: 40, height: 40, borderWidth: 1, borderColor: colors.border },
  colorSwatchActive: { borderColor: colors.primary, borderWidth: 2 },
  currencyRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  currencyChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  currencyChipInactive: { borderColor: colors.border, backgroundColor: colors.surface },
  currencyChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  currencyChipLabel: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 0.6 },
  currencyChipLabelInactive: { color: colors.primary },
  currencyChipLabelActive: { color: colors.primaryFg },
  // Footer
  footer: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  footerBtn: {
    flex: 1,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  footerBtnGhost: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  footerBtnPrimary: { backgroundColor: colors.primary },
  footerBtnDisabled: { opacity: 0.45 },
});

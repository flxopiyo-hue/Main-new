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
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
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
import { GarmentMeasureGuide } from "@/src/components/GarmentMeasureGuide";
import { useToast } from "@/src/components/Toast";
import {
  api,
  Audience,
  CATEGORIES_BY_AUDIENCE,
  CATEGORY_LABELS,
  CategoryRow,
  ColorOption,
  CurrencyCode,
  DIMENSION_HINTS,
  DIMENSION_KEYS_BY_TYPE,
  DIMENSION_LABELS,
  DimensionKey,
  Item,
  ItemVariant,
  SizeOption,
  SUBCATEGORIES_BY_CATEGORY,
} from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { CURRENCIES, formatPrice, parseAmountToCents, priceInputPlaceholder } from "@/src/lib/currency";
import { dataUriFromBase64, pickImageFromCamera, pickImageFromLibrary } from "@/src/lib/images";
import { ADULT_SHOE_SIZES, KID_SHOE_SIZES } from "@/src/lib/shoe-sizes";
import { ALL_CHARTS, chartsFor, detectChartKey, SizeChart } from "@/src/lib/size-charts";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

/* -------------------------------------------------------------------------- */
/* Taxonomy & constants                                                       */
/* -------------------------------------------------------------------------- */

// System category slugs (always seeded server-side). The full picker list
// comes from GET /api/categories, which also includes community categories
// added by any seller ("swimwear", "kikoy", …) — shared marketplace-wide.
const CATEGORIES: string[] = ["shirts", "dresses", "pants", "outerwear", "shoes", "accessories"];
type Category = string;

// Offline/failure fallback so the wizard stays usable if the categories
// request fails — mirrors the backend seed set.
const FALLBACK_CATALOG: CategoryRow[] = CATEGORIES.map((slug) => ({
  id: slug,
  slug,
  label: CATEGORY_LABELS[slug] ?? slug,
  audiences: Object.entries(CATEGORIES_BY_AUDIENCE)
    .filter(([, list]) => list.includes(slug))
    .map(([aud]) => aud),
  source: "system" as const,
  usage_count: 0,
}));

const AUDIENCES: { key: Audience; label: string }[] = [
  { key: "women", label: "Women" },
  { key: "men", label: "Men" },
  { key: "unisex", label: "Unisex" },
  { key: "kids", label: "Kids" },
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

// Extended palette shown when the seller adds a custom-named color.
// These are common apparel shades so the seller can tap-pick a hue
// without needing a full color picker (which React Native doesn't ship
// natively and would require a heavy 3rd-party lib for). The seller
// can still override via the hex text field below.
const EXTENDED_PALETTE: string[] = [
  "#0A0A0A", // black
  "#3F3F46", // charcoal
  "#8B8B8B", // grey
  "#FFFFFF", // white
  "#F5E6D3", // cream
  "#F4C7A1", // peach
  "#D4859A", // rose
  "#B91C4E", // magenta
  "#8B1E1E", // burgundy
  "#C8A77B", // camel
  "#7B4A1E", // rust
  "#3E2A18", // chocolate
  "#5C6F44", // olive
  "#1F5E42", // forest
  "#0F766E", // teal
  "#1B2A4E", // navy
  "#3B82F6", // cobalt
  "#6D28D9", // purple
  "#F59E0B", // mustard
  "#EF4444", // red
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
  const params = useLocalSearchParams<{ edit_id?: string }>();
  const editId = typeof params.edit_id === "string" ? params.edit_id : undefined;
  const isEditing = !!editId;

  const defaultCurrency: CurrencyCode = (user?.preferred_currency ?? "KES") as CurrencyCode;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  // Hydration: when the wizard launches in edit mode, fetch the item and
  // pre-fill every field so the seller can scrub through the same flow
  // they used to create it. We block the wizard with a small spinner
  // while loading so partial state doesn't flicker into view.
  const [hydrating, setHydrating] = useState<boolean>(isEditing);
  // Centimetre / inch toggle for the per-size dimension inputs. The
  // backend is always cm — this only affects what the seller sees and
  // types. We round-trip cm↔in via 2.54.
  const [unit, setUnit] = useState<"cm" | "in">("cm");

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
  // Shared marketplace categories (system + community). Loaded once —
  // community categories added by other sellers appear here too.
  const [catalog, setCatalog] = useState<CategoryRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await api.listCategories();
        if (!cancelled && rows.length > 0) setCatalog(rows);
      } catch {
        // fall back to FALLBACK_CATALOG below
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const audienceCategories = useMemo(() => {
    const base = catalog.length > 0 ? catalog : FALLBACK_CATALOG;
    return base.filter((c) => (c.audiences ?? []).includes(audience));
  }, [catalog, audience]);

  // Step 3
  const [sizes, setSizes] = useState<Record<string, SizeOption>>({});
  const [pickedColors, setPickedColors] = useState<ColorOption[]>([]);
  // Opt-in variant grid — when the seller has 2+ colors they can toggle
  // this on to specify per (size × color) quantity + optional price
  // override + disabled state. When OFF the backend auto-splits size
  // quantity evenly across colors.
  const [managePerVariant, setManagePerVariant] = useState<boolean>(false);
  // Keyed by `${sizeLabel}::${colorName}` — matches how we render the grid.
  const [variantCells, setVariantCells] = useState<
    Record<string, { quantity: number; disabled: boolean; price_cents_override?: number | null }>
  >({});
  const [saving, setSaving] = useState(false);

  // -----------------------------------------------------------------------
  // Edit-mode hydration
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    (async () => {
      try {
        const item: Item = await api.getItem(editId);
        if (cancelled) return;
        // Reconstitute photos (primary first, then extras). Fall back to
        // image_b64 alone when older items lack the gallery field.
        const gallery = item.images && item.images.length > 0 ? item.images : [item.image_b64];
        setPhotos(gallery);
        setName(item.name);
        setBrandName(item.brand_name || "");
        setCurrency(item.currency);
        // Price is stored as 1/100 of major units. For the input field we
        // show the major-unit value (no decimals for KES/etc.).
        const meta = CURRENCIES.find((c) => c.code === item.currency);
        const decimals = meta?.decimals ?? 2;
        const major = item.price_cents / 100;
        setPriceInput(decimals === 0 ? String(Math.round(major)) : major.toFixed(2));
        setDescription(item.description || "");
        setAudience(item.audience as Audience);
        setCategory(item.category as Category);
        setSubcategory(item.subcategory || null);
        const sizesMap: Record<string, SizeOption> = {};
        for (const s of item.sizes) sizesMap[s.label] = s;
        setSizes(sizesMap);
        // Detect which size chart the existing labels belong to so the
        // right chips light up in edit mode (waist "34" → Waist chart).
        if (item.category !== "shoes") {
          const detected = detectChartKey(item.sizes.map((s) => s.label));
          if (detected) setSizeChartKey(detected);
        }
        // Normalize legacy single-photo colours into the photo-group shape.
        setPickedColors(
          (item.colors || []).map((c) => ({
            ...c,
            images:
              c.images && c.images.length > 0 ? c.images : c.image_b64 ? [c.image_b64] : [],
          })),
        );
        // Hydrate variant grid from existing item variants when the seller
        // is editing something they'd previously customised. If any single
        // variant has non-default state (custom qty, override, disabled),
        // auto-open the per-variant editor.
        if (item.variants && item.variants.length > 0) {
          const cells: Record<
            string,
            { quantity: number; disabled: boolean; price_cents_override?: number | null }
          > = {};
          for (const v of item.variants) {
            const key = `${v.size_label}::${v.color_name ?? ""}`;
            cells[key] = {
              quantity: v.quantity,
              disabled: !!v.disabled,
              price_cents_override: v.price_cents_override ?? null,
            };
          }
          setVariantCells(cells);
          const looksCustomised = item.variants.some(
            (v) => v.disabled || (v.price_cents_override ?? null) !== null,
          );
          if (looksCustomised && (item.colors?.length ?? 0) >= 2) {
            setManagePerVariant(true);
          }
        }
      } catch (e: any) {
        toast.show(e?.message ?? "Couldn't load item for editing", "error");
        router.replace("/(seller)");
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editId, toast]);

  // -----------------------------------------------------------------------
  // Live price preview — shown right under the price input.
  // -----------------------------------------------------------------------
  const livePriceCents = useMemo(
    () => parseAmountToCents(priceInput, currency),
    [priceInput, currency],
  );
  const livePricePreview = useMemo(
    () => (livePriceCents != null ? formatPrice(livePriceCents, currency) : null),
    [livePriceCents, currency],
  );

  // -----------------------------------------------------------------------
  // Per-step validation rules
  // -----------------------------------------------------------------------
  const step1Errors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (photos.length === 0) errs.image = "Add the FRONT photo of the piece";
    else if (photos.length < 2)
      errs.image = "Add the BACK photo too — AI try-on needs front + back to render both sides";
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

  // Category-aware size chart selection. `sizeChartKey` is the seller's
  // explicit override; null = use the default for the current taxonomy.
  const [sizeChartKey, setSizeChartKey] = useState<string | null>(null);
  const chartInfo = useMemo(
    () => chartsFor(category, subcategory, audience),
    [category, subcategory, audience],
  );
  const activeChart: SizeChart = useMemo(() => {
    if (sizeChartKey) {
      const hit =
        chartInfo.charts.find((c) => c.key === sizeChartKey) ??
        ALL_CHARTS.find((c) => c.key === sizeChartKey);
      if (hit) return hit;
    }
    return (
      chartInfo.charts.find((c) => c.key === chartInfo.defaultKey) ?? chartInfo.charts[0]
    );
  }, [chartInfo, sizeChartKey]);

  // Drop selected sizes whose labels don't exist in the given chart —
  // called whenever the seller switches size system / taxonomy so stale
  // labels ("34" after moving to XS–XXL) don't linger in state.
  const pruneSizesTo = (labels: string[]) => {
    const valid = new Set(labels);
    setSizes((curr) => {
      const bad = Object.keys(curr).filter((k) => !valid.has(k));
      if (bad.length === 0) return curr;
      const next = { ...curr };
      bad.forEach((k) => delete next[k]);
      return next;
    });
  };

  const changeSizeChart = (key: string) => {
    setSizeChartKey(key);
    const chart =
      chartInfo.charts.find((c) => c.key === key) ?? ALL_CHARTS.find((c) => c.key === key);
    if (chart) pruneSizesTo(chart.entries.map((e) => e.value));
  };

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
      // Measurements: at least ONE dimension (any of them) must be filled
      // per size — sellers aren't forced to measure everything, but buyers
      // need at least one number for fit-matching. Every value that IS
      // entered must be a positive number.
      if (dimKeys.length > 0) {
        let filled = 0;
        for (const k of dimKeys) {
          const raw = (s as Record<string, unknown>)[k];
          if (raw === undefined || raw === null || raw === "") continue;
          if (typeof raw !== "number" || raw <= 0 || isNaN(raw)) {
            errs[`${s.label}-${k}`] = "Must be > 0";
          } else {
            filled += 1;
          }
        }
        if (filled === 0) {
          errs[`${s.label}-_dims`] = "Fill at least one measurement";
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

  // Colour photo groups — each colour holds up to 5 photos (first one is
  // the hero buyers see when they tap the swatch). Photos can be freshly
  // picked or reused from the step-1 product photos so sellers never
  // upload the same shot twice.
  const assignPhotoToColor = (name: string, b64: string) => {
    setPickedColors((arr) =>
      arr.map((c) => {
        if (c.name !== name) return c;
        const imgs = c.images ?? [];
        if (imgs.length >= 5 || imgs.includes(b64)) return c;
        const next = [...imgs, b64];
        return { ...c, images: next, image_b64: next[0] };
      }),
    );
  };

  const addColorPhoto = async (name: string, source: "camera" | "library") => {
    const target = pickedColors.find((c) => c.name === name);
    if ((target?.images?.length ?? 0) >= 5) {
      toast.show("Up to 5 photos per colour", "error");
      return;
    }
    const res = source === "camera" ? await pickImageFromCamera() : await pickImageFromLibrary();
    if (!res) {
      toast.show("Permission denied or no image picked", "error");
      return;
    }
    assignPhotoToColor(name, res.base64);
  };

  const removeColorPhoto = (name: string, idx: number) => {
    setPickedColors((arr) =>
      arr.map((c) => {
        if (c.name !== name) return c;
        const next = (c.images ?? []).filter((_, i) => i !== idx);
        return { ...c, images: next, image_b64: next[0] ?? null };
      }),
    );
  };


  // Community category add — canonicalised server-side (near-duplicates
  // like "swim wear" resolve to the existing "swimwear" row) and shared
  // with every other seller immediately.
  const addCategory = async (label: string) => {
    try {
      const row = await api.createCategory({ label, audiences: [audience] });
      setCatalog((prev) => {
        const base = prev.length > 0 ? prev : FALLBACK_CATALOG;
        return base.some((c) => c.slug === row.slug)
          ? base.map((c) => (c.slug === row.slug ? row : c))
          : [...base, row];
      });
      setCategory(row.slug);
      setSubcategory(null);
      setSizes({});
      toast.show(`"${row.label}" added — now available to every seller`, "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't add category", "error");
    }
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

  // When the seller opts into per-variant stock — or picks new sizes /
  // colors while it's on — seed the grid with an even split of the
  // per-size quantity across the picked colors. Existing user-entered
  // cells are preserved.
  React.useEffect(() => {
    if (!managePerVariant) return;
    if (pickedColors.length < 2) return;
    const sizeList = Object.values(sizes);
    if (sizeList.length === 0) return;
    setVariantCells((prev) => {
      const next = { ...prev };
      for (const sz of sizeList) {
        const perColor = Math.floor((sz.available_qty || 0) / pickedColors.length);
        for (const col of pickedColors) {
          const key = `${sz.label}::${col.name}`;
          if (next[key] == null) {
            next[key] = {
              quantity: perColor,
              disabled: false,
              price_cents_override: null,
            };
          }
        }
      }
      return next;
    });
  }, [managePerVariant, pickedColors, sizes]);

  const submit = async () => {
    if (!step1Valid || !step2Valid || !step3Valid) {
      toast.show("Resolve form errors before publishing", "error");
      return;
    }
    const priceCents = parseAmountToCents(priceInput, currency);
    if (photos.length < 2 || !priceCents) return; // type guard

    setSaving(true);
    try {
      const [primary, ...extras] = photos;

      // Build the explicit variants payload when the seller opted into
      // per-variant management. Backend accepts a partial variants list;
      // any (size × color) combo missing here is auto-generated at the
      // default per-size quantity.
      const buildVariants = (): ItemVariant[] | undefined => {
        if (!managePerVariant) return undefined;
        if (pickedColors.length < 2) return undefined;
        const list: ItemVariant[] = [];
        for (const sz of Object.values(sizes)) {
          for (const col of pickedColors) {
            const key = `${sz.label}::${col.name}`;
            const cell = variantCells[key];
            if (!cell) continue; // fallback to auto-split
            list.push({
              id: "",
              size_label: sz.label,
              color_name: col.name,
              color_hex: col.hex,
              quantity: Math.max(0, Math.floor(cell.quantity || 0)),
              price_cents_override: cell.price_cents_override ?? null,
              disabled: !!cell.disabled,
            });
          }
        }
        return list;
      };

      const variantsPayload = buildVariants();

      if (isEditing && editId) {
        await api.patchItem(editId, {
          name: name.trim(),
          description: description.trim(),
          brand_name: brandName.trim() || null,
          category,
          subcategory: subcategory ?? null,
          price_cents: priceCents,
          currency,
          image_b64: primary,
          extra_images: extras,
          sizes: Object.values(sizes),
          colors: pickedColors,
          variants: variantsPayload,
          audience,
        });
        toast.show("Changes saved", "success");
      } else {
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
          variants: variantsPayload,
          audience,
        });
        toast.show("Item published", "success");
      }
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
  if (hydrating) {
    return (
      <SafeAreaView style={[styles.root, { alignItems: "center", justifyContent: "center" }]}>
        <Text style={[tp.bodyMuted, { marginTop: spacing.md }]}>
          Loading piece for editing…
        </Text>
      </SafeAreaView>
    );
  }

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
        <Text style={tp.caption}>
          {isEditing ? "EDIT PIECE" : "NEW PIECE"} · STEP {step} / 3
        </Text>
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
            livePricePreview={livePricePreview}
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
            categories={audienceCategories}
            onAddCategory={addCategory}
            onChangeAudience={(a) => {
              setAudience(a);
              // If the currently-selected category isn't valid for the new
              // audience (e.g. "dresses" was picked but the seller just
              // switched to "men"), snap to the first available category
              // and clear subcategory + sizes. This guarantees the seller
              // never lands on an option they can't actually save.
              const base = catalog.length > 0 ? catalog : FALLBACK_CATALOG;
              const allowed = base
                .filter((c) => (c.audiences ?? []).includes(a))
                .map((c) => c.slug);
              if (!allowed.includes(category)) {
                setCategory(allowed[0] ?? "shirts");
                setSubcategory(null);
                setSizeChartKey(null);
                setSizes({});
              } else if (category !== "shoes" && !sizeChartKey) {
                // Same category, new audience — the default chart may have
                // changed (pants men → women flips waist → UK sizes).
                const info = chartsFor(category, subcategory, a);
                const chart =
                  info.charts.find((c) => c.key === info.defaultKey) ?? info.charts[0];
                pruneSizesTo(chart.entries.map((e) => e.value));
              }
            }}
            onChangeCategory={(c) => {
              setCategory(c);
              setSubcategory(null);
              setSizeChartKey(null);
              // Reset measurement entries when the taxonomy changes — a value
              // entered for "chest" on a shirt doesn't carry over when the
              // seller switches to trousers (different dimension keys).
              setSizes({});
            }}
            onChangeSubcategory={(s) => {
              setSubcategory(s);
              // Subcategory can change the default size system (e.g. picking
              // "Bra & Lingerie" swaps to band+cup sizes). Prune stale labels
              // when the seller hasn't explicitly locked a chart.
              if (!sizeChartKey && category !== "shoes") {
                const info = chartsFor(category, s, audience);
                const chart =
                  info.charts.find((c) => c.key === info.defaultKey) ?? info.charts[0];
                pruneSizesTo(chart.entries.map((e) => e.value));
              }
            }}
          />
        )}

        {step === 3 && (
          <StepSizing
            audience={audience}
            category={category}
            garmentType={gtype}
            sizes={sizes}
            dimKeys={dimKeys}
            chart={activeChart}
            chartOptions={chartInfo.charts}
            onChangeChart={changeSizeChart}
            errors={matrixErrors}
            colors={pickedColors}
            unit={unit}
            onChangeUnit={setUnit}
            onToggleSize={toggleSize}
            onUpdateSize={updateSize}
            onToggleColor={toggleColor}
            onAddColorPhoto={addColorPhoto}
            onAssignPhotoToColor={assignPhotoToColor}
            onRemoveColorPhoto={removeColorPhoto}
            generalPhotos={photos}
            managePerVariant={managePerVariant}
            onToggleManagePerVariant={setManagePerVariant}
            variantCells={variantCells}
            onUpdateVariantCell={(key, patch) =>
              setVariantCells((prev) => {
                const existing = prev[key] ?? { quantity: 0, disabled: false };
                return { ...prev, [key]: { ...existing, ...patch } };
              })
            }
            currency={currency}
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
              label={isEditing ? "Save Changes" : "Publish"}
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
  livePricePreview: string | null;
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
  livePricePreview,
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
        Up to 5 product photos, title, brand, and price. The 1st photo must show
        the FRONT of the piece and the 2nd its BACK — the AI try-on uses them to
        render both sides correctly. If the piece comes in several colours
        you&apos;ll group photos per colour in step 3 — you can reuse these
        shots there, no re-uploading.
      </Text>

      <Text style={[tp.caption, styles.label]}>
        Photos{" "}
        <Text style={{ color: colors.mutedFg, textTransform: "none" }}>
          ({photos.length}/5 · 1st = front, 2nd = back)
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
                <Text style={styles.coverBadgeLabel}>FRONT · COVER</Text>
              </View>
            ) : i === 1 ? (
              <View style={styles.coverBadge}>
                <Text style={styles.coverBadgeLabel}>BACK</Text>
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
                {photos.length === 0
                  ? "Add front"
                  : photos.length === 1
                    ? "Add back"
                    : `Add ${photos.length === 4 ? "last" : "more"}`}
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
      {livePricePreview ? (
        <View style={styles.pricePreviewRow} testID="wizard-price-preview">
          <Feather name="eye" size={11} color={colors.primary} />
          <Text style={styles.pricePreviewLabel}>
            Buyers will see · {livePricePreview}
          </Text>
        </View>
      ) : null}
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
  categories: CategoryRow[];
  onChangeAudience: (a: Audience) => void;
  onChangeCategory: (c: Category) => void;
  onChangeSubcategory: (s: string | null) => void;
  onAddCategory: (label: string) => void;
}

function StepTaxonomy({
  audience,
  category,
  subcategory,
  categories,
  onChangeAudience,
  onChangeCategory,
  onChangeSubcategory,
  onAddCategory,
}: StepTaxonomyProps) {
  const subs = SUBCATEGORIES_BY_CATEGORY[category] ?? [];
  // Search-as-you-type over the shared category list (system + community).
  // If nothing matches, the seller can add their own — it becomes
  // available to every other seller (canonicalised server-side).
  const [catQuery, setCatQuery] = useState("");
  const nq = catQuery.trim().toLowerCase();
  const compactQuery = nq.replace(/[^a-z0-9]/g, "");
  const visibleCategories = nq
    ? categories.filter(
        (c) =>
          c.label.toLowerCase().includes(nq) ||
          (compactQuery.length > 0 && c.slug.includes(compactQuery)),
      )
    : categories;
  const exactExists = categories.some(
    (c) => c.slug === compactQuery || c.label.toLowerCase() === nq,
  );
  const canAdd = compactQuery.length >= 2 && !exactExists;
  const selectedLabel =
    categories.find((c) => c.slug === category)?.label ??
    CATEGORY_LABELS[category] ??
    category;

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
          ({categories.length} for {audience} · shared by all sellers)
        </Text>
      </Text>
      <View style={styles.catSearchRow}>
        <Feather name="search" size={14} color={colors.mutedFg} />
        <TextInput
          testID="wizard-cat-search"
          value={catQuery}
          onChangeText={setCatQuery}
          placeholder="Search or add a category (e.g. swimwear)"
          placeholderTextColor={colors.mutedFg}
          style={styles.catSearchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {catQuery.length > 0 ? (
          <TouchableOpacity
            testID="wizard-cat-search-clear"
            onPress={() => setCatQuery("")}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <Feather name="x" size={14} color={colors.mutedFg} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.catRow}>
        {visibleCategories.map((c) => (
          <TouchableOpacity
            key={c.slug}
            testID={`wizard-cat-${c.slug}`}
            onPress={() => onChangeCategory(c.slug)}
            style={[styles.cat, category === c.slug ? styles.catActive : styles.catInactive]}
          >
            <Text
              style={[
                styles.catLabel,
                category === c.slug ? styles.catLabelActive : styles.catLabelInactive,
              ]}
            >
              {c.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {visibleCategories.length === 0 && !canAdd ? (
        <Text style={[tp.bodyMuted, { marginTop: 4 }]}>No matching category yet.</Text>
      ) : null}
      {canAdd ? (
        <TouchableOpacity
          testID="wizard-cat-add"
          onPress={() => {
            onAddCategory(catQuery.trim());
            setCatQuery("");
          }}
          style={styles.customAddBtn}
        >
          <Feather name="plus" size={14} color={colors.primary} />
          <Text style={styles.customAddLabel}>Add “{catQuery.trim()}” as a new category</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={[tp.caption, styles.label]}>
        Subcategory{" "}
        <Text style={{ color: colors.mutedFg, textTransform: "none" }}>
          (helps shoppers find this {selectedLabel.toLowerCase()})
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
  // Backend garment_type — drives the "where to measure" diagram.
  garmentType: string;
  sizes: Record<string, SizeOption>;
  dimKeys: DimensionKey[];
  chart: SizeChart;
  chartOptions: SizeChart[];
  onChangeChart: (key: string) => void;
  errors: Record<string, string>;
  colors: ColorOption[];
  unit: "cm" | "in";
  onChangeUnit: (u: "cm" | "in") => void;
  onToggleSize: (label: string) => void;
  onUpdateSize: (label: string, patch: Partial<SizeOption>) => void;
  onToggleColor: (c: ColorOption) => void;
  onAddColorPhoto: (name: string, source: "camera" | "library") => void;
  onAssignPhotoToColor: (name: string, b64: string) => void;
  onRemoveColorPhoto: (name: string, idx: number) => void;
  // Step-1 product photos — offered for one-tap reuse in colour groups.
  generalPhotos: string[];
  // Opt-in variant grid state — provided by the parent so it survives step
  // navigation and gets included in the final payload.
  managePerVariant: boolean;
  onToggleManagePerVariant: (on: boolean) => void;
  variantCells: Record<
    string,
    { quantity: number; disabled: boolean; price_cents_override?: number | null }
  >;
  onUpdateVariantCell: (
    key: string,
    patch: Partial<{ quantity: number; disabled: boolean; price_cents_override: number | null }>,
  ) => void;
  currency: string;
}

function StepSizing({
  audience,
  category,
  garmentType,
  sizes,
  dimKeys,
  chart,
  chartOptions,
  onChangeChart,
  errors,
  colors: pickedColors,
  unit,
  onChangeUnit,
  onToggleSize,
  onUpdateSize,
  onToggleColor,
  onAddColorPhoto,
  onAssignPhotoToColor,
  onRemoveColorPhoto,
  generalPhotos,
  managePerVariant,
  onToggleManagePerVariant,
  variantCells,
  onUpdateVariantCell,
  currency,
}: StepSizingProps) {
  // Shoes have a fundamentally different size system (EU numbers + cm) and
  // keep their dedicated chart from shoe-sizes.ts. Everything else uses the
  // category-aware chart selected by the parent (waist inches for men's
  // bottoms, UK sizes for women's, bra band+cup, socks EU ranges, …).
  const isShoes = category === "shoes";
  // Which dimension field the seller is currently editing — drives the
  // highlighted arrow on the "where to measure" diagram below.
  const [activeDim, setActiveDim] = useState<DimensionKey | null>(null);
  const sizeLabels = isShoes
    ? (audience === "kids" ? KID_SHOE_SIZES : ADULT_SHOE_SIZES).map((s) => s.value)
    : chart.entries.map((e) => e.value);
  const sizeSubLabel = (label: string): string | null => {
    if (isShoes) {
      const shoeChart = audience === "kids" ? KID_SHOE_SIZES : ADULT_SHOE_SIZES;
      return shoeChart.find((s) => s.value === label)?.label.replace(/^EU \d+ · /, "") ?? null;
    }
    return chart.entries.find((e) => e.value === label)?.hint ?? null;
  };
  const noDims = dimKeys.length === 0;

  return (
    <View>
      <Text style={[tp.h2, styles.stepTitle]}>Sizing</Text>
      <Text style={[tp.bodyMuted, styles.stepHint]}>
        Pick sizes you stock, then fill the per-size measurements buyers will use
        for fit-matching.
      </Text>

      <View style={styles.unitRow} testID="wizard-unit-row">
        <Text style={[tp.caption, { marginRight: 8 }]}>Measure in</Text>
        {(["cm", "in"] as const).map((u) => {
          const active = u === unit;
          return (
            <TouchableOpacity
              key={u}
              testID={`wizard-unit-${u}`}
              onPress={() => onChangeUnit(u)}
              style={[
                styles.unitChip,
                active ? styles.unitChipActive : styles.unitChipInactive,
              ]}
            >
              <Text
                style={[
                  styles.unitChipLabel,
                  active ? styles.unitChipLabelActive : styles.unitChipLabelInactive,
                ]}
              >
                {u.toUpperCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {!isShoes && chartOptions.length > 1 ? (
        <>
          <Text style={[tp.caption, styles.label]}>
            Size system{" "}
            <Text style={{ color: colors.mutedFg, textTransform: "none" }}>
              (pick the one this piece uses)
            </Text>
          </Text>
          <View style={styles.catRow}>
            {chartOptions.map((c) => {
              const active = c.key === chart.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  testID={`wizard-chart-${c.key}`}
                  onPress={() => onChangeChart(c.key)}
                  style={[styles.cat, active ? styles.catActive : styles.catInactive]}
                >
                  <Text
                    style={[
                      styles.catLabel,
                      active ? styles.catLabelActive : styles.catLabelInactive,
                    ]}
                  >
                    {c.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ height: spacing.sm }} />
        </>
      ) : null}

      <Text style={[tp.caption, styles.label]}>
        Sizes & dimensions ({unit})
        {isShoes ? " · EU sizes" : ` · ${chart.label}`}
      </Text>
      <View style={styles.sizeRow}>
        {sizeLabels.map((s) => {
          const on = !!sizes[s];
          const sub = sizeSubLabel(s);
          return (
            <TouchableOpacity
              key={s}
              testID={`wizard-size-${s}`}
              onPress={() => onToggleSize(s)}
              style={[
                styles.sizeChip,
                isShoes && styles.sizeChipWide,
                on ? styles.sizeChipActive : styles.sizeChipInactive,
              ]}
            >
              <Text
                style={[
                  styles.sizeChipLabel,
                  on ? styles.sizeChipLabelActive : styles.sizeChipLabelInactive,
                ]}
              >
                {s}
              </Text>
              {sub ? (
                <Text
                  style={[
                    styles.sizeChipSub,
                    on ? styles.sizeChipLabelActive : styles.sizeChipLabelInactive,
                  ]}
                >
                  {sub}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
      {errors._sizes ? (
        <Text style={styles.fieldError}>{errors._sizes}</Text>
      ) : null}

      {!noDims ? (
        <GarmentMeasureGuide
          garmentType={garmentType}
          dimKeys={dimKeys}
          activeKey={activeDim}
        />
      ) : null}

      {Object.values(sizes).map((s) => (
        <View key={s.label} style={styles.sizeDetail} testID={`wizard-size-detail-${s.label}`}>
          <View style={styles.sizeDetailHeader}>
            <Text style={styles.sizeDetailLabel}>{s.label}</Text>
            {noDims ? (
              <Text style={styles.sizeDetailHint}>
                No body-fit measurements for this category
              </Text>
            ) : (
              <Text style={styles.sizeDetailHint}>
                Fill at least one measurement — any of them
              </Text>
            )}
          </View>
          <View style={styles.sizeDetailGrid}>
            {dimKeys.map((k) => (
              <DimField
                key={k}
                testID={`wizard-size-${s.label}-${k}`}
                label={DIMENSION_LABELS[k]}
                hint={DIMENSION_HINTS[k]}
                optional={false}
                value={(s as Record<string, unknown>)[k] as number | undefined}
                unit={unit}
                onChange={(v) =>
                  onUpdateSize(s.label, { [k]: v } as Partial<SizeOption>)
                }
                onFocus={() => setActiveDim(k)}
                onBlur={() => setActiveDim((c) => (c === k ? null : c))}
                errorText={errors[`${s.label}-${k}`]}
              />
            ))}
            <DimField
              testID={`wizard-size-${s.label}-qty`}
              label="Qty"
              value={s.available_qty}
              unit={null}
              onChange={(v) =>
                onUpdateSize(s.label, { available_qty: v ?? 0 })
              }
              errorText={errors[`${s.label}-available_qty`]}
            />
          </View>
          {errors[`${s.label}-_dims`] ? (
            <Text style={styles.fieldError}>{errors[`${s.label}-_dims`]}</Text>
          ) : null}
        </View>
      ))}

      <View style={{ height: spacing.lg }} />
      <Text style={[tp.caption, styles.label]}>Colors</Text>
      <Text style={styles.colorHint}>
        Tap a preset or add your own name & shade. Each colour then gets its
        own photo group below — add new shots or reuse your product photos
        with one tap, no re-uploading.
      </Text>
      <ColorEditor
        picked={pickedColors}
        presets={PRESET_COLORS}
        palette={EXTENDED_PALETTE}
        onAdd={onToggleColor}
        onRemove={onToggleColor}
        onAddPhoto={onAddColorPhoto}
        onAssignPhoto={onAssignPhotoToColor}
        onRemovePhoto={onRemoveColorPhoto}
        generalPhotos={generalPhotos}
      />
      {/* --------------------------------------------------------------- */}
      {/* Opt-in per-variant grid (size × color)                          */}
      {/* --------------------------------------------------------------- */}
      {pickedColors.length >= 2 && Object.keys(sizes).length >= 1 ? (
        <View style={styles.variantSection} testID="wizard-variant-section">
          <TouchableOpacity
            testID="wizard-variant-toggle"
            onPress={() => onToggleManagePerVariant(!managePerVariant)}
            style={styles.variantToggle}
            activeOpacity={0.85}
          >
            <View style={styles.variantToggleLeft}>
              <Text style={styles.variantToggleLabel}>Manage stock per color</Text>
              <Text style={styles.variantToggleHint}>
                {managePerVariant
                  ? "Set exact quantity for each size × color combo below."
                  : "Off: your size quantities split evenly across colors."}
              </Text>
            </View>
            <View
              style={[
                styles.variantSwitch,
                managePerVariant ? styles.variantSwitchOn : styles.variantSwitchOff,
              ]}
            >
              <View
                style={[
                  styles.variantSwitchThumb,
                  managePerVariant && styles.variantSwitchThumbOn,
                ]}
              />
            </View>
          </TouchableOpacity>

          {managePerVariant ? (
            <View style={styles.variantGrid} testID="wizard-variant-grid">
              {/* Header row: color names */}
              <View style={styles.variantGridRow}>
                <View style={[styles.variantGridCell, styles.variantGridHead]}>
                  <Text style={styles.variantGridHeadText}>SIZE ↓ / COLOR →</Text>
                </View>
                {pickedColors.map((c) => (
                  <View
                    key={c.name}
                    style={[styles.variantGridCell, styles.variantGridHead]}
                  >
                    <View style={styles.variantColorSwatchWrap}>
                      <View
                        style={[
                          styles.variantColorSwatch,
                          { backgroundColor: c.hex },
                        ]}
                      />
                      <Text
                        style={styles.variantGridHeadText}
                        numberOfLines={1}
                      >
                        {c.name.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
              {/* Data rows: one per size */}
              {Object.keys(sizes).map((sizeLabel) => (
                <View
                  key={sizeLabel}
                  style={styles.variantGridRow}
                  testID={`wizard-variant-row-${sizeLabel}`}
                >
                  <View style={[styles.variantGridCell, styles.variantGridRowHead]}>
                    <Text style={styles.variantGridRowLabel}>{sizeLabel}</Text>
                  </View>
                  {pickedColors.map((c) => {
                    const key = `${sizeLabel}::${c.name}`;
                    const cell = variantCells[key] ?? {
                      quantity: 0,
                      disabled: false,
                    };
                    return (
                      <View
                        key={c.name}
                        style={[
                          styles.variantGridCell,
                          cell.disabled && styles.variantGridCellDisabled,
                        ]}
                      >
                        <TextInput
                          testID={`wizard-variant-qty-${sizeLabel}-${c.name}`}
                          value={cell.quantity ? String(cell.quantity) : ""}
                          onChangeText={(t) => {
                            const n = parseInt(t.replace(/\D/g, ""), 10);
                            onUpdateVariantCell(key, {
                              quantity: Number.isFinite(n) ? n : 0,
                            });
                          }}
                          keyboardType="number-pad"
                          placeholder="0"
                          placeholderTextColor={colors.mutedFg}
                          editable={!cell.disabled}
                          style={styles.variantQtyInput}
                        />
                        <VariantPriceInput
                          testID={`wizard-variant-price-${sizeLabel}-${c.name}`}
                          currency={currency}
                          valueCents={cell.price_cents_override ?? null}
                          disabled={!!cell.disabled}
                          onChangeCents={(v) =>
                            onUpdateVariantCell(key, { price_cents_override: v })
                          }
                        />
                        <TouchableOpacity
                          onPress={() =>
                            onUpdateVariantCell(key, {
                              disabled: !cell.disabled,
                            })
                          }
                          testID={`wizard-variant-toggle-${sizeLabel}-${c.name}`}
                          style={styles.variantDisableBtn}
                        >
                          <Feather
                            name={cell.disabled ? "eye-off" : "eye"}
                            size={11}
                            color={
                              cell.disabled ? colors.mutedFg : colors.primary
                            }
                          />
                          <Text
                            style={[
                              styles.variantDisableLabel,
                              cell.disabled && { color: colors.mutedFg },
                            ]}
                          >
                            {cell.disabled ? "Off" : "On"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              ))}
              <Text style={styles.variantGridHint}>
                Top box = quantity, bottom box = optional price for that combo
                (blank uses the base price). Tap the eye icon to disable a
                combo (e.g. no Small in Red). The item goes out-of-stock
                automatically when all combos hit zero.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={{ height: spacing.xxl }} />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-variant price override input (variant grid cell)                       */
/* -------------------------------------------------------------------------- */

interface VariantPriceInputProps {
  currency: string;
  valueCents: number | null;
  disabled: boolean;
  onChangeCents: (v: number | null) => void;
  testID: string;
}

function VariantPriceInput({
  currency,
  valueCents,
  disabled,
  onChangeCents,
  testID,
}: VariantPriceInputProps) {
  // Local raw string so typing isn't mangled by cents round-trips.
  // Initialised from the cell state (edit-mode hydration) once.
  const meta = CURRENCIES.find((c) => c.code === currency);
  const decimals = meta?.decimals ?? 2;
  const [raw, setRaw] = useState(() => {
    if (valueCents == null) return "";
    const major = valueCents / 100;
    return decimals === 0 ? String(Math.round(major)) : String(major);
  });
  return (
    <TextInput
      testID={testID}
      value={raw}
      editable={!disabled}
      keyboardType="decimal-pad"
      placeholder={`${meta?.symbol ?? ""} base`}
      placeholderTextColor={colors.mutedFg}
      style={styles.variantPriceInput}
      onChangeText={(t) => {
        setRaw(t);
        if (!t.trim()) {
          onChangeCents(null);
          return;
        }
        const cents = parseAmountToCents(t, currency as CurrencyCode);
        onChangeCents(cents != null && cents > 0 ? cents : null);
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Colour photo group — per-colour mini gallery (Amazon-style)                */
/* -------------------------------------------------------------------------- */

interface ColorPhotoGroupProps {
  color: ColorOption;
  generalPhotos: string[];
  onAddPhoto: (name: string, source: "camera" | "library") => void;
  onAssignPhoto: (name: string, b64: string) => void;
  onRemovePhoto: (name: string, idx: number) => void;
}

function ColorPhotoGroup({
  color: c,
  generalPhotos,
  onAddPhoto,
  onAssignPhoto,
  onRemovePhoto,
}: ColorPhotoGroupProps) {
  const imgs = c.images ?? [];
  const canAdd = imgs.length < 5;
  // Product photos not already in this colour's group — offered for
  // one-tap reuse so the seller never uploads the same shot twice.
  const reusable = generalPhotos.filter((b64) => !imgs.includes(b64));
  return (
    <View style={styles.groupCard} testID={`wizard-color-group-${c.name}`}>
      <View style={styles.groupHead}>
        <View style={[styles.colorPhotoSwatch, { backgroundColor: c.hex }]} />
        <Text style={styles.groupName} numberOfLines={1}>
          {c.name}
        </Text>
        <Text style={styles.groupCount}>{imgs.length}/5</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.groupRow}
      >
        {imgs.map((b64, i) => (
          <View key={`${c.name}-img-${i}`} style={styles.groupThumbWrap}>
            <Image
              source={{ uri: dataUriFromBase64(b64) }}
              style={styles.groupThumb}
              resizeMode="cover"
            />
            {i === 0 ? (
              <View style={styles.groupHeroBadge}>
                <Text style={styles.groupHeroBadgeLabel}>FRONT</Text>
              </View>
            ) : i === 1 ? (
              <View style={styles.groupHeroBadge}>
                <Text style={styles.groupHeroBadgeLabel}>BACK</Text>
              </View>
            ) : null}
            <TouchableOpacity
              testID={`wizard-color-photo-remove-${c.name}-${i}`}
              onPress={() => onRemovePhoto(c.name, i)}
              style={styles.groupThumbRemove}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              accessibilityLabel={`Remove ${c.name} photo ${i + 1}`}
            >
              <Feather name="x" size={12} color={colors.primaryFg} />
            </TouchableOpacity>
          </View>
        ))}
        {canAdd ? (
          <TouchableOpacity
            testID={`wizard-color-photo-add-${c.name}`}
            onPress={() => onAddPhoto(c.name, "library")}
            style={styles.groupAddTile}
            accessibilityLabel={`Add ${c.name} photo from library`}
          >
            <Feather name="image" size={16} color={colors.mutedFg} />
            <Text style={styles.colorPhotoAddLabel}>ADD</Text>
          </TouchableOpacity>
        ) : null}
        {canAdd ? (
          <TouchableOpacity
            testID={`wizard-color-photo-camera-${c.name}`}
            onPress={() => onAddPhoto(c.name, "camera")}
            style={styles.groupAddTile}
            accessibilityLabel={`Take ${c.name} photo with camera`}
          >
            <Feather name="camera" size={16} color={colors.mutedFg} />
            <Text style={styles.colorPhotoAddLabel}>CAMERA</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {canAdd && reusable.length > 0 ? (
        <>
          <Text style={styles.groupReuseCaption}>Reuse a product photo — tap to add:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.groupRow}
          >
            {reusable.map((b64, i) => (
              <TouchableOpacity
                key={`${c.name}-reuse-${i}`}
                testID={`wizard-color-photo-reuse-${c.name}-${i}`}
                onPress={() => onAssignPhoto(c.name, b64)}
                style={styles.groupReuseThumbWrap}
              >
                <Image
                  source={{ uri: dataUriFromBase64(b64) }}
                  style={styles.groupReuseThumb}
                  resizeMode="cover"
                />
                <View style={styles.groupReusePlus}>
                  <Feather name="plus" size={10} color={colors.primaryFg} />
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      ) : null}

      {imgs.length === 0 ? (
        <Text style={styles.groupEmptyHint}>
          No photos yet — buyers will see your main product photos for this colour.
        </Text>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Color editor — free-form list of named color variants                      */
/* -------------------------------------------------------------------------- */

interface ColorEditorProps {
  picked: ColorOption[];
  presets: ColorOption[];
  palette: string[];
  onAdd: (c: ColorOption) => void;
  onRemove: (c: ColorOption) => void;
  onAddPhoto: (name: string, source: "camera" | "library") => void;
  onAssignPhoto: (name: string, b64: string) => void;
  onRemovePhoto: (name: string, idx: number) => void;
  generalPhotos: string[];
}

function ColorEditor({
  picked,
  presets,
  palette,
  onAdd,
  onRemove,
  onAddPhoto,
  onAssignPhoto,
  onRemovePhoto,
  generalPhotos,
}: ColorEditorProps) {
  const [drafting, setDrafting] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftHex, setDraftHex] = useState(palette[0]);
  const [nameError, setNameError] = useState<string | null>(null);

  const isDuplicate = (name: string) => {
    const norm = name.trim().toLowerCase();
    return picked.some((p) => p.name.trim().toLowerCase() === norm);
  };

  const commit = () => {
    const name = draftName.trim();
    if (!name) {
      setNameError("Give this color a name");
      return;
    }
    if (isDuplicate(name)) {
      setNameError("You've already added that color");
      return;
    }
    // Hex must be 3 or 6 hex digits with an optional leading #.
    const hex = draftHex.startsWith("#") ? draftHex : `#${draftHex}`;
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) {
      setNameError("Hex should look like #C8A77B");
      return;
    }
    onAdd({ name, hex });
    setDraftName("");
    setDraftHex(palette[0]);
    setNameError(null);
    // Keep the drafter open so the seller can add another without an
    // extra tap — matches the user's "add another" request.
  };

  const cancel = () => {
    setDrafting(false);
    setDraftName("");
    setDraftHex(palette[0]);
    setNameError(null);
  };

  return (
    <View>
      {/* Selected color chips */}
      {picked.length > 0 ? (
        <View style={styles.colorChipsRow} testID="wizard-color-chips">
          {picked.map((c) => (
            <View key={c.name} style={styles.colorChip}>
              <View style={[styles.colorChipSwatch, { backgroundColor: c.hex }]} />
              <Text style={styles.colorChipLabel} numberOfLines={1}>
                {c.name}
              </Text>
              <TouchableOpacity
                testID={`wizard-color-remove-${c.name}`}
                onPress={() => onRemove(c)}
                style={styles.colorChipRemove}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                <Feather name="x" size={12} color={colors.primaryFg} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      {/* Photo groups — Amazon-style: photos are grouped per colour (all
          sizes share them). Sellers add fresh shots or reuse the step-1
          product photos with one tap — never re-uploading the same image. */}
      {picked.length > 0 ? (
        <>
          <Text style={styles.colorSectionCaption}>PHOTOS BY COLOUR</Text>
          {picked.map((c) => (
            <ColorPhotoGroup
              key={`group-${c.name}`}
              color={c}
              generalPhotos={generalPhotos}
              onAddPhoto={onAddPhoto}
              onAssignPhoto={onAssignPhoto}
              onRemovePhoto={onRemovePhoto}
            />
          ))}
          <Text style={styles.colorPhotoHint}>
            Buyers tap a colour to see its photos. Sizes share the same
            photos, so there&apos;s nothing to upload per size. A colour without
            photos falls back to your main product photos.
          </Text>
        </>
      ) : null}

      {/* Quick-pick presets — 1-tap add when not already picked */}
      <Text style={styles.colorSectionCaption}>QUICK PICK</Text>
      <View style={styles.colorRow}>
        {presets.map((c) => {
          const on = !!picked.find((x) => x.name === c.name);
          return (
            <TouchableOpacity
              key={c.name}
              testID={`wizard-color-${c.name}`}
              onPress={() => (on ? onRemove(c) : onAdd(c))}
              style={[
                styles.colorSwatch,
                { backgroundColor: c.hex },
                on && styles.colorSwatchActive,
              ]}
              accessibilityLabel={`${c.name} preset${on ? " selected" : ""}`}
            >
              {on ? (
                <Feather
                  name="check"
                  size={14}
                  color={c.hex === "#FFFFFF" ? colors.primary : colors.primaryFg}
                />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Custom color drafter */}
      {!drafting ? (
        <TouchableOpacity
          testID="wizard-color-add-custom-btn"
          onPress={() => setDrafting(true)}
          style={styles.customAddBtn}
        >
          <Feather name="plus" size={14} color={colors.primary} />
          <Text style={styles.customAddLabel}>Add another color</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.customPanel} testID="wizard-color-custom-panel">
          <Text style={styles.colorSectionCaption}>ADD CUSTOM COLOR</Text>
          <View style={styles.customRow}>
            <View style={[styles.customPreview, { backgroundColor: draftHex }]} />
            <TextInput
              testID="wizard-color-custom-name"
              placeholder="e.g. Terracotta"
              placeholderTextColor={colors.mutedFg}
              style={styles.customNameInput}
              value={draftName}
              onChangeText={(t) => {
                setDraftName(t);
                if (nameError) setNameError(null);
              }}
              returnKeyType="done"
              onSubmitEditing={commit}
              autoCapitalize="words"
            />
          </View>
          <Text style={styles.customLabel}>Shade — tap a swatch or type hex</Text>
          <View style={styles.paletteRow}>
            {palette.map((hex) => (
              <TouchableOpacity
                key={hex}
                testID={`wizard-color-palette-${hex}`}
                onPress={() => setDraftHex(hex)}
                style={[
                  styles.paletteSwatch,
                  { backgroundColor: hex },
                  hex === draftHex && styles.paletteSwatchActive,
                ]}
                accessibilityLabel={`Shade ${hex}${hex === draftHex ? " selected" : ""}`}
              />
            ))}
          </View>
          <TextInput
            testID="wizard-color-custom-hex"
            placeholder="#C8A77B"
            placeholderTextColor={colors.mutedFg}
            style={styles.customHexInput}
            value={draftHex}
            onChangeText={(t) => {
              setDraftHex(t);
              if (nameError) setNameError(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
          />
          {nameError ? (
            <Text style={styles.customError} testID="wizard-color-custom-error">
              {nameError}
            </Text>
          ) : null}
          <View style={styles.customActions}>
            <TouchableOpacity
              testID="wizard-color-custom-cancel"
              onPress={cancel}
              style={[styles.customBtn, styles.customBtnGhost]}
            >
              <Text style={styles.customBtnLabelGhost}>Done</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="wizard-color-custom-commit"
              onPress={commit}
              style={[styles.customBtn, styles.customBtnPrimary]}
            >
              <Feather name="plus" size={14} color={colors.primaryFg} />
              <Text style={styles.customBtnLabel}>Add color</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}


      <View style={{ height: spacing.xxl }} />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Dimension input field                                                      */
/* -------------------------------------------------------------------------- */

interface DimFieldProps {
  label: string;
  hint?: string;
  optional?: boolean;
  value?: number | null;
  // Display unit for length measurements; null means "no unit" (used for
  // the available_qty field, which is always integer count, not length).
  unit: "cm" | "in" | null;
  onChange: (v: number | undefined) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  testID: string;
  errorText?: string | null;
}

const CM_PER_IN = 2.54;

function DimField({
  label,
  hint,
  optional,
  value,
  unit,
  onChange,
  onFocus,
  onBlur,
  testID,
  errorText,
}: DimFieldProps) {
  // We always STORE in cm on the backend. When the user is in inch mode,
  // we convert the stored cm value to inches for display and convert
  // their inch input back to cm before bubbling up. Keeps the wire
  // format stable regardless of seller unit preference.
  const displayValue = React.useMemo(() => {
    if (value == null) return "";
    if (unit === "in") return String(Math.round((value / CM_PER_IN) * 10) / 10);
    return String(value);
  }, [value, unit]);

  const [raw, setRaw] = useState(displayValue);

  // Sync external resets (e.g. when switching category clears sizes, or
  // when the seller flips cm↔in we need to repaint the field).
  React.useEffect(() => {
    setRaw(displayValue);
  }, [displayValue]);

  const handleChange = (t: string) => {
    setRaw(t);
    const n = parsePositive(t);
    if (n === undefined) {
      onChange(undefined);
      return;
    }
    if (isNaN(n)) {
      onChange(undefined);
      return;
    }
    // Convert back to cm before bubbling up when the seller types in
    // inches. Length-less fields (qty) skip the conversion.
    const stored = unit === "in" ? n * CM_PER_IN : n;
    onChange(stored);
  };

  return (
    <View style={dimStyles.wrap}>
      <Text style={dimStyles.label}>
        {label}
        {unit ? ` (${unit})` : ""}
        {optional ? <Text style={dimStyles.optionalTag}> · optional</Text> : null}
      </Text>
      {hint ? <Text style={dimStyles.hint}>{hint}</Text> : null}
      <TextInput
        testID={testID}
        keyboardType="decimal-pad"
        value={raw}
        onChangeText={handleChange}
        onFocus={onFocus}
        onBlur={onBlur}
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
  optionalTag: {
    fontFamily: fonts.body,
    fontSize: 9,
    color: colors.mutedFg,
    textTransform: "lowercase",
    letterSpacing: 0.5,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.mutedFg,
    marginBottom: 2,
    fontStyle: "italic",
    lineHeight: 13,
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
  catSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  catSearchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.primary,
    paddingVertical: 10,
  },
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
  sizeChipWide: { width: 72, height: 56, paddingHorizontal: 4 },
  sizeChipInactive: { borderColor: colors.border, backgroundColor: colors.surface },
  sizeChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  sizeChipLabel: { fontFamily: fonts.bodySemi, fontSize: 13 },
  sizeChipSub: {
    fontFamily: fonts.body,
    fontSize: 9,
    marginTop: 2,
    letterSpacing: 0.5,
    textAlign: "center",
  },
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
  colorSwatch: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  colorSwatchActive: { borderColor: colors.primary, borderWidth: 2 },
  colorHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedFg,
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 17,
  },
  colorSectionCaption: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    color: colors.mutedFg,
    letterSpacing: 1.4,
    marginTop: 12,
    marginBottom: 8,
  },
  colorChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  colorChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 6,
    paddingRight: 4,
    paddingVertical: 4,
    backgroundColor: colors.primary,
    borderRadius: 999,
  },
  colorChipSwatch: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  colorChipLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.primaryFg,
    maxWidth: 100,
  },
  colorChipRemove: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  groupCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 10,
    marginBottom: 10,
  },
  groupHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  groupName: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
  },
  groupCount: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.mutedFg,
  },
  groupRow: { gap: 8, paddingRight: 8 },
  groupThumbWrap: {
    width: 72,
    height: 96,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  groupThumb: { width: "100%", height: "100%" },
  groupThumbRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  groupHeroBadge: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 2,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  groupHeroBadgeLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 8,
    letterSpacing: 1.5,
    color: colors.primaryFg,
  },
  groupAddTile: {
    width: 72,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  groupReuseCaption: {
    marginTop: 8,
    marginBottom: 6,
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.mutedFg,
  },
  groupReuseThumbWrap: {
    width: 48,
    height: 64,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  groupReuseThumb: { width: "100%", height: "100%" },
  groupReusePlus: {
    position: "absolute",
    bottom: 3,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  groupEmptyHint: {
    marginTop: 6,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
  },
  colorPhotoAddLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 9,
    letterSpacing: 1.5,
    color: colors.mutedFg,
  },
  colorPhotoSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  colorPhotoHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    lineHeight: 15,
    marginBottom: 10,
  },
  customAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  customAddLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.primary,
  },
  customPanel: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  customPreview: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customNameInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.primary,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  customLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    marginTop: 6,
  },
  paletteRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  paletteSwatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
  },
  paletteSwatchActive: {
    borderWidth: 3,
    borderColor: colors.primary,
  },
  customHexInput: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  customError: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.error,
    marginTop: 4,
  },
  customActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 8,
  },
  customBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  customBtnGhost: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  customBtnPrimary: {
    backgroundColor: colors.primary,
  },
  customBtnLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.primaryFg,
    letterSpacing: 0.5,
  },
  customBtnLabelGhost: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.primary,
    letterSpacing: 0.5,
  },
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
  // Live price preview row under the price input.
  pricePreviewRow: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  pricePreviewLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 0.6,
    color: colors.primary,
  },
  // cm / in toggle on the Sizing step.
  unitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: spacing.md,
  },
  unitChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    minWidth: 44,
    alignItems: "center",
  },
  unitChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  unitChipInactive: { borderColor: colors.border, backgroundColor: colors.surface },
  unitChipLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 11,
    letterSpacing: 1.5,
  },
  unitChipLabelActive: { color: colors.primaryFg },
  unitChipLabelInactive: { color: colors.primary },
  variantSection: {
    marginTop: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  variantToggle: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  variantToggleLeft: { flex: 1, marginRight: spacing.md },
  variantToggleLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.primary,
  },
  variantToggleHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    marginTop: 3,
    lineHeight: 15,
  },
  variantSwitch: {
    width: 44,
    height: 26,
    borderRadius: 14,
    paddingHorizontal: 2,
    justifyContent: "center",
  },
  variantSwitchOff: { backgroundColor: colors.border },
  variantSwitchOn: { backgroundColor: colors.primary },
  variantSwitchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.background,
  },
  variantSwitchThumbOn: { alignSelf: "flex-end" },
  variantGrid: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  variantGridRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  variantGridCell: {
    flex: 1,
    minWidth: 76,
    padding: 8,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  variantGridHead: {
    backgroundColor: colors.surface,
    minHeight: 48,
  },
  variantGridHeadText: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.mutedFg,
    textAlign: "center",
  },
  variantGridRowHead: {
    backgroundColor: colors.surface,
    minHeight: 62,
  },
  variantGridRowLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.primary,
  },
  variantGridCellDisabled: {
    backgroundColor: "rgba(0,0,0,0.04)",
  },
  variantColorSwatchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  variantColorSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.15)",
  },
  variantQtyInput: {
    width: "100%",
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.primary,
    textAlign: "center",
    borderRadius: 4,
    marginBottom: 4,
  },
  variantPriceInput: {
    width: "100%",
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 3,
    paddingHorizontal: 6,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.primary,
    textAlign: "center",
    borderRadius: 4,
    marginBottom: 4,
  },
  variantDisableBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  variantDisableLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    letterSpacing: 1,
    color: colors.primary,
  },
  variantGridHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedFg,
    padding: spacing.sm,
    lineHeight: 15,
  },

});

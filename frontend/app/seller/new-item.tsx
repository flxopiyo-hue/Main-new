import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton } from "@/src/components/AppButton";
import { AppInput } from "@/src/components/AppInput";
import { useToast } from "@/src/components/Toast";
import { api, ColorOption, SizeOption } from "@/src/lib/api";
import { dataUriFromBase64, pickImageFromCamera, pickImageFromLibrary } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

const CATEGORIES = ["shirts", "dresses", "pants", "outerwear", "shoes", "accessories"] as const;
const SIZE_LABELS = ["XS", "S", "M", "L", "XL", "XXL"];
const PRESET_COLORS: ColorOption[] = [
  { name: "Black", hex: "#0A0A0A" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Camel", hex: "#C8A77B" },
  { name: "Olive", hex: "#5C6F44" },
  { name: "Navy", hex: "#1B2A4E" },
  { name: "Rose", hex: "#D4859A" },
];

const parseNum = (s: string): number | undefined => {
  if (!s.trim()) return undefined;
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? undefined : n;
};

export default function NewItem() {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("shirts");
  const [priceUsd, setPriceUsd] = useState("");
  const [image, setImage] = useState<{ base64: string } | null>(null);
  const [sizes, setSizes] = useState<Record<string, SizeOption>>({});
  const [pickedColors, setPickedColors] = useState<ColorOption[]>([]);
  const [saving, setSaving] = useState(false);

  const pickImage = async (source: "camera" | "library") => {
    const res = source === "camera" ? await pickImageFromCamera() : await pickImageFromLibrary();
    if (!res) {
      toast.show("Permission denied or no image picked", "error");
      return;
    }
    setImage({ base64: res.base64 });
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

  const submit = async () => {
    if (!image) return toast.show("Please add a product image", "error");
    if (!name.trim()) return toast.show("Please add a name", "error");
    if (!priceUsd) return toast.show("Please set a price", "error");
    const sizesArr = Object.values(sizes);
    if (sizesArr.length === 0) return toast.show("Add at least one size", "error");

    const priceCents = Math.round(parseFloat(priceUsd.replace(",", ".")) * 100);
    if (!priceCents || priceCents <= 0)
      return toast.show("Price must be a positive number", "error");

    setSaving(true);
    try {
      await api.createItem({
        name: name.trim(),
        description: description.trim(),
        category,
        price_cents: priceCents,
        image_b64: image.base64,
        sizes: sizesArr,
        colors: pickedColors,
      });
      toast.show("Item published", "success");
      router.replace("/(tabs)/atelier");
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to publish", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="new-item-back-btn"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={tp.caption}>NEW PIECE</Text>
        <View style={styles.iconBtn} />
      </View>
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        bottomOffset={120}
      >
        <Text style={[tp.h2, styles.title]}>Add a new piece</Text>

        <Text style={[tp.caption, styles.label]}>Photo</Text>
        {image ? (
          <Image
            source={{ uri: dataUriFromBase64(image.base64) }}
            style={styles.itemImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.itemImageEmpty}>
            <Feather name="image" size={28} color={colors.mutedFg} />
            <Text style={styles.itemImageEmptyLabel}>Garment photo</Text>
          </View>
        )}
        <View style={styles.imageActions}>
          <TouchableOpacity
            testID="new-item-camera-btn"
            onPress={() => pickImage("camera")}
            style={styles.imageActionBtn}
          >
            <Feather name="camera" size={14} color={colors.primary} />
            <Text style={styles.imageActionLabel}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="new-item-library-btn"
            onPress={() => pickImage("library")}
            style={styles.imageActionBtn}
          >
            <Feather name="image" size={14} color={colors.primary} />
            <Text style={styles.imageActionLabel}>Library</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: spacing.lg }} />
        <AppInput
          testID="new-item-name-input"
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Cropped Linen Shirt"
        />
        <AppInput
          testID="new-item-desc-input"
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Fabric, fit, inspiration"
          multiline
        />
        <AppInput
          testID="new-item-price-input"
          label="Price (USD)"
          value={priceUsd}
          onChangeText={setPriceUsd}
          keyboardType="decimal-pad"
          placeholder="129"
        />

        <Text style={[tp.caption, styles.label]}>Category</Text>
        <View style={styles.catRow}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c}
              testID={`new-item-cat-${c}`}
              onPress={() => setCategory(c)}
              style={[styles.cat, category === c ? styles.catActive : styles.catInactive]}
            >
              <Text
                style={[
                  styles.catLabel,
                  category === c ? styles.catLabelActive : styles.catLabelInactive,
                ]}
              >
                {c}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[tp.caption, styles.label]}>Sizes & Dimensions (cm)</Text>
        <View style={styles.sizeRow}>
          {SIZE_LABELS.map((s) => {
            const on = !!sizes[s];
            return (
              <TouchableOpacity
                key={s}
                testID={`new-item-size-${s}`}
                onPress={() => toggleSize(s)}
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
        {Object.values(sizes).map((s) => (
          <View key={s.label} style={styles.sizeDetail}>
            <Text style={styles.sizeDetailLabel}>{s.label}</Text>
            <View style={styles.sizeDetailGrid}>
              <DimField
                testID={`new-item-size-${s.label}-chest`}
                label="Chest"
                value={s.chest_cm}
                onChange={(v) => updateSize(s.label, { chest_cm: v })}
              />
              <DimField
                testID={`new-item-size-${s.label}-waist`}
                label="Waist"
                value={s.waist_cm}
                onChange={(v) => updateSize(s.label, { waist_cm: v })}
              />
              <DimField
                testID={`new-item-size-${s.label}-hips`}
                label="Hips"
                value={s.hips_cm}
                onChange={(v) => updateSize(s.label, { hips_cm: v })}
              />
              <DimField
                testID={`new-item-size-${s.label}-qty`}
                label="Qty"
                value={s.available_qty}
                onChange={(v) => updateSize(s.label, { available_qty: v ?? 0 })}
              />
            </View>
          </View>
        ))}

        <Text style={[tp.caption, styles.label]}>Colors</Text>
        <View style={styles.colorRow}>
          {PRESET_COLORS.map((c) => {
            const on = !!pickedColors.find((x) => x.name === c.name);
            return (
              <TouchableOpacity
                key={c.name}
                testID={`new-item-color-${c.name}`}
                onPress={() => toggleColor(c)}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: c.hex },
                  on && styles.colorSwatchActive,
                ]}
              />
            );
          })}
        </View>
        <View style={{ height: 80 }} />
      </KeyboardAwareScrollView>
      <View style={styles.footer}>
        <AppButton
          testID="new-item-submit-btn"
          label="Publish"
          onPress={submit}
          loading={saving}
        />
      </View>
    </SafeAreaView>
  );
}

interface DimFieldProps {
  label: string;
  value?: number | null;
  onChange: (v: number | undefined) => void;
  testID: string;
}

function DimField({ label, value, onChange, testID }: DimFieldProps) {
  return (
    <View style={dimStyles.wrap}>
      <Text style={dimStyles.label}>{label}</Text>
      <TextInput
        testID={testID}
        keyboardType="decimal-pad"
        value={value != null ? String(value) : ""}
        onChangeText={(t) => onChange(parseNum(t))}
        placeholder="—"
        placeholderTextColor={colors.mutedFg}
        style={dimStyles.input}
      />
    </View>
  );
}

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
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  title: { marginBottom: spacing.lg },
  label: { marginTop: spacing.md, marginBottom: spacing.sm },
  itemImage: { width: "100%", aspectRatio: 3 / 4, backgroundColor: colors.muted },
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
  sizeDetail: { marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  sizeDetailLabel: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  sizeDetailGrid: { flexDirection: "row", gap: spacing.md },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  colorSwatch: { width: 40, height: 40, borderWidth: 1, borderColor: colors.border },
  colorSwatchActive: { borderColor: colors.primary, borderWidth: 2 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});

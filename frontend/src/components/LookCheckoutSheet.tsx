// Shop-the-look checkout sheet — one Paystack payment for a whole
// AI-Stylist outfit. Shows every piece with its size pre-picked (the
// stylist's best-fit/preferred size), lets the buyer adjust, pick a
// delivery address, and see ONE combined delivery fee (computed per
// seller parcel behind the scenes, waived per parcel above the
// free-delivery threshold).

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { Address, api, BACKEND_URL, StylistOutfit } from "@/src/lib/api";
import { formatPrice } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface Props {
  visible: boolean;
  outfit: StylistOutfit | null;
  onClose: () => void;
}

export function LookCheckoutSheet({ visible, outfit, onClose }: Props) {
  const toast = useToast();
  const items = useMemo(() => outfit?.items ?? [], [outfit]);

  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addrId, setAddrId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [parcels, setParcels] = useState(1);
  const [paying, setPaying] = useState(false);

  const itemsTotal = items.reduce((sum, it) => sum + it.price_cents, 0);
  const currency = items[0]?.currency ?? "KES";
  const allKes = items.every((it) => (it.currency || "KES").toUpperCase() === "KES");

  // Reset per outfit: pre-pick each piece's suggested size + load addresses.
  useEffect(() => {
    if (!visible || !outfit) return;
    const init: Record<string, string> = {};
    outfit.items.forEach((it) => {
      init[it.id] = it.suggested_size || it.sizes_in_stock?.[0] || "";
    });
    setSizes(init);
    setLoading(true);
    api
      .listAddresses()
      .then((list) => {
        setAddresses(list);
        const def = list.find((a) => a.is_default) ?? list[0];
        setAddrId(def?.id ?? null);
      })
      .catch(() => setAddresses([]))
      .finally(() => setLoading(false));
  }, [visible, outfit]);

  // One delivery line = sum of per-seller-parcel quotes for the chosen
  // address (mirrors the backend's charge exactly).
  useEffect(() => {
    if (!visible || !addrId || items.length === 0 || !allKes) {
      setDeliveryFee(null);
      return;
    }
    const groups = new Map<string, number>();
    items.forEach((it) => {
      groups.set(it.seller_id, (groups.get(it.seller_id) ?? 0) + it.price_cents);
    });
    setParcels(groups.size);
    let cancelled = false;
    Promise.all(
      [...groups.values()].map((total) =>
        api.deliveryQuote({ address_id: addrId, item_total_cents: total }),
      ),
    )
      .then((quotes) => {
        if (cancelled) return;
        setDeliveryFee(
          quotes.reduce((sum, q) => sum + (q.supported ? q.fee_due_cents : 0), 0),
        );
      })
      .catch(() => !cancelled && setDeliveryFee(null));
    return () => {
      cancelled = true;
    };
  }, [visible, addrId, items, allKes]);

  const pay = async () => {
    if (!addrId || paying) return;
    setPaying(true);
    try {
      const res = await api.checkoutLook({
        lines: items.map((it) => ({ item_id: it.id, size: sizes[it.id] })),
        address_id: addrId,
        origin_url: BACKEND_URL,
      });
      await WebBrowser.openBrowserAsync(res.url);
      onClose();
      router.push("/(tabs)/profile");
    } catch (e: any) {
      toast.show(e?.message ?? "Checkout failed", "error");
    } finally {
      setPaying(false);
    }
  };

  const total = itemsTotal + (deliveryFee ?? 0);
  const sizesReady = items.every((it) => !!sizes[it.id]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} testID="look-checkout-modal">
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={["bottom"]} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={tp.caption}>SHOP THE LOOK</Text>
              <Text style={styles.title}>{outfit?.title ?? "Your look"}</Text>
            </View>
            <TouchableOpacity testID="look-close-btn" onPress={onClose} style={styles.closeBtn}>
              <Feather name="x" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {/* Pieces + size pick */}
            {items.map((it) => (
              <View key={it.id} style={styles.pieceRow} testID={`look-piece-${it.id}`}>
                <Image source={{ uri: dataUriFromBase64(it.image_b64) }} style={styles.thumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pieceName} numberOfLines={1}>{it.name}</Text>
                  <Text style={styles.piecePrice}>{formatPrice(it.price_cents, it.currency)}</Text>
                  <View style={styles.sizeRow}>
                    {(it.sizes_in_stock ?? []).map((s) => (
                      <TouchableOpacity
                        key={s}
                        testID={`look-size-${it.id}-${s}`}
                        onPress={() => setSizes((m) => ({ ...m, [it.id]: s }))}
                        style={[styles.sizeChip, sizes[it.id] === s && styles.sizeChipActive]}
                      >
                        <Text
                          style={[styles.sizeChipLabel, sizes[it.id] === s && styles.sizeChipLabelActive]}
                        >
                          {s}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {it.suggested_size ? (
                    <Text style={styles.sizeHint}>Best fit for you: {it.suggested_size}</Text>
                  ) : null}
                </View>
              </View>
            ))}

            {/* Address */}
            <Text style={[tp.caption, styles.sectionCaption]}>DELIVER TO</Text>
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
            ) : addresses.length === 0 ? (
              <TouchableOpacity
                testID="look-add-address-btn"
                style={styles.addAddrBtn}
                onPress={() => {
                  onClose();
                  router.push("/addresses/new");
                }}
              >
                <Feather name="plus" size={14} color={colors.primary} />
                <Text style={styles.addAddrLabel}>Add a delivery address</Text>
              </TouchableOpacity>
            ) : (
              addresses.map((a) => (
                <TouchableOpacity
                  key={a.id}
                  testID={`look-addr-${a.id}`}
                  style={[styles.addrRow, addrId === a.id && styles.addrRowActive]}
                  onPress={() => setAddrId(a.id)}
                >
                  <View style={styles.radioOuter}>
                    {addrId === a.id ? <View style={styles.radioInner} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.addrName} numberOfLines={1}>
                      {a.recipient_name} · {a.area || a.city}
                    </Text>
                    <Text style={styles.addrSub} numberOfLines={1}>
                      {[a.street, a.city, a.country].filter(Boolean).join(", ")}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))
            )}

            {/* Totals */}
            <View style={styles.totals} testID="look-totals">
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{items.length} pieces</Text>
                <Text style={styles.totalValue}>{formatPrice(itemsTotal, currency)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>
                  Delivery{parcels > 1 ? ` (${parcels} parcels, one charge)` : ""}
                </Text>
                <Text style={styles.totalValue}>
                  {!allKes
                    ? "—"
                    : deliveryFee == null
                      ? "…"
                      : deliveryFee === 0
                        ? "FREE"
                        : formatPrice(deliveryFee, "KES")}
                </Text>
              </View>
              <View style={[styles.totalRow, styles.totalRowGrand]}>
                <Text style={styles.grandLabel}>Total</Text>
                <Text style={styles.grandValue}>{formatPrice(total, currency)}</Text>
              </View>
            </View>
          </ScrollView>

          <TouchableOpacity
            testID="look-pay-btn"
            style={[styles.payBtn, (!addrId || !sizesReady || paying) && { opacity: 0.4 }]}
            onPress={pay}
            disabled={!addrId || !sizesReady || paying}
          >
            {paying ? (
              <ActivityIndicator size="small" color={colors.primaryFg} />
            ) : (
              <>
                <Feather name="lock" size={14} color={colors.primaryFg} />
                <Text style={styles.payLabel}>
                  Pay {formatPrice(total, currency)} · whole look
                </Text>
              </>
            )}
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    paddingTop: spacing.sm,
    maxHeight: "90%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: { fontFamily: fonts.heading, fontSize: 20, color: colors.primary, marginTop: 2 },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  body: { flexGrow: 0, flexShrink: 1, paddingHorizontal: spacing.lg },
  pieceRow: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  thumb: { width: 64, height: 80, backgroundColor: colors.muted },
  pieceName: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  piecePrice: { fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg, marginTop: 2 },
  sizeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  sizeChip: {
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  sizeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  sizeChipLabel: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.primary },
  sizeChipLabelActive: { color: colors.primaryFg },
  sizeHint: { fontFamily: fonts.body, fontSize: 11, color: colors.mutedFg, marginTop: 6 },
  sectionCaption: { marginTop: spacing.lg, marginBottom: spacing.sm },
  addAddrBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    height: 44,
  },
  addAddrLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary },
  addrRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  addrRowActive: { borderColor: colors.primary },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  addrName: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary },
  addrSub: { fontFamily: fonts.body, fontSize: 11, color: colors.mutedFg, marginTop: 2 },
  totals: { paddingVertical: spacing.md },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  totalRowGrand: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 6,
    paddingTop: 10,
  },
  totalLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.mutedFg },
  totalValue: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.primary },
  grandLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  grandValue: { fontFamily: fonts.heading, fontSize: 18, color: colors.primary },
  payBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    height: 52,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  payLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    letterSpacing: 1.2,
    color: colors.primaryFg,
    textTransform: "uppercase",
  },
});

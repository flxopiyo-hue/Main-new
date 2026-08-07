// AI Stylist — chat assistant. Gemini 3.1 Pro reads the buyer's profile
// photo (skin tone / undertone, build) + measurements and suggests real,
// shoppable outfit combinations from the live catalog by occasion.
//
// Suggestions arrive as outfit cards: tap a piece → item page; "Try this
// look on" stages every piece into the outfit store and opens the Outfit
// Drawer for a one-tap multi-garment AI try-on.

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { LookCheckoutSheet } from "@/src/components/LookCheckoutSheet";
import { OutfitDrawer } from "@/src/components/OutfitDrawer";
import { PaywallModal } from "@/src/components/PaywallModal";
import { useToast } from "@/src/components/Toast";
import { api, isPaywallError, Item, StylistOutfit } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { formatPrice } from "@/src/lib/currency";
import { dataUriFromBase64 } from "@/src/lib/images";
import { useOutfit } from "@/src/lib/outfit";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface ChatMsg {
  role: "user" | "stylist";
  text: string;
  outfits?: StylistOutfit[];
}

const OCCASIONS: { key: string; label: string; starter: string; icon: string }[] = [
  { key: "casual", label: "Casual", icon: "sun", starter: "I'm looking for a great casual look." },
  { key: "official", label: "Official · Work", icon: "briefcase", starter: "Style me for the office — official wear." },
  { key: "event", label: "Event · Wedding", icon: "star", starter: "I have an event coming up — what should I wear?" },
  { key: "date", label: "Date night", icon: "heart", starter: "Style me for a date night." },
];

export default function StylistScreen() {
  const toast = useToast();
  const { user } = useAuth();
  const addToOutfit = useOutfit((s) => s.add);
  const clearOutfit = useOutfit((s) => s.clear);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [occasion, setOccasion] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [hasFrontPhoto, setHasFrontPhoto] = useState(true);
  const [paywallInfo, setPaywallInfo] = useState<{ feature?: string; message?: string } | null>(null);
  const [outfitOpen, setOutfitOpen] = useState(false);
  const [shopOutfit, setShopOutfit] = useState<StylistOutfit | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Resume the most recent session (keeps the 2/week free quota honest);
  // also learn whether the buyer has a front photo for the hint banner.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sessions, profile] = await Promise.all([
          api.stylistSessions(),
          api.getProfile().catch(() => null),
        ]);
        if (cancelled) return;
        if (profile) setHasFrontPhoto(!!profile.has_front_photo);
        if (sessions.length > 0) {
          const detail = await api.stylistSession(sessions[0].id);
          if (cancelled) return;
          setSessionId(detail.id);
          setOccasion(detail.occasion ?? null);
          setMessages(
            detail.messages.map((m) => ({
              role: m.role,
              text: m.text,
              outfits: m.outfits,
            })),
          );
        }
      } catch {
        // fresh start is fine
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    return () => clearTimeout(t);
  }, [messages.length, sending]);

  const send = useCallback(
    async (text: string, occ?: string | null) => {
      const msg = text.trim();
      if (!msg || sending) return;
      setInput("");
      setMessages((m) => [...m, { role: "user", text: msg }]);
      setSending(true);
      try {
        const res = await api.stylistChat({
          session_id: sessionId,
          message: msg,
          occasion: occ ?? occasion,
        });
        setSessionId(res.session_id);
        if (res.occasion) setOccasion(res.occasion);
        setMessages((m) => [
          ...m,
          { role: "stylist", text: res.reply, outfits: res.outfits },
        ]);
      } catch (e: any) {
        if (isPaywallError(e)) {
          setPaywallInfo({ feature: e.feature, message: e.message });
          // Drop the optimistic user bubble — nothing was consumed.
          setMessages((m) => m.slice(0, -1));
        } else {
          toast.show(e?.message ?? "Stylist is unavailable right now", "error");
          setMessages((m) => m.slice(0, -1));
        }
      } finally {
        setSending(false);
      }
    },
    [sessionId, occasion, sending, toast],
  );

  const startNewSession = () => {
    setSessionId(null);
    setOccasion(null);
    setMessages([]);
  };

  const tryLook = (o: StylistOutfit) => {
    clearOutfit();
    o.items.forEach((it) => addToOutfit(it as unknown as Item));
    setOutfitOpen(true);
  };

  if (user && user.role !== "buyer") {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <Text style={tp.bodyMuted}>The AI Stylist is for buyer accounts.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "translate-with-padding" : "translate-with-padding"}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            testID="stylist-back-btn"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
            style={styles.headerBtn}
          >
            <Feather name="arrow-left" size={20} color={colors.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={tp.caption}>ORO · AI STYLIST</Text>
            <Text style={styles.headerTitle}>Your personal stylist</Text>
          </View>
          {messages.length > 0 ? (
            <TouchableOpacity
              testID="stylist-new-session-btn"
              onPress={startNewSession}
              style={styles.headerBtn}
              accessibilityLabel="Start a new stylist session"
            >
              <Feather name="edit-3" size={18} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.chatContent}
          keyboardShouldPersistTaps="handled"
          testID="stylist-chat-scroll"
        >
          {loadingHistory ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.empty} testID="stylist-empty-state">
              <View style={styles.emptyIcon}>
                <Feather name="feather" size={22} color={colors.primaryFg} />
              </View>
              <Text style={[tp.h2, { textAlign: "center" }]}>What are we dressing you for?</Text>
              <Text style={[tp.bodyMuted, styles.emptySub]}>
                I read your profile photo — skin tone, undertone, body structure —
                plus your measurements, and pick real pieces from the boutique
                that flatter you. Choose an occasion or just ask.
              </Text>
              <View style={styles.occasionGrid}>
                {OCCASIONS.map((o) => (
                  <TouchableOpacity
                    key={o.key}
                    testID={`stylist-occasion-${o.key}`}
                    style={styles.occasionChip}
                    onPress={() => {
                      setOccasion(o.key);
                      send(o.starter, o.key);
                    }}
                    activeOpacity={0.85}
                  >
                    <Feather name={o.icon as any} size={16} color={colors.primary} />
                    <Text style={styles.occasionLabel}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {!hasFrontPhoto ? (
                <TouchableOpacity
                  testID="stylist-add-photo-hint"
                  style={styles.photoHint}
                  onPress={() => router.push("/onboarding/measurements")}
                >
                  <Feather name="camera" size={14} color={colors.mutedFg} />
                  <Text style={styles.photoHintText}>
                    Add a front photo to unlock skin-tone matched advice →
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            messages.map((m, idx) => (
              <View key={idx}>
                <View
                  style={[styles.bubble, m.role === "user" ? styles.bubbleUser : styles.bubbleAI]}
                  testID={`stylist-msg-${idx}`}
                >
                  <Text style={m.role === "user" ? styles.bubbleUserText : styles.bubbleAIText}>
                    {m.text}
                  </Text>
                </View>
                {(m.outfits ?? []).map((o, oi) => (
                  <View key={oi} style={styles.outfitCard} testID={`stylist-outfit-${idx}-${oi}`}>
                    <Text style={styles.outfitTitle}>{o.title}</Text>
                    {o.why ? <Text style={styles.outfitWhy}>{o.why}</Text> : null}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.outfitItemsRow}>
                        {o.items.map((it) => (
                          <TouchableOpacity
                            key={it.id}
                            testID={`stylist-outfit-item-${it.id}`}
                            style={styles.outfitItem}
                            onPress={() => router.push(`/item/${it.id}`)}
                            activeOpacity={0.85}
                          >
                            <Image
                              source={{ uri: dataUriFromBase64(it.image_b64) }}
                              style={styles.outfitThumb}
                              resizeMode="cover"
                            />
                            <Text style={styles.outfitItemName} numberOfLines={1}>
                              {it.name}
                            </Text>
                            <Text style={styles.outfitItemPrice}>
                              {formatPrice(it.price_cents, it.currency)}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                    <View style={styles.lookActions}>
                      <TouchableOpacity
                        testID={`stylist-try-look-${idx}-${oi}`}
                        style={[styles.tryLookBtn, styles.tryLookGhost]}
                        onPress={() => tryLook(o)}
                        activeOpacity={0.85}
                      >
                        <Feather name="layers" size={14} color={colors.primary} />
                        <Text style={[styles.tryLookLabel, { color: colors.primary }]}>Try it on</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        testID={`stylist-shop-look-${idx}-${oi}`}
                        style={styles.tryLookBtn}
                        onPress={() => setShopOutfit(o)}
                        activeOpacity={0.85}
                      >
                        <Feather name="shopping-bag" size={14} color={colors.primaryFg} />
                        <Text style={styles.tryLookLabel}>Shop the look</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            ))
          )}
          {sending ? (
            <View style={[styles.bubble, styles.bubbleAI, styles.typingRow]} testID="stylist-typing">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.typingText}>Styling you…</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            testID="stylist-input"
            style={styles.input}
            placeholder="Ask your stylist…"
            placeholderTextColor={colors.mutedFg}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={600}
            onSubmitEditing={() => send(input)}
          />
          <TouchableOpacity
            testID="stylist-send-btn"
            style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.4 }]}
            onPress={() => send(input)}
            disabled={!input.trim() || sending}
          >
            <Feather name="arrow-up" size={18} color={colors.primaryFg} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <OutfitDrawer visible={outfitOpen} onClose={() => setOutfitOpen(false)} />
      <LookCheckoutSheet
        visible={!!shopOutfit}
        outfit={shopOutfit}
        onClose={() => setShopOutfit(null)}
      />
      <PaywallModal
        visible={!!paywallInfo}
        feature={paywallInfo?.feature}
        message={paywallInfo?.message}
        onClose={() => setPaywallInfo(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: spacing.xxl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontFamily: fonts.heading, fontSize: 20, color: colors.primary, marginTop: 2 },
  chatContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  empty: { alignItems: "center", paddingVertical: spacing.xl, gap: spacing.md },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  emptySub: { textAlign: "center", maxWidth: 320 },
  occasionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  occasionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minWidth: 150,
  },
  occasionLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary },
  photoHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.muted,
  },
  photoHintText: { fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg },
  bubble: {
    maxWidth: "86%",
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.sm,
  },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: colors.primary },
  bubbleAI: { alignSelf: "flex-start", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  bubbleUserText: { fontFamily: fonts.body, fontSize: 14, color: colors.primaryFg, lineHeight: 20 },
  bubbleAIText: { fontFamily: fonts.body, fontSize: 14, color: colors.primary, lineHeight: 20 },
  typingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  typingText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.mutedFg },
  outfitCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.md,
    alignSelf: "stretch",
  },
  outfitTitle: { fontFamily: fonts.heading, fontSize: 17, color: colors.primary },
  outfitWhy: { fontFamily: fonts.body, fontSize: 12, color: colors.mutedFg, marginTop: 4, lineHeight: 17 },
  outfitItemsRow: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md },
  outfitItem: { width: 96 },
  outfitThumb: { width: 96, height: 120, backgroundColor: colors.muted },
  outfitItemName: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.primary, marginTop: 6 },
  outfitItemPrice: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.mutedFg, marginTop: 2 },
  lookActions: { flexDirection: "row", gap: spacing.sm },
  tryLookBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    height: 44,
  },
  tryLookGhost: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  tryLookLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.primaryFg,
    textTransform: "uppercase",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.primary,
  },
  sendBtn: {
    width: 44,
    height: 44,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});

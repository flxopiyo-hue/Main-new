// Admin — tester / user feedback inbox.

import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AdminShell } from "@/src/components/AdminShell";
import { useToast } from "@/src/components/Toast";
import { api, FeedbackEntry } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

export default function AdminFeedback() {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.adminListFeedback());
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load feedback", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useFocusEffect(
    useCallback(() => {
      if (!authLoading) {
        if (!user || user.role !== "admin") {
          router.replace("/(auth)/welcome");
          return;
        }
        load();
      }
    }, [authLoading, user, load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  return (
    <AdminShell
      title="Feedback"
      subtitle="What testers and users are telling us, newest first."
    >
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          testID="admin-feedback-scroll"
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {items.length === 0 ? (
            <Text style={[tp.bodyMuted, { padding: spacing.lg }]} testID="admin-feedback-empty">
              No feedback yet. It appears here the moment a user taps “Send feedback”.
            </Text>
          ) : (
            items.map((f) => (
              <View key={f.id} style={styles.card} testID={`admin-feedback-${f.id}`}>
                <View style={styles.cardTop}>
                  <Feather name="message-square" size={14} color={colors.primary} />
                  <Text style={styles.who} numberOfLines={1}>
                    {f.full_name || f.email || "Anonymous"}
                  </Text>
                  <Text style={styles.meta}>
                    {(f.role || "user").toUpperCase()}
                    {f.platform ? ` · ${f.platform}` : ""}
                  </Text>
                </View>
                <Text style={styles.message}>{f.message}</Text>
                <Text style={styles.date}>
                  {new Date(f.created_at).toLocaleString(undefined, {
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {f.app_version ? ` · v${f.app_version}` : ""}
                </Text>
              </View>
            ))
          )}
          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  card: {
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  who: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primary },
  meta: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.mutedFg,
  },
  message: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.text },
  date: { marginTop: 8, fontFamily: fonts.body, fontSize: 11, color: colors.mutedFg },
});

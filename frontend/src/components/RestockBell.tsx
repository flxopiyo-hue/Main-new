// Restock notification bell on the Discover header.
//
// Polls /api/notifications/restock on focus + every N seconds while
// mounted. A red dot appears whenever at least one row has
// `notified_at != null && viewed_at == null` (i.e. flipped back to
// stock but the buyer hasn't opened this drawer yet). Tapping opens a
// small modal listing the items — tapping an item navigates to it and
// marks the notification as viewed.

import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { api } from "@/src/lib/api";
import { colors, fonts, spacing, type as tp } from "@/src/lib/theme";

interface Notif {
  id: string;
  item_id: string;
  item_name: string;
  size: string;
  subscribed_at: string;
  notified_at: string | null;
  viewed_at: string | null;
}

interface Props {
  testID?: string;
}

export function RestockBell({ testID }: Props) {
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.restockNotifications();
      setNotifs(rows);
    } catch {
      /* soft-fail — the bell just won't show a dot */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const pending = notifs.filter((n) => n.notified_at && !n.viewed_at);
  const hasDot = pending.length > 0;

  const dismiss = async (id: string) => {
    try {
      await api.dismissNotification(id);
      setNotifs((rows) => rows.filter((r) => r.id !== id));
    } catch {
      /* ignore */
    }
  };

  const jumpToItem = async (n: Notif) => {
    setOpen(false);
    await dismiss(n.id);
    router.push(`/item/${n.item_id}`);
  };

  return (
    <>
      <TouchableOpacity
        testID={testID ?? "restock-bell"}
        onPress={() => setOpen(true)}
        style={styles.trigger}
        accessibilityLabel="Restock notifications"
      >
        <Feather name="bell" size={20} color={colors.primary} />
        {hasDot ? (
          <View style={styles.dot} testID="restock-bell-dot">
            <Text style={styles.dotLabel} numberOfLines={1}>
              {pending.length > 9 ? "9+" : pending.length}
            </Text>
          </View>
        ) : null}
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={tp.caption}>RESTOCK ALERTS</Text>
                <Text style={[tp.h3, { marginTop: 4 }]}>
                  {pending.length > 0
                    ? `${pending.length} back in stock`
                    : notifs.length > 0
                      ? "Watching sold-out sizes"
                      : "All clear"}
                </Text>
              </View>
              <TouchableOpacity
                testID="restock-bell-close"
                onPress={() => setOpen(false)}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                <Feather name="x" size={18} color={colors.mutedFg} />
              </TouchableOpacity>
            </View>
            {loading ? (
              <View style={styles.empty}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : notifs.length === 0 ? (
              <View style={styles.empty} testID="restock-bell-empty">
                <Feather name="bell-off" size={22} color={colors.mutedFg} />
                <Text style={[tp.bodyMuted, { textAlign: "center", marginTop: 8 }]}>
                  Tap {'"'}Notify me{'"'} on any sold-out size to watch it here.
                </Text>
              </View>
            ) : (
              <FlatList
                data={notifs}
                keyExtractor={(n) => n.id}
                renderItem={({ item }) => {
                  const isBack = !!item.notified_at && !item.viewed_at;
                  return (
                    <TouchableOpacity
                      testID={`restock-bell-row-${item.id}`}
                      onPress={() => jumpToItem(item)}
                      style={[styles.row, isBack && styles.rowActive]}
                      activeOpacity={0.85}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {item.item_name}
                        </Text>
                        <Text style={[tp.bodyMuted, { fontSize: 11, marginTop: 2 }]}>
                          Size {item.size} ·{" "}
                          {isBack ? "Back in stock — tap to shop" : "Waiting"}
                        </Text>
                      </View>
                      {isBack ? (
                        <View style={styles.backDot} testID={`restock-bell-row-${item.id}-back`}>
                          <Text style={styles.backDotLabel}>NEW</Text>
                        </View>
                      ) : null}
                      <Feather name="chevron-right" size={16} color={colors.mutedFg} />
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { padding: 8, position: "relative" },
  dot: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  dotLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    color: colors.primaryFg,
    lineHeight: 12,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10,10,10,0.45)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 76,
    paddingRight: 12,
  },
  sheet: {
    width: 340,
    maxHeight: "80%",
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  empty: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowActive: { backgroundColor: colors.surface },
  rowTitle: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primary },
  backDot: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: colors.error,
  },
  backDotLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 9,
    color: colors.primaryFg,
    letterSpacing: 1,
  },
});

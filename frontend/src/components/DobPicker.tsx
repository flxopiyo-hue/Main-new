// Cross-platform date-of-birth picker.
//
// Why custom instead of @react-native-community/datetimepicker?
//   • That library is a NATIVE module — on web it renders nothing, so the
//     existing "Pick a date" trigger silently failed in the Expo web preview.
//   • The native spinner on iOS is fiddly for older years; Android's calendar
//     dialog requires many taps to walk back decades.
//   • Three discrete wheel columns (Year | Month | Day) work identically on
//     web, iOS, and Android, and let users jump directly to their birth year.
//
// Renders three FlatList "wheels" inside a Modal. The currently-selected row
// is highlighted at the centre, and tapping any visible row promotes it.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, fonts, spacing } from "@/src/lib/theme";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5; // odd number so the centre row aligns with the highlight
const SPACER = (VISIBLE_ITEMS - 1) / 2; // 2 blank rows of padding on each side

function daysInMonth(year: number, monthIndex: number): number {
  // monthIndex is 0-based; passing day=0 of the next month returns the last day
  return new Date(year, monthIndex + 1, 0).getDate();
}

interface WheelProps<T extends number | string> {
  testID?: string;
  values: T[];
  selected: T;
  labelFor?: (v: T) => string;
  onChange: (v: T) => void;
}

function Wheel<T extends number | string>({
  testID,
  values,
  selected,
  labelFor,
  onChange,
}: WheelProps<T>) {
  const listRef = useRef<FlatList<T>>(null);
  const selectedIndex = useMemo(() => {
    const idx = values.indexOf(selected);
    return idx < 0 ? 0 : idx;
  }, [values, selected]);

  // Keep the scroll position aligned with the parent-controlled value.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToOffset({
          offset: selectedIndex * ITEM_HEIGHT,
          animated: true,
        });
      } catch {
        // first paint can race the scrollable area; ignore.
      }
    }, 30);
    return () => clearTimeout(t);
  }, [selectedIndex]);

  const onScrollEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const y = e.nativeEvent.contentOffset.y;
      const idx = Math.round(y / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(values.length - 1, idx));
      const v = values[clamped];
      if (v !== selected) onChange(v);
    },
    [values, selected, onChange],
  );

  // SpacerView renders SPACER blank rows (top and bottom) so the first/last
  // real values can be centred in the highlight band when selected.
  const SpacerView = useCallback(
    () => <View style={{ height: ITEM_HEIGHT * SPACER }} pointerEvents="none" />,
    [],
  );

  return (
    <View style={styles.wheelWrap} testID={testID}>
      {/* Highlight band that sits behind the centred row */}
      <View pointerEvents="none" style={styles.wheelHighlight} />
      <FlatList
        ref={listRef}
        data={values}
        keyExtractor={(v) => String(v)}
        showsVerticalScrollIndicator={false}
        getItemLayout={(_d, i) => ({
          length: ITEM_HEIGHT,
          offset: i * ITEM_HEIGHT,
          index: i,
        })}
        initialScrollIndex={selectedIndex}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={onScrollEnd}
        // On web, momentum events can be absent — also wire scrollEnd.
        onScrollEndDrag={onScrollEnd}
        ListHeaderComponent={SpacerView}
        ListFooterComponent={SpacerView}
        renderItem={({ item, index }) => {
          const isActive = index === selectedIndex;
          return (
            <TouchableOpacity
              testID={
                testID ? `${testID}-row-${String(item).toLowerCase()}` : undefined
              }
              activeOpacity={0.7}
              onPress={() => onChange(item)}
              style={styles.wheelRow}
            >
              <Text style={[styles.wheelText, isActive && styles.wheelTextActive]}>
                {labelFor ? labelFor(item) : String(item)}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

export interface DobPickerProps {
  visible: boolean;
  value: Date | null;
  /** Earliest selectable date (inclusive). */
  minDate: Date;
  /** Latest selectable date (inclusive). */
  maxDate: Date;
  onConfirm: (d: Date) => void;
  onCancel: () => void;
}

export function DobPicker({
  visible,
  value,
  minDate,
  maxDate,
  onConfirm,
  onCancel,
}: DobPickerProps) {
  const initial = value ?? maxDate;
  const [year, setYear] = useState<number>(initial.getFullYear());
  const [monthIdx, setMonthIdx] = useState<number>(initial.getMonth());
  const [day, setDay] = useState<number>(initial.getDate());

  // Reset internal state every time the modal opens so it tracks the
  // parent-supplied `value` (or maxDate as the default).
  useEffect(() => {
    if (visible) {
      const src = value ?? maxDate;
      setYear(src.getFullYear());
      setMonthIdx(src.getMonth());
      setDay(src.getDate());
    }
  }, [visible, value, maxDate]);

  // Year & day ranges are derived from the current Y/M selection.
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = maxDate.getFullYear(); y >= minDate.getFullYear(); y--) {
      out.push(y);
    }
    return out;
  }, [minDate, maxDate]);

  const days = useMemo(() => {
    const n = daysInMonth(year, monthIdx);
    return Array.from({ length: n }, (_, i) => i + 1);
  }, [year, monthIdx]);

  // Clamp day when month/year change (e.g. Feb 30 → Feb 28).
  useEffect(() => {
    const max = daysInMonth(year, monthIdx);
    if (day > max) setDay(max);
  }, [year, monthIdx, day]);

  const confirm = useCallback(() => {
    let d = new Date(year, monthIdx, day);
    if (d < minDate) d = minDate;
    if (d > maxDate) d = maxDate;
    onConfirm(d);
  }, [year, monthIdx, day, minDate, maxDate, onConfirm]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      testID="dob-picker-modal"
    >
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <SafeAreaView style={styles.sheetWrap} edges={["bottom"]}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Date of birth</Text>
          <Text style={styles.sub}>You must be at least 13 to join Drape.</Text>

          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.colLabel}>Year</Text>
              <Wheel
                testID="dob-wheel-year"
                values={years}
                selected={year}
                onChange={setYear}
              />
            </View>
            <View style={styles.col}>
              <Text style={styles.colLabel}>Month</Text>
              <Wheel
                testID="dob-wheel-month"
                values={MONTHS}
                selected={MONTHS[monthIdx]}
                labelFor={(m) => String(m).slice(0, 3)}
                onChange={(m) => setMonthIdx(MONTHS.indexOf(String(m)))}
              />
            </View>
            <View style={styles.col}>
              <Text style={styles.colLabel}>Day</Text>
              <Wheel
                testID="dob-wheel-day"
                values={days}
                selected={day}
                onChange={setDay}
              />
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              testID="dob-picker-cancel"
              onPress={onCancel}
              style={[styles.actionBtn, styles.actionGhost]}
              activeOpacity={0.85}
            >
              <Text style={styles.actionGhostLabel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="dob-picker-confirm"
              onPress={confirm}
              style={[styles.actionBtn, styles.actionPrimary]}
              activeOpacity={0.85}
            >
              <Text style={styles.actionPrimaryLabel}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheetWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
  },
  sheet: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 28,
    color: colors.primary,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.mutedFg,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
  },
  col: {
    flex: 1,
  },
  colLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.4,
    color: colors.mutedFg,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  wheelWrap: {
    height: ITEM_HEIGHT * VISIBLE_ITEMS,
    overflow: "hidden",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    position: "relative",
  },
  wheelHighlight: {
    position: "absolute",
    left: 0,
    right: 0,
    top: ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2),
    height: ITEM_HEIGHT,
    backgroundColor: colors.muted,
  },
  wheelRow: {
    height: ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelText: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.mutedFg,
  },
  wheelTextActive: {
    fontFamily: fonts.bodySemi,
    color: colors.primary,
    fontSize: 18,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  actionBtn: {
    flex: 1,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  actionGhost: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionPrimary: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  actionGhostLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.primary,
    textTransform: "uppercase",
  },
  actionPrimaryLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.primaryFg,
    textTransform: "uppercase",
  },
});

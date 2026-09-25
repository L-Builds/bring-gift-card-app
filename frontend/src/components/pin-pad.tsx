import React, { useEffect, useState } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

/** Thumb-friendly 4-digit PIN entry: masked dots + large numeric keypad. */
export function PinPad({
  length = 4,
  onComplete,
  resetKey,
  error,
  disabled,
  testID = "pin",
}: {
  length?: number;
  onComplete: (pin: string) => void;
  resetKey?: string | number;
  error?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [value, setValue] = useState("");

  useEffect(() => setValue(""), [resetKey]);

  const press = (k: string) => {
    if (disabled) return;
    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
    if (k === "del") return setValue((v) => v.slice(0, -1));
    if (value.length >= length) return;
    const next = value + k;
    setValue(next);
    if (next.length === length) setTimeout(() => onComplete(next), 80);
  };

  return (
    <View style={styles.wrap} testID={`${testID}-pad`}>
      <View style={styles.dots}>
        {Array.from({ length }).map((_, i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotFilled, error && styles.dotError]} testID={`${testID}-dot-${i}`} />
        ))}
      </View>
      <View style={styles.grid}>
        {KEYS.map((k, i) => (
          <Pressable
            key={i}
            disabled={!k || disabled}
            onPress={() => press(k)}
            style={({ pressed }) => [styles.key, !k && styles.keyBlank, pressed && k ? styles.keyPressed : null]}
            testID={k ? `${testID}-key-${k}` : undefined}
          >
            {k === "del" ? <Ionicons name="backspace-outline" size={26} color={colors.onSurface} /> : <Text style={styles.keyText}>{k}</Text>}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { alignItems: "center", gap: spacing.xl },
  dots: { flexDirection: "row", gap: spacing.lg },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: "transparent" },
  dotFilled: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  dotError: { borderColor: colors.error, backgroundColor: colors.errorBg },
  grid: { flexDirection: "row", flexWrap: "wrap", width: 3 * 84 + 2 * spacing.md, gap: spacing.md, justifyContent: "center" },
  key: { width: 84, height: 64, borderRadius: radius.xl, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  keyBlank: { backgroundColor: "transparent", borderColor: "transparent" },
  keyPressed: { backgroundColor: colors.brandSecondary, borderColor: colors.brandPrimary },
  keyText: { fontSize: 26, fontWeight: "700", color: colors.onSurface },
}));

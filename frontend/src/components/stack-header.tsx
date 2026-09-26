import React from "react";
import { View, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, spacing } from "@/src/theme";

export function StackHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable style={styles.back} onPress={onBack ?? (() => router.back())} testID="stack-back">
        <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={styles.right}>{right ?? <View style={{ width: 44 }} />}</View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", shadowColor: colors.shadow, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  title: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "800", color: colors.brandDeep },
  right: { minWidth: 44, alignItems: "flex-end" },
}));

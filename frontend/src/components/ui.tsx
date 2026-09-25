import React from "react";
import {
  Text,
  View,
  Pressable,
  ActivityIndicator,
  StyleProp,
  ViewStyle,
  TextStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { initials } from "@/src/lib/format";

export function Icon(props: { name: any; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Ionicons name={props.name} size={props.size ?? 22} color={props.color ?? colors.onSurface} />;
}

export function ScreenBackground({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[{ flex: 1, backgroundColor: colors.screenBg }, style]}>
      <LinearGradient
        colors={[colors.screenBgAlt, colors.screenBg]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {children}
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  loading,
  disabled,
  icon,
  variant = "primary",
  testID,
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: any;
  variant?: "primary" | "secondary" | "outline";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const isDisabled = disabled || loading;
  const bgStyle =
    variant === "primary" ? styles.btnPrimary : variant === "secondary" ? styles.btnSecondary : styles.btnOutline;
  const txtColor =
    variant === "primary" ? colors.onBrandPrimary : colors.brandPrimary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [styles.btn, bgStyle, isDisabled && styles.btnDisabled, pressed && styles.btnPressed, style]}
    >
      {loading ? (
        <ActivityIndicator color={txtColor} />
      ) : (
        <View style={styles.btnRow}>
          <Text style={[styles.btnText, { color: txtColor }]}>{title}</Text>
          {icon && <Ionicons name={icon} size={18} color={txtColor} />}
        </View>
      )}
    </Pressable>
  );
}

export function Card({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const styles = useStyles();
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function BrandMonogram({ name, color, size = 44 }: { name: string; color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: size * 0.36 }}>{initials(name)}</Text>
    </View>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { colors } = useTheme();
  const s = status.toLowerCase();
  let bg = colors.infoBg;
  let fg = colors.info;
  if (["completed", "approved", "paid", "verified", "resolved"].includes(s)) {
    bg = colors.successBg;
    fg = colors.success;
  } else if (["pending", "processing", "pending_review", "need_more_info", "open"].includes(s)) {
    bg = colors.warningBg;
    fg = colors.warning;
  } else if (["failed", "rejected", "cancelled"].includes(s)) {
    bg = colors.errorBg;
    fg = colors.error;
  }
  const label = status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill }}>
      <Text style={{ color: fg, fontWeight: "700", fontSize: 12 }}>{label}</Text>
    </View>
  );
}

export function LoadingView({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl }}>
      <ActivityIndicator size="large" color={colors.brandPrimary} />
      {label && <Text style={{ color: colors.muted, marginTop: spacing.md }}>{label}</Text>}
    </View>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", padding: spacing.xxxl, gap: spacing.sm }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: colors.brandSecondary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={34} color={colors.brandPrimary} />
      </View>
      <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 17, marginTop: spacing.sm }}>{title}</Text>
      {subtitle && <Text style={{ color: colors.muted, textAlign: "center", lineHeight: 20 }}>{subtitle}</Text>}
    </View>
  );
}

export const useStyles = makeStyles((colors) => ({
  btn: {
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  btnPrimary: {
    backgroundColor: colors.brandPrimary,
    shadowColor: colors.brandPrimary,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  btnSecondary: { backgroundColor: colors.brandSecondary },
  btnOutline: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: colors.brandPrimary },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  btnRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  btnText: { fontSize: 16, fontWeight: "700" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
}));

export const textStyles: { [k: string]: TextStyle } = {};

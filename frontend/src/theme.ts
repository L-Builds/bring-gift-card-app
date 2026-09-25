// Bring Gift Card — design tokens (light theme).
// Official V1.1.0 brand system:
// deep logo blue anchors major branded surfaces, bright blue drives actions/selection,
// and light icy blue/white keeps the product clean and breathable.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  // Surfaces
  surface: "#FFFFFF", // primary canvas / cards
  onSurface: "#0F1F44", // deep navy text
  surfaceSecondary: "#F5F8FE", // subtle cards, list rows
  onSurfaceSecondary: "#374151",
  surfaceTertiary: "#EEF3FC", // input backgrounds, chips
  onSurfaceTertiary: "#4B5563",
  surfaceInverse: "#0F1F44",
  onSurfaceInverse: "#FFFFFF",
  muted: "#8A94A6", // captions, placeholders, timestamps

  // Screen background (light blue wash)
  screenBg: "#EAF2FF",
  screenBgAlt: "#F3F8FF",

  // Brand
  brand: "#1F5AF6",
  onBrand: "#FFFFFF",
  brandLogo: "#0B3B8B", // sampled from the approved Bring Gift Card blue logo
  brandPrimary: "#1F5AF6", // bright action blue: CTA / active states
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#E3ECFF", // secondary CTA fills
  onBrandSecondary: "#1F5AF6",
  brandTertiary: "#EEF3FC", // chips, tags
  onBrandTertiary: "#1F5AF6",
  brandDeep: "#0B3B8B", // dark logo blue: headers / hero & balance gradient anchor
  brandLink: "#1F5AF6",

  // Status
  success: "#15A34A",
  onSuccess: "#FFFFFF",
  successBg: "#DCFCE7",
  warning: "#D97706",
  onWarning: "#FFFFFF",
  warningBg: "#FEF3C7",
  error: "#DC2626",
  onError: "#FFFFFF",
  errorBg: "#FEE2E2",
  info: "#1D4ED8",
  onInfo: "#FFFFFF",
  infoBg: "#DBEAFE",

  // Lines
  border: "#E4EAF2",
  borderStrong: "#C9D6EA",
  divider: "#EDF1F7",

  // Misc
  shadow: "#1F3A6B",
  overlay: "rgba(15,31,68,0.45)",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system === "dark" && themes.dark ? "dark" : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

// Shared spacing + radius tokens
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  pill: 999,
};

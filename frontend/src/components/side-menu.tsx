import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { Text, View, Pressable, Animated, Dimensions, ScrollView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import Constants from "expo-constants";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { useAuth } from "@/src/context/auth";
import { initials } from "@/src/lib/format";

const { width } = Dimensions.get("window");
const DRAWER_W = Math.min(340, width * 0.84);

const SideMenuContext = createContext<{ open: () => void; close: () => void } | undefined>(undefined);

export function SideMenuProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const tx = useRef(new Animated.Value(-DRAWER_W)).current;
  const fade = useRef(new Animated.Value(0)).current;

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(tx, { toValue: 0, duration: 240, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(fade, { toValue: 1, duration: 240, useNativeDriver: Platform.OS !== "web" }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(tx, { toValue: -DRAWER_W, duration: 220, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: Platform.OS !== "web" }),
      ]).start(() => setMounted(false));
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SideMenuContext.Provider value={{ open, close }}>
      {children}
      {mounted && <DrawerContent tx={tx} fade={fade} onClose={close} />}
    </SideMenuContext.Provider>
  );
}

export function useSideMenu() {
  const ctx = useContext(SideMenuContext);
  if (!ctx) throw new Error("useSideMenu must be used within SideMenuProvider");
  return ctx;
}

function DrawerContent({ tx, fade, onClose }: { tx: Animated.Value; fade: Animated.Value; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, isGuest, logout } = useAuth();
  const appVersion = Constants.expoConfig?.version ?? "1.1.0";

  const go = (path: string) => {
    onClose();
    setTimeout(() => router.push(path as any), 220);
  };

  const doLogout = async () => {
    onClose();
    await logout();
    setTimeout(() => router.replace("/"), 220);
  };

  const MenuRow = ({ icon, label, onPress, color, right }: any) => (
    <Pressable style={styles.row} onPress={onPress} testID={`menu-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <View style={styles.rowLeft}>
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={22} color={color || colors.brandPrimary} />
        </View>
        <Text style={[styles.rowLabel, color && { color }]}>{label}</Text>
      </View>
      {right ?? <Ionicons name="chevron-forward" size={18} color={colors.muted} />}
    </Pressable>
  );

  const InfoRow = ({ icon, label, value }: { icon: any; label: string; value: string }) => (
    <View style={styles.row} testID={`menu-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <View style={styles.rowLeft}>
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={22} color={colors.brandPrimary} />
        </View>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );

  return (
    <View style={StyleSheetAbsolute}>
      <Animated.View style={[styles.overlay, { opacity: fade }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} testID="menu-overlay" />
      </Animated.View>
      <Animated.View style={[styles.drawer, { transform: [{ translateX: tx }], paddingTop: insets.top + spacing.md }]}>
        <View style={styles.brandRow}>
          <Image source={require("../../assets/brand/logo-blue.png")} style={styles.brandLogo} contentFit="contain" />
          <View style={{ flex: 1 }}>
            <Text style={styles.brandTitle}>
              Bring <Text style={{ color: colors.brandPrimary }}>Gift Card</Text>
            </Text>
            <Text style={styles.brandTag}>More Cards. More Value. Same Trust.</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn} testID="menu-close">
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {isGuest ? (
            <View style={styles.guestCard}>
              <View style={styles.guestAvatar}>
                <Ionicons name="person-outline" size={42} color={colors.brandPrimary} />
              </View>
              <Text style={styles.guestName}>Guest</Text>
              <Text style={styles.guestSub}>Sign in to unlock full features</Text>
              <View style={styles.guestBtns}>
                <Pressable style={[styles.gBtn, styles.gBtnOutline]} onPress={() => go("/(auth)/login")} testID="menu-login">
                  <Text style={{ color: colors.brandPrimary, fontWeight: "700" }}>Login</Text>
                </Pressable>
                <Pressable style={[styles.gBtn, { backgroundColor: colors.brandPrimary }]} onPress={() => go("/(auth)/signup")} testID="menu-signup">
                  <Text style={{ color: colors.onBrandPrimary, fontWeight: "700" }}>Sign Up</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={styles.profileCard} onPress={() => go("/(tabs)/profile")} testID="menu-profile-card">
              <View style={styles.profileAvatar}>
                <Text style={styles.profileInitials}>{initials(user!.full_name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{user!.full_name}</Text>
                <View style={styles.verifiedRow}>
                  <Text style={styles.profileVerified}>Account</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
          )}

          <View style={styles.menuGroup}>
            {!isGuest && <MenuRow icon="home" label="Home" onPress={() => go("/(tabs)")} />}
            <MenuRow icon="document-text-outline" label="Trading Guidelines" onPress={() => go("/trading-guidelines")} />
            {isGuest && <InfoRow icon="sync-outline" label="Version Update" value={`v${appVersion}`} />}
            <MenuRow icon="help-circle-outline" label="FAQ" onPress={() => go("/support")} />
            <MenuRow icon="headset-outline" label={isGuest ? "Contact Support" : "Support"} onPress={() => go("/support")} />
            {!isGuest && <MenuRow icon="log-out-outline" label="Log Out" onPress={doLogout} color={colors.error} />}
          </View>

          {isGuest ? (
            <View style={styles.safeBadge}>
              <Ionicons name="shield-checkmark" size={24} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.safeTitle}>Safe. Secure. Reliable.</Text>
                <Text style={styles.safeSub}>Your trusted gift card trading platform.</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.versionText}>App Version v{appVersion}</Text>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const StyleSheetAbsolute = { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000 };

const useStyles = makeStyles((colors) => ({
  overlay: { ...StyleSheetAbsolute, backgroundColor: colors.overlay },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: DRAWER_W,
    backgroundColor: colors.screenBgAlt,
    paddingHorizontal: spacing.lg,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg },
  brandLogo: { width: 54, height: 54 },
  brandTitle: { fontSize: 21, fontWeight: "800", color: colors.onSurface, lineHeight: 23 },
  brandTag: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  guestCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center", marginBottom: spacing.lg },
  guestAvatar: { width: 82, height: 82, borderRadius: 41, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  guestName: { fontSize: 21, fontWeight: "800", color: colors.onSurface },
  guestSub: { color: colors.muted, marginTop: 3, marginBottom: spacing.lg, fontSize: 13 },
  guestBtns: { flexDirection: "row", gap: spacing.md, width: "100%" },
  gBtn: { flex: 1, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  gBtnOutline: { borderWidth: 1.5, borderColor: colors.brandPrimary },
  profileCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.lg },
  profileAvatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  profileInitials: { color: colors.brandPrimary, fontWeight: "800", fontSize: 20 },
  profileName: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
  verifiedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  profileVerified: { color: colors.muted, fontSize: 13 },
  menuGroup: { backgroundColor: colors.surface, borderRadius: radius.xl, paddingHorizontal: spacing.lg, paddingVertical: 2 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 58, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowIcon: { width: 28, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  infoValue: { color: colors.muted, fontSize: 13 },
  safeBadge: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandSecondary, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.xl },
  safeTitle: { color: colors.brandPrimary, fontWeight: "800" },
  safeSub: { color: colors.muted, fontSize: 11.5, marginTop: 1 },
  versionText: { textAlign: "center", color: colors.muted, fontSize: 12.5, marginTop: spacing.xxl },
}));

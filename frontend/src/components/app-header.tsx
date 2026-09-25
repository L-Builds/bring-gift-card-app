import React from "react";
import { Text, View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { useSideMenu } from "@/src/components/side-menu";
import { useAuth } from "@/src/context/auth";
import { api } from "@/src/api/client";

export function AppHeader({
  title,
  greeting,
  showCurrency = false,
  showBell = true,
}: {
  title?: string;
  greeting?: { hi: string; name: string };
  showCurrency?: boolean;
  showBell?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { open } = useSideMenu();
  const { isGuest, user } = useAuth();

  const { data } = useQuery({
    queryKey: ["notif-unread"],
    queryFn: () => api.get<{ unread: number }>("/notifications"),
    enabled: !isGuest,
    refetchInterval: 20000,
  });
  const unread = data?.unread ?? 0;

  const onBell = () => {
    if (isGuest) router.push("/(auth)/login");
    else router.push("/notifications");
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable style={styles.iconBtn} onPress={open} testID="header-menu-button">
        <Ionicons name="menu" size={24} color={colors.onSurface} />
      </Pressable>

      <View style={styles.center}>
        {greeting ? (
          <Text style={styles.greeting}>
            {greeting.hi} <Text style={styles.greetingName}>{greeting.name}</Text>
          </Text>
        ) : (
          <Text style={styles.title}>{title}</Text>
        )}
      </View>

      <View style={styles.right}>
        {showCurrency && (
          <View style={styles.currency}>
            <View style={styles.flag}>
              <View style={{ flex: 1, backgroundColor: "#008751" }} />
              <View style={{ flex: 1, backgroundColor: "#FFFFFF" }} />
              <View style={{ flex: 1, backgroundColor: "#008751" }} />
            </View>
            <Text style={styles.currencyText}>{user?.currency || "NGN"}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.onSurface} />
          </View>
        )}
        {showBell && (
          <Pressable style={styles.iconBtn} onPress={onBell} testID="header-bell-button">
            <Ionicons name="notifications-outline" size={22} color={colors.onSurface} />
            {unread > 0 && <View style={styles.dot} />}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  center: { flex: 1 },
  title: { fontSize: 22, fontWeight: "800", color: colors.brandDeep },
  greeting: { fontSize: 20, color: colors.onSurface, fontWeight: "500" },
  greetingName: { fontWeight: "800", color: colors.brandDeep },
  right: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  currency: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    height: 40,
  },
  flag: { width: 22, height: 22, borderRadius: 11, overflow: "hidden", flexDirection: "row" },
  currencyText: { fontWeight: "700", color: colors.onSurface, fontSize: 14 },
  dot: {
    position: "absolute",
    top: 8,
    right: 10,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.error,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
}));

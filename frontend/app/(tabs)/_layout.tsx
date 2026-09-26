import React from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0];
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, spacing } from "@/src/theme";
import { useAuth } from "@/src/context/auth";

const PROTECTED = ["rates", "trade", "transactions", "profile"];

const TABS: { name: string; label: string; icon: any; iconActive: any }[] = [
  { name: "index", label: "Home", icon: "home-outline", iconActive: "home" },
  { name: "rates", label: "Rates", icon: "pricetags-outline", iconActive: "pricetags" },
  { name: "trade", label: "Trade", icon: "swap-horizontal", iconActive: "swap-horizontal" },
  { name: "transactions", label: "Transactions", icon: "receipt-outline", iconActive: "receipt" },
  { name: "profile", label: "Profile", icon: "person-outline", iconActive: "person" },
];

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isGuest } = useAuth();

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + 6 }]}>
      {TABS.map((tab, index) => {
        const isFocused = state.index === index;
        const isCenter = tab.name === "trade";

        const onPress = () => {
          if (isGuest && PROTECTED.includes(tab.name)) {
            router.push("/(auth)/login");
            return;
          }
          const event = navigation.emit({ type: "tabPress", target: state.routes[index].key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(state.routes[index].name);
          }
        };

        if (isCenter) {
          return (
            <View key={tab.name} style={styles.centerWrap}>
              <Pressable style={styles.centerBtn} onPress={onPress} testID="tab-trade">
                <Ionicons name="swap-horizontal" size={26} color={colors.onBrandPrimary} />
              </Pressable>
              <Text style={[styles.label, isFocused && styles.labelActive]}>{tab.label}</Text>
            </View>
          );
        }

        return (
          <Pressable key={tab.name} style={styles.item} onPress={onPress} testID={`tab-${tab.label.toLowerCase()}`}>
            <Ionicons name={isFocused ? tab.iconActive : tab.icon} size={24} color={isFocused ? colors.brandPrimary : colors.muted} />
            <Text style={[styles.label, isFocused && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="rates" />
      <Tabs.Screen name="trade" />
      <Tabs.Screen name="transactions" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-around",
    backgroundColor: colors.surface,
    paddingTop: spacing.sm,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  item: { flex: 1, alignItems: "center", gap: 4, paddingTop: 4 },
  centerWrap: { flex: 1, alignItems: "center", marginTop: -26 },
  centerBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: colors.surface,
    shadowColor: colors.brandPrimary,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    marginBottom: 2,
  },
  label: { fontSize: 11, color: colors.muted, fontWeight: "600" },
  labelActive: { color: colors.brandPrimary, fontWeight: "700" },
}));

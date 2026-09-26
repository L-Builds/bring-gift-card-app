import React from "react";
import { View, Text, Pressable, ScrollView, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, PrimaryButton } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { api } from "@/src/api/client";
import { formatNaira } from "@/src/lib/format";

export default function Wallet() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh } = useAuth();

  const { data, refetch, isRefetching } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => api.get<{ available_balance_kobo: number; payout_accounts_count: number }>("/wallet"),
  });

  const onRefresh = async () => {
    await Promise.all([refetch(), refresh()]);
  };

  return (
    <ScreenBackground>
      <StackHeader title="Wallet" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.lg }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        <LinearGradient colors={[colors.brandDeep, colors.brandPrimary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
          <Text style={styles.label}>Available Balance</Text>
          <Text style={styles.value} testID="wallet-balance">{formatNaira(data?.available_balance_kobo ?? 0)}</Text>
          <Text style={styles.currency}>Wallet • NGN</Text>
          <Ionicons name="wallet" size={96} color="rgba(255,255,255,0.12)" style={styles.bgIcon} />
        </LinearGradient>

        <PrimaryButton title="Withdraw" icon="arrow-forward" onPress={() => router.push("/withdraw")} testID="wallet-withdraw" />

        <Pressable style={styles.accountShortcut} onPress={() => router.push("/payout-accounts")} testID="wallet-accounts">
          <View style={styles.quickIcon}><Ionicons name="card" size={22} color={colors.brandPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickText}>Payout Accounts</Text>
            <Text style={styles.quickSub}>{data?.payout_accounts_count ?? 0} saved</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        <View style={styles.info}>
          <Ionicons name="information-circle" size={20} color={colors.brandPrimary} />
          <Text style={styles.infoText}>Only approved trade value is added to your Available Balance. Full activity stays in Transactions.</Text>
        </View>
      </ScrollView>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { borderRadius: radius.xxl, padding: spacing.xl, overflow: "hidden", minHeight: 172, justifyContent: "center" },
  label: { color: "rgba(255,255,255,0.9)", fontSize: 15 },
  value: { color: colors.onBrandPrimary, fontSize: 38, fontWeight: "800", marginTop: spacing.sm },
  currency: { color: "rgba(255,255,255,0.85)", marginTop: spacing.sm, fontSize: 13 },
  bgIcon: { position: "absolute", right: 18, bottom: 12 },
  accountShortcut: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, shadowColor: colors.shadow, shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  quickIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  quickText: { fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  quickSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  info: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.brandSecondary, borderRadius: radius.lg, padding: spacing.md, alignItems: "flex-start" },
  infoText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 },
}));

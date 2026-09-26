import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, BrandMonogram, LoadingView, EmptyState, PrimaryButton } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/api/client";

type Account = { id: string; provider_name: string; account_number: string; account_name: string };

export default function PayoutAccounts() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["payout-accounts"], queryFn: () => api.get<{ accounts: Account[] }>("/payout-accounts") });
  const accounts = data?.accounts ?? [];

  const remove = async (id: string) => {
    try {
      await api.del(`/payout-accounts/${id}`);
      qc.invalidateQueries({ queryKey: ["payout-accounts"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      toast.show("Account removed", "success");
    } catch {
      toast.show("Could not remove account", "error");
    }
  };

  return (
    <ScreenBackground>
      <StackHeader title="Manage Accounts" />
      {isLoading ? (
        <LoadingView />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + 112, gap: spacing.md }}>
          <View style={styles.headRow}>
            <Text style={styles.savedLabel}>Saved payout accounts</Text>
            {!!accounts.length && <View style={styles.countPill}><Text style={styles.countText}>{accounts.length} saved</Text></View>}
          </View>

          {accounts.length === 0 ? (
            <EmptyState icon="card-outline" title="No payout accounts" subtitle="Add a bank or supported payout account before withdrawing." />
          ) : (
            accounts.map((a) => (
              <View key={a.id} style={styles.card} testID={`account-${a.id}`}>
                <BrandMonogram name={a.provider_name} color={colors.brandPrimary} size={54} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{a.provider_name}</Text>
                  <Text style={styles.num}>{a.account_number}</Text>
                  <Text style={styles.holder}>{a.account_name}</Text>
                </View>
                <Pressable style={styles.delete} onPress={() => remove(a.id)} testID={`delete-account-${a.id}`}>
                  <Ionicons name="trash-outline" size={21} color={colors.error} />
                </Pressable>
              </View>
            ))
          )}

          <View style={styles.info}>
            <Ionicons name="information-circle" size={18} color={colors.brandPrimary} />
            <Text style={styles.infoText}>Use payout details you control and check them carefully before withdrawing.</Text>
          </View>
        </ScrollView>
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <PrimaryButton title="Add Bank Account" icon="add" onPress={() => router.push("/add-payout-account")} testID="add-account-btn" />
      </View>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  savedLabel: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  countPill: { backgroundColor: colors.brandSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  countText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 12 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, shadowColor: colors.shadow, shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  name: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  num: { fontSize: 15, fontWeight: "700", color: colors.onSurfaceSecondary, marginTop: 1 },
  holder: { fontSize: 13, color: colors.muted, marginTop: 2 },
  delete: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.errorBg, alignItems: "center", justifyContent: "center" },
  info: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.brandSecondary, borderRadius: radius.lg, padding: spacing.md },
  infoText: { flex: 1, color: colors.brandPrimary, fontWeight: "600", fontSize: 13, lineHeight: 18 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.screenBg },
}));

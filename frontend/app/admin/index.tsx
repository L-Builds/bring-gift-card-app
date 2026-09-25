import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, LoadingView } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { api } from "@/src/api/client";

type Stats = { pending_trades: number; pending_withdrawals: number; open_tickets: number };

export default function AdminHome() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAdmin, loading } = useAuth();

  const { data, isLoading } = useQuery({ queryKey: ["admin-stats"], queryFn: () => api.get<Stats>("/admin/stats"), enabled: isAdmin });

  if (loading) return <ScreenBackground><LoadingView /></ScreenBackground>;
  if (!isAdmin) return <Redirect href="/(tabs)" />;

  const Stat = ({ icon, label, value, color }: any) => (
    <View style={styles.stat}>
      <View style={[styles.statIcon, { backgroundColor: color + "22" }]}><Ionicons name={icon} size={22} color={color} /></View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  const Link = ({ icon, title, sub, onPress, badge }: any) => (
    <Pressable style={styles.link} onPress={onPress} testID={`admin-link-${title.toLowerCase().replace(/\s/g, "-")}`}>
      <View style={styles.linkIcon}><Ionicons name={icon} size={24} color={colors.brandPrimary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.linkTitle}>{title}</Text>
        <Text style={styles.linkSub}>{sub}</Text>
      </View>
      {badge > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>}
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );

  return (
    <ScreenBackground>
      <StackHeader title="Admin Panel" onBack={() => router.replace("/(tabs)/profile")} />
      {isLoading ? (
        <LoadingView />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.lg }}>
          <View style={styles.statRow}>
            <Stat icon="time" label="Pending trades" value={data?.pending_trades ?? 0} color={colors.warning} />
            <Stat icon="cash" label="Pending payouts" value={data?.pending_withdrawals ?? 0} color={colors.brandPrimary} />
          </View>
          <View style={styles.statRow}>
            <Stat icon="chatbubbles" label="Open support" value={data?.open_tickets ?? 0} color={colors.info} />
          </View>

          <Text style={styles.sectionTitle}>Core operations</Text>
          <Link icon="swap-horizontal" title="Trade Queue" sub="Review submitted gift-card trades" badge={data?.pending_trades ?? 0} onPress={() => router.push("/admin/trades")} />
          <Link icon="cash-outline" title="Withdrawals" sub="Process the company payout workflow" badge={data?.pending_withdrawals ?? 0} onPress={() => router.push("/admin/withdrawals")} />
          <Link icon="pricetags-outline" title="Catalog & Rates" sub="Update availability and payout rates" onPress={() => router.push("/admin/catalog")} />

          <Link icon="globe-outline" title="Countries & Currencies" sub="Manage supported payout markets" onPress={() => router.push("/admin/markets")} />
          <Link icon="settings-outline" title="Payout Providers" sub="Company, Paystack, Flutterwave and additional providers" onPress={() => router.push("/admin/payout-providers")} />
          <Link icon="shield-checkmark-outline" title="Production Setup" sub="Readiness and company legal documents" onPress={() => router.push("/admin/production")} />
          <Text style={styles.sectionTitle}>Customer operations</Text>
          <Link icon="people-outline" title="Customers" sub="Review customer account activity" onPress={() => router.push("/admin/customers")} />
          <Link icon="chatbubbles-outline" title="Support Tickets" sub="Reply to customer support cases" badge={data?.open_tickets ?? 0} onPress={() => router.push("/admin/support")} />
        </ScrollView>
      )}
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  statRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: 4 },
  statIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statValue: { fontSize: 26, fontWeight: "800", color: colors.onSurface },
  statLabel: { color: colors.muted, fontSize: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  link: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg },
  linkIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  linkTitle: { fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  linkSub: { color: colors.muted, fontSize: 12, marginTop: 1 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: colors.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: colors.onError, fontWeight: "800", fontSize: 12 },
}));

import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, LoadingView, QueryErrorView } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { api } from "@/src/api/client";
import { canManageSettings, canManageStaff, canWorkIn } from "@/src/lib/staff-access";

type Stats = { pending_trades: number; pending_withdrawals: number; open_tickets: number };
type IconName = React.ComponentProps<typeof Ionicons>["name"];

function AdminStat({ icon, label, value, color }: { icon: IconName; label: string; value: number; color: string }) {
  const styles = useStyles();
  return <View style={styles.stat}>
    <View style={[styles.statIcon, { backgroundColor: color + "22" }]}><Ionicons name={icon} size={22} color={color} /></View>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>;
}

function AdminLink({ icon, title, sub, onPress, badge }: { icon: IconName; title: string; sub: string; onPress: () => void; badge?: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return <Pressable style={styles.link} onPress={onPress} testID={`admin-link-${title.toLowerCase().replace(/\s/g, "-")}`}>
    <View style={styles.linkIcon}><Ionicons name={icon} size={24} color={colors.brandPrimary} /></View>
    <View style={{ flex: 1 }}>
      <Text style={styles.linkTitle}>{title}</Text>
      <Text style={styles.linkSub}>{sub}</Text>
    </View>
    {!!badge && badge > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>}
    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
  </Pressable>;
}

export default function AdminHome() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAdmin, loading, user } = useAuth();
  const showSummary = user?.staff_role !== "worker";

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({ queryKey: ["admin-stats"], queryFn: () => api.get<Stats>("/admin/stats"), enabled: isAdmin && showSummary });

  if (loading) return <ScreenBackground><LoadingView /></ScreenBackground>;
  if (!isAdmin) return <Redirect href="/(tabs)" />;

  return (
    <ScreenBackground>
      <StackHeader title="Admin Panel" onBack={() => router.replace("/(tabs)/profile")} />
      {showSummary && isLoading ? (
        <LoadingView />
      ) : showSummary && (isError || !data) ? (
        <QueryErrorView title="Operations unavailable" subtitle="We could not verify the current trade, payout and support queues." onRetry={() => { void refetch(); }} retrying={isRefetching} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.lg }}>
          {showSummary && data && <>
          <View style={styles.statRow}>
            <AdminStat icon="time" label="Pending trades" value={data.pending_trades} color={colors.warning} />
            <AdminStat icon="cash" label="Pending payouts" value={data.pending_withdrawals} color={colors.brandPrimary} />
          </View>
          <View style={styles.statRow}>
            <AdminStat icon="chatbubbles" label="Open support" value={data.open_tickets} color={colors.info} />
          </View>
          </>}

          <Text style={styles.sectionTitle}>Core operations</Text>
          {canWorkIn(user, "trades") && <AdminLink icon="swap-horizontal" title="Trade Queue" sub="Review submitted gift-card trades" badge={data?.pending_trades} onPress={() => router.push("/admin/trades")} />}
          {canWorkIn(user, "withdrawals") && <AdminLink icon="cash-outline" title="Withdrawals" sub="Process the company payout workflow" badge={data?.pending_withdrawals} onPress={() => router.push("/admin/withdrawals")} />}
          {canManageSettings(user) && <>
          <AdminLink icon="pricetags-outline" title="Catalog & Rates" sub="Update availability and payout rates" onPress={() => router.push("/admin/catalog")} />

          <AdminLink icon="globe-outline" title="Countries & Currencies" sub="Manage supported payout markets" onPress={() => router.push("/admin/markets")} />
          <AdminLink icon="settings-outline" title="Payout Providers" sub="Company, Paystack, Flutterwave and additional providers" onPress={() => router.push("/admin/payout-providers")} />
          <AdminLink icon="shield-checkmark-outline" title="Production Setup" sub="Readiness and company legal documents" onPress={() => router.push("/admin/production")} />
          </>}
          {canManageStaff(user) && <AdminLink icon="people-circle-outline" title="Staff" sub="Create managers and assign worker access" onPress={() => router.push("/admin/staff")} />}
          <Text style={styles.sectionTitle}>Customer operations</Text>
          {canWorkIn(user, "customers") && <AdminLink icon="people-outline" title="Customers" sub="Review customer account activity" onPress={() => router.push("/admin/customers")} />}
          {canWorkIn(user, "support") && <AdminLink icon="chatbubbles-outline" title="Support Tickets" sub="Reply to customer support cases" badge={data?.open_tickets} onPress={() => router.push("/admin/support")} />}
          {user?.staff_role === "worker" && !user.staff_permissions?.length && <Text style={styles.linkSub}>Your manager has not assigned an operations area yet.</Text>}
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

import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";

import { useAuth } from "@/src/context/auth";
import { api } from "@/src/api/client";
import { canManageSettings, canWorkIn } from "@/src/lib/staff-access";
import { formatDate, formatDateTime, formatMoney } from "@/src/lib/format";
import { EmptyState, StatusBadge } from "@/src/components/ui";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Stats = {
  pending_trades: number;
  pending_withdrawals: number;
  open_tickets: number;
  total_customers: number;
  total_brands: number;
};
type Trade = {
  id: string;
  order_id: string;
  customer_name: string;
  brand_name: string;
  card_value_usd: number;
  quantity: number;
  expected_payout_kobo: number;
  currency?: string;
  minor_digits?: number;
  status: string;
  created_at: string;
};
type RateActivity = {
  action: string;
  target: string;
  version: number;
  at: string;
  brand_name: string;
  market?: { name: string; currency: string; minor_digits: number };
  rate?: { face_value: number; payout_minor: number };
};
type IconName = React.ComponentProps<typeof Ionicons>["name"];
type Queue = { label: string; key: keyof Pick<Stats, "pending_trades" | "pending_withdrawals" | "open_tickets">; href: string; icon: IconName; description: string };

const queues: Queue[] = [
  { label: "Pending trades", key: "pending_trades", href: "/admin/trades", icon: "swap-horizontal-outline", description: "Trades awaiting review" },
  { label: "Payout requests", key: "pending_withdrawals", href: "/admin/withdrawals", icon: "cash-outline", description: "Withdrawals to process" },
  { label: "Open support", key: "open_tickets", href: "/admin/support", icon: "chatbubbles-outline", description: "Customer conversations" },
];
const scopeForHref: Record<string, "trades" | "withdrawals" | "support" | "customers"> = {
  "/admin/trades": "trades", "/admin/withdrawals": "withdrawals",
  "/admin/support": "support", "/admin/customers": "customers",
};

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default function AdminHome() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { loading, isAdmin, user } = useAuth();
  const management = canManageSettings(user);
  const canReviewTrades = canWorkIn(user, "trades");
  const assigned = Object.values(scopeForHref).filter((scope) => canWorkIn(user, scope));
  const firstName = (user?.full_name?.trim() || user?.email?.split("@")[0] || "there").split(/\s+/)[0];
  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get<Stats>("/admin/stats"),
    enabled: isAdmin && management,
  });
  const trades = useQuery({
    queryKey: ["admin-dashboard-trades"],
    queryFn: () => api.get<{ trades: Trade[] }>("/admin/trades?limit=8"),
    enabled: isAdmin && canReviewTrades,
    refetchInterval: 30000,
  });
  const activity = useQuery({
    queryKey: ["denomination-history"],
    queryFn: () => api.get<{ changes: RateActivity[] }>("/admin/denomination-history"),
    enabled: isAdmin && management,
    refetchInterval: 60000,
  });

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  if (!isAdmin) return <Redirect href="/(tabs)" />;

  const queueWidth = width >= 1100 ? "31.5%" : width >= 700 ? "48%" : "100%";
  const tools = [
    { label: "Trades", href: "/admin/trades", icon: "swap-horizontal-outline" as IconName },
    { label: "Withdrawals", href: "/admin/withdrawals", icon: "cash-outline" as IconName },
    { label: "Customers", href: "/admin/customers", icon: "people-outline" as IconName },
    { label: "Support", href: "/admin/support", icon: "chatbubbles-outline" as IconName },
    ...(management ? [
      { label: "Catalog", href: "/admin/catalog", icon: "albums-outline" as IconName },
      { label: "Rates", href: "/admin/rates", icon: "pricetags-outline" as IconName },
    ] : []),
  ].filter((item) => !scopeForHref[item.href] || canWorkIn(user, scopeForHref[item.href]));

  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: width < 640 ? spacing.lg : spacing.xxl, paddingBottom: insets.bottom + spacing.xxxl }]} showsVerticalScrollIndicator={false}>
      <View style={styles.greetingRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>COMPANY WORKSPACE</Text>
          <Text style={styles.greeting}>{greeting()}, {firstName}</Text>
          <Text style={styles.subtitle}>Here is what needs attention in Bring Gift Card.</Text>
        </View>
        <Pressable onPress={() => { void stats.refetch(); void trades.refetch(); }} accessibilityRole="button" accessibilityLabel="Refresh dashboard" style={styles.refreshButton}>
          <Ionicons name="refresh-outline" size={18} color={colors.brandPrimary} />
          {width >= 640 && <Text style={styles.refreshText}>Refresh</Text>}
        </Pressable>
      </View>

      {management && <View>
        <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>At a glance</Text><Text style={styles.sectionHint}>Automatically checks for updates</Text></View>
        <View style={styles.statGrid}>
          {queues.map((queue) => <Pressable
            key={queue.key} onPress={() => router.push(queue.href as never)} accessibilityRole="link" accessibilityLabel={queue.label}
            testID={`admin-stat-${queue.key}`}
            style={({ pressed }) => [styles.statCard, { width: queueWidth }, pressed && styles.pressed]}
          >
            <View style={styles.statTop}><View style={styles.statIcon}><Ionicons name={queue.icon} size={22} color={colors.brandPrimary} /></View><Ionicons name="arrow-forward" size={17} color={colors.muted} /></View>
            <Text style={styles.statValue}>{stats.isLoading && !stats.data ? "…" : stats.data ? stats.data[queue.key].toLocaleString() : "—"}</Text>
            <Text style={styles.statLabel}>{queue.label}</Text>
            <Text style={styles.statDescription}>{queue.description}</Text>
          </Pressable>)}
        </View>
        {stats.isError && <View style={styles.errorRow}><Text style={styles.errorText}>Queue totals are unavailable.</Text><Pressable onPress={() => { void stats.refetch(); }} accessibilityRole="button"><Text style={styles.retryText}>Retry</Text></Pressable></View>}
      </View>}

      {user?.staff_role === "worker" && assigned.length === 0 && <View style={styles.panel}>
        <EmptyState icon="person-circle-outline" title="No workspace assigned yet" subtitle="Your manager can assign Trades, Withdrawals, Customers, or Support from Staff." />
      </View>}

      {canReviewTrades && <View style={styles.panel}>
        <View style={styles.panelHeading}>
          <View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Recent trades</Text><Text style={styles.panelSub}>The latest submitted trades</Text></View>
          <Pressable onPress={() => router.push("/admin/trades")} accessibilityRole="link" accessibilityLabel="View all trades" style={styles.viewAll}><Text style={styles.viewAllText}>View all</Text><Ionicons name="arrow-forward" size={15} color={colors.brandPrimary} /></Pressable>
        </View>
        {trades.isLoading && !trades.data ? <View style={styles.inlineState}><ActivityIndicator color={colors.brandPrimary} /><Text style={styles.panelSub}>Loading trades…</Text></View>
          : trades.isError ? <View style={styles.inlineState}><Text style={styles.errorText}>Recent trades could not be loaded.</Text><Pressable onPress={() => { void trades.refetch(); }} accessibilityRole="button"><Text style={styles.retryText}>Try again</Text></Pressable></View>
          : !trades.data?.trades.length ? <EmptyState icon="receipt-outline" title="No trades yet" subtitle="Submitted trades will appear here." />
          : width >= 820 ? <View>
            <View style={styles.tableHeader}><Text style={[styles.columnTitle, styles.orderColumn]}>ORDER</Text><Text style={[styles.columnTitle, styles.customerColumn]}>CUSTOMER</Text><Text style={[styles.columnTitle, styles.cardColumn]}>CARD</Text><Text style={[styles.columnTitle, styles.amountColumn]}>PAYOUT</Text><Text style={[styles.columnTitle, styles.statusColumn]}>STATUS</Text></View>
            {trades.data.trades.slice(0, 6).map((trade) => <Pressable key={trade.id} onPress={() => router.push(`/admin/trade/${trade.id}`)} accessibilityRole="link" accessibilityLabel={`Open trade ${trade.order_id}`} style={({ pressed }) => [styles.tableRow, pressed && styles.pressed]}>
              <View style={styles.orderColumn}><Text style={styles.rowMain} numberOfLines={1}>{trade.order_id}</Text><Text style={styles.rowSub}>{formatDate(trade.created_at)}</Text></View>
              <Text style={[styles.rowMain, styles.customerColumn]} numberOfLines={1}>{trade.customer_name || "Customer"}</Text>
              <Text style={[styles.rowMain, styles.cardColumn]} numberOfLines={1}>{trade.brand_name} · ${trade.card_value_usd} × {trade.quantity}</Text>
              <Text style={[styles.rowMain, styles.amountColumn]} numberOfLines={1}>{formatMoney(trade.expected_payout_kobo, trade.currency || "NGN", trade.minor_digits ?? 2)}</Text>
              <View style={styles.statusColumn}><StatusBadge status={trade.status} /></View>
            </Pressable>)}
          </View>
          : <View>{trades.data.trades.slice(0, 6).map((trade) => <Pressable key={trade.id} onPress={() => router.push(`/admin/trade/${trade.id}`)} accessibilityRole="link" accessibilityLabel={`Open trade ${trade.order_id}`} style={({ pressed }) => [styles.mobileTrade, pressed && styles.pressed]}>
            <View style={{ flex: 1 }}><Text style={styles.rowMain}>{trade.brand_name} · ${trade.card_value_usd} × {trade.quantity}</Text><Text style={styles.rowSub}>{trade.order_id} · {trade.customer_name || "Customer"}</Text><Text style={styles.rowSub}>{formatDate(trade.created_at)}</Text></View>
            <View style={styles.mobileTradeRight}><Text style={styles.rowMain}>{formatMoney(trade.expected_payout_kobo, trade.currency || "NGN", trade.minor_digits ?? 2)}</Text><StatusBadge status={trade.status} /></View>
          </Pressable>)}</View>}
      </View>}

      {management && <View style={styles.panel}>
        <View style={styles.panelHeading}>
          <View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Recent activity</Text><Text style={styles.panelSub}>Catalog rate updates recorded by the system</Text></View>
          <Pressable onPress={() => router.push("/admin/rate-history")} accessibilityRole="link" accessibilityLabel="View rate history" style={styles.viewAll}><Text style={styles.viewAllText}>Rate history</Text><Ionicons name="arrow-forward" size={15} color={colors.brandPrimary} /></Pressable>
        </View>
        {activity.isLoading && !activity.data ? <View style={styles.inlineState}><ActivityIndicator color={colors.brandPrimary} /><Text style={styles.panelSub}>Loading activity…</Text></View>
          : activity.isError ? <View style={styles.inlineState}><Text style={styles.errorText}>Rate activity is unavailable.</Text><Pressable onPress={() => { void activity.refetch(); }} accessibilityRole="button"><Text style={styles.retryText}>Try again</Text></Pressable></View>
          : !activity.data?.changes.length ? <View style={styles.inlineState}><Text style={styles.panelSub}>No rate changes recorded yet.</Text></View>
          : activity.data.changes.slice(0, 4).map((change, index) => <View key={`${change.target}:${change.version}:${index}`} style={styles.activityRow}>
            <View style={styles.activityIcon}><Ionicons name={change.action === "rate.disabled" ? "remove-circle-outline" : "pricetag-outline"} size={18} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}><Text style={styles.rowMain}>{change.brand_name} · {change.action === "rate.disabled" ? "Rate disabled" : "Rate updated"}</Text>
              <Text style={styles.rowSub}>{change.market?.name || "Market"}{change.rate ? ` · $${change.rate.face_value} → ${formatMoney(change.rate.payout_minor, change.market?.currency || "NGN", change.market?.minor_digits ?? 2)}` : ""}</Text>
            </View>
            <Text style={styles.activityTime}>{formatDateTime(change.at)}</Text>
          </View>)}
      </View>}

      {tools.length > 0 && <View style={styles.panel}>
        <View style={styles.panelHeading}><Text style={styles.sectionTitle}>Your tools</Text></View>
        <View style={styles.toolGrid}>{tools.map((item) => <Pressable key={item.href} onPress={() => router.push(item.href as never)} accessibilityRole="link" accessibilityLabel={item.label} style={({ pressed }) => [styles.tool, pressed && styles.pressed]}>
          <Ionicons name={item.icon} size={19} color={colors.brandPrimary} /><Text style={styles.toolText}>{item.label}</Text><Ionicons name="chevron-forward" size={15} color={colors.muted} />
        </Pressable>)}</View>
      </View>}
    </ScrollView>
  </View>;
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.screenBgAlt },
  loading: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: c.screenBgAlt },
  content: { width: "100%", maxWidth: 1440, alignSelf: "center", paddingTop: spacing.xxl, gap: spacing.xxl },
  greetingRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  eyebrow: { color: c.brandPrimary, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  greeting: { color: c.onSurface, fontSize: 27, fontWeight: "800", marginTop: 4 },
  subtitle: { color: c.onSurfaceSecondary, fontSize: 13, marginTop: 5 },
  refreshButton: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md },
  refreshText: { color: c.brandPrimary, fontSize: 12, fontWeight: "700" },
  sectionHeading: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: spacing.md },
  sectionTitle: { color: c.onSurface, fontSize: 16, fontWeight: "800" },
  sectionHint: { color: c.muted, fontSize: 11 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.md },
  statCard: { minWidth: 200, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: spacing.lg },
  statTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.brandSecondary, alignItems: "center", justifyContent: "center" },
  statValue: { color: c.onSurface, fontSize: 30, fontWeight: "800", marginTop: spacing.md },
  statLabel: { color: c.onSurface, fontSize: 13, fontWeight: "800", marginTop: 2 },
  statDescription: { color: c.muted, fontSize: 11, marginTop: 3 },
  errorRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  errorText: { color: c.error, fontSize: 12 }, retryText: { color: c.brandPrimary, fontSize: 12, fontWeight: "800" },
  panel: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 16, overflow: "hidden" },
  panelHeading: { padding: spacing.lg, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: c.divider, gap: spacing.md },
  panelSub: { color: c.muted, fontSize: 11, marginTop: 3 },
  viewAll: { flexDirection: "row", alignItems: "center", gap: 5, padding: spacing.sm }, viewAllText: { color: c.brandPrimary, fontSize: 12, fontWeight: "800" },
  inlineState: { minHeight: 120, flexDirection: "row", gap: spacing.md, justifyContent: "center", alignItems: "center" },
  tableHeader: { minHeight: 34, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, backgroundColor: c.surfaceSecondary, gap: spacing.md },
  columnTitle: { color: c.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  tableRow: { minHeight: 62, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: c.divider, gap: spacing.md },
  orderColumn: { flex: 1.2, minWidth: 100 }, customerColumn: { flex: 1.2, minWidth: 100 },
  cardColumn: { flex: 1.4, minWidth: 130 }, amountColumn: { flex: 1.1, minWidth: 100 }, statusColumn: { flex: 1, minWidth: 100 },
  rowMain: { color: c.onSurface, fontSize: 12, fontWeight: "700" }, rowSub: { color: c.muted, fontSize: 11, marginTop: 4 },
  mobileTrade: { flexDirection: "row", padding: spacing.lg, gap: spacing.md, borderTopWidth: 1, borderTopColor: c.divider },
  mobileTradeRight: { alignItems: "flex-end", gap: 7 },
  activityRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: c.divider },
  activityIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: c.brandSecondary },
  activityTime: { color: c.muted, fontSize: 11 },
  toolGrid: { flexDirection: "row", flexWrap: "wrap", padding: spacing.md, gap: spacing.sm },
  tool: { minWidth: 160, flexGrow: 1, flexBasis: "28%", flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: 10, backgroundColor: c.surfaceSecondary },
  toolText: { color: c.onSurface, fontSize: 12, fontWeight: "700", flex: 1 },
  pressed: { opacity: 0.72 },
}));

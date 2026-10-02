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
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Stats = {
  pending_trades: number;
  pending_withdrawals: number;
  open_tickets: number;
  pending_kyc: number;
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

function rateActionLabel(action: string) {
  return action === "rate.disabled" ? "disabled"
    : action === "rate.archived" ? "archived"
    : action === "rate.deleted" ? "removed" : "updated";
}

function rateActivityDetail(change: RateActivity) {
  if (!change.rate) return change.market?.name || "Market unavailable";
  const payout = change.market && typeof change.rate.payout_minor === "number"
    ? formatMoney(change.rate.payout_minor, change.market.currency, change.market.minor_digits)
    : "Payout unavailable";
  return `${change.market?.name || "Market"} · $${change.rate.face_value} card · ${payout} payout`;
}
type IconName = React.ComponentProps<typeof Ionicons>["name"];
type Scope = "trades" | "withdrawals" | "support" | "customers";
type QueueItem = {
  label: string;
  shortLabel: string;
  key: keyof Pick<Stats, "pending_trades" | "pending_withdrawals" | "open_tickets" | "pending_kyc">;
  href: string;
  icon: IconName;
  description: string;
  scope: Scope;
  actionable: boolean;
};

const queueItems: QueueItem[] = [
  { label: "Pending trades", shortLabel: "Trades", key: "pending_trades", href: "/admin/trades", icon: "swap-horizontal-outline", description: "Awaiting review", scope: "trades", actionable: true },
  { label: "Payout requests", shortLabel: "Withdrawals", key: "pending_withdrawals", href: "/admin/withdrawals", icon: "cash-outline", description: "Pending or processing", scope: "withdrawals", actionable: true },
  { label: "Open support", shortLabel: "Support", key: "open_tickets", href: "/admin/support", icon: "chatbubbles-outline", description: "Open customer tickets", scope: "support", actionable: true },
  { label: "Verification", shortLabel: "Verification", key: "pending_kyc", href: "/admin/verification", icon: "shield-checkmark-outline", description: "Verification is paused for this release", scope: "customers", actionable: false },
];

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
  const visibleQueues = queueItems.filter((item) => canWorkIn(user, item.scope));
  const actionableQueues = visibleQueues.filter((item) => item.actionable);
  const assignedScopes = ["trades", "withdrawals", "customers", "support"].filter((scope) => canWorkIn(user, scope as Scope));
  const firstName = (user?.full_name?.trim() || user?.email?.split("@")[0] || "there").split(/\s+/)[0];

  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get<Stats>("/admin/stats"),
    enabled: isAdmin,
    refetchInterval: 15000,
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

  const compactMetrics = width < 700;
  const desktopWorkspace = width >= 1080;
  const metricWidth = width >= 1180 ? "24%" : width >= 720 ? "48.7%" : "100%";
  const attention = actionableQueues
    .map((item) => ({ ...item, count: stats.data?.[item.key] ?? 0 }))
    .filter((item) => item.count > 0);

  const refresh = () => {
    void stats.refetch();
    if (canReviewTrades) void trades.refetch();
    if (management) void activity.refetch();
  };

  return <View style={styles.screen}>
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingHorizontal: width < 640 ? spacing.lg : spacing.xxl, paddingBottom: insets.bottom + spacing.xxxl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.pageHeading}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eyebrow}>OPERATIONS</Text>
          <Text style={styles.greeting}>{greeting()}, {firstName}</Text>
          <Text style={styles.subtitle}>A live view of the work your team needs to handle.</Text>
        </View>
        <Pressable onPress={refresh} accessibilityRole="button" accessibilityLabel="Refresh dashboard" style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
          <Ionicons name="refresh-outline" size={17} color={colors.brandPrimary} />
          {!compactMetrics && <Text style={styles.secondaryButtonText}>Refresh</Text>}
        </Pressable>
      </View>

      <View>
        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionTitle}>Work summary</Text>
            <Text style={styles.sectionHint}>Counts come from the live production queues you can access.</Text>
          </View>
          {stats.isFetching && <Text style={styles.syncText}>Updating…</Text>}
        </View>
        {stats.isError && !stats.data ? <View style={styles.inlineNotice}>
          <Text style={styles.errorText}>Work totals are unavailable.</Text>
          <Pressable onPress={() => { void stats.refetch(); }} accessibilityRole="button"><Text style={styles.linkText}>Retry</Text></Pressable>
        </View> : <View style={styles.metricGrid}>
          {visibleQueues.map((item) => {
            const count = stats.data?.[item.key];
            return <Pressable
              key={item.key}
              onPress={() => router.push(item.href as never)}
              accessibilityRole="link"
              accessibilityLabel={item.label}
              testID={`admin-stat-${item.key}`}
              style={({ pressed }) => [styles.metric, { width: metricWidth }, pressed && styles.pressed]}
            >
              <View style={styles.metricLabelRow}>
                <Ionicons name={item.icon} size={18} color={colors.brandPrimary} />
                <Text style={styles.metricLabel}>{item.shortLabel}</Text>
                <Ionicons name="chevron-forward" size={15} color={colors.muted} style={{ marginLeft: "auto" }} />
              </View>
              <Text style={styles.metricValue}>{stats.isLoading && count == null ? "…" : (count ?? 0).toLocaleString()}</Text>
              <Text style={styles.metricDescription}>{item.description}</Text>
            </Pressable>;
          })}
        </View>}
      </View>

      {user?.staff_role === "worker" && assignedScopes.length === 0 && <View style={styles.sectionSurface}>
        <EmptyState icon="person-circle-outline" title="No workspace assigned yet" subtitle="Your manager can assign Trades, Withdrawals, Customers, or Support from Staff." />
      </View>}

      <View style={[styles.workspaceGrid, desktopWorkspace && styles.workspaceGridDesktop]}>
        {canReviewTrades && <View style={[styles.sectionSurface, styles.recentTradesPanel, desktopWorkspace && { flex: 1.8 }]}>
          <View style={styles.sectionBar}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.sectionTitle}>Recent trades</Text>
              <Text style={styles.sectionHint}>Latest submissions across the trade queue.</Text>
            </View>
            <Pressable onPress={() => router.push("/admin/trades")} accessibilityRole="link" accessibilityLabel="View all trades" style={styles.textLink}>
              <Text style={styles.linkText}>View all</Text><Ionicons name="arrow-forward" size={14} color={colors.brandPrimary} />
            </Pressable>
          </View>
          {trades.isLoading && !trades.data ? <View style={styles.loadingRow}><ActivityIndicator color={colors.brandPrimary} /><Text style={styles.sectionHint}>Loading trades…</Text></View>
            : trades.isError ? <View style={styles.loadingRow}><Text style={styles.errorText}>Recent trades could not be loaded.</Text><Pressable onPress={() => { void trades.refetch(); }}><Text style={styles.linkText}>Try again</Text></Pressable></View>
            : !trades.data?.trades.length ? <EmptyState icon="receipt-outline" title="No trades yet" subtitle="Submitted trades will appear here." />
            : width >= 820 ? <View>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeading, styles.orderColumn]}>Order</Text>
                <Text style={[styles.tableHeading, styles.customerColumn]}>Customer</Text>
                <Text style={[styles.tableHeading, styles.cardColumn]}>Card</Text>
                <Text style={[styles.tableHeading, styles.amountColumn]}>Payout</Text>
                <Text style={[styles.tableHeading, styles.statusColumn]}>Status</Text>
              </View>
              {trades.data.trades.slice(0, 6).map((trade) => <Pressable
                key={trade.id}
                onPress={() => router.push(`/admin/trade/${trade.id}`)}
                accessibilityRole="link"
                accessibilityLabel={`Open trade ${trade.order_id}`}
                style={({ pressed }) => [styles.tableRow, pressed && styles.rowPressed]}
              >
                <View style={styles.orderColumn}><Text style={styles.rowMain} numberOfLines={1}>{trade.order_id}</Text><Text style={styles.rowSub}>{formatDate(trade.created_at)}</Text></View>
                <Text style={[styles.rowMain, styles.customerColumn]} numberOfLines={1}>{trade.customer_name || "Customer"}</Text>
                <Text style={[styles.rowMain, styles.cardColumn]} numberOfLines={1}>{trade.brand_name} · ${trade.card_value_usd} × {trade.quantity}</Text>
                <Text style={[styles.rowMain, styles.amountColumn]} numberOfLines={1}>{formatMoney(trade.expected_payout_kobo, trade.currency || "NGN", trade.minor_digits ?? 2)}</Text>
                <View style={styles.statusColumn}><StatusBadge status={trade.status} /></View>
              </Pressable>)}
            </View>
            : <View>{trades.data.trades.slice(0, 6).map((trade) => <Pressable
              key={trade.id}
              onPress={() => router.push(`/admin/trade/${trade.id}`)}
              accessibilityRole="link"
              accessibilityLabel={`Open trade ${trade.order_id}`}
              style={({ pressed }) => [styles.mobileRow, pressed && styles.rowPressed]}
            >
              <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.rowMain}>{trade.brand_name} · ${trade.card_value_usd} × {trade.quantity}</Text><Text style={styles.rowSub}>{trade.order_id} · {trade.customer_name || "Customer"}</Text><Text style={styles.rowSub}>{formatDate(trade.created_at)}</Text></View>
              <View style={styles.mobileRowRight}><Text style={styles.rowMain}>{formatMoney(trade.expected_payout_kobo, trade.currency || "NGN", trade.minor_digits ?? 2)}</Text><StatusBadge status={trade.status} /></View>
            </Pressable>)}</View>}
        </View>}

        <View style={[styles.sectionSurface, desktopWorkspace && { flex: 1 }]} testID="admin-attention-needed">
          <View style={styles.sectionBar}>
            <View>
              <Text style={styles.sectionTitle}>Attention needed</Text>
              <Text style={styles.sectionHint}>Only actionable work appears here.</Text>
            </View>
          </View>
          {stats.isLoading && !stats.data ? <View style={styles.loadingRow}><ActivityIndicator color={colors.brandPrimary} /></View>
            : stats.isError && !stats.data ? <View style={styles.loadingRow}><Text style={styles.errorText}>Attention queues are unavailable.</Text></View>
            : attention.length === 0 ? <View style={styles.clearState}>
              <View style={styles.clearIcon}><Ionicons name="checkmark" size={18} color={colors.success} /></View>
              <View style={{ flex: 1 }}><Text style={styles.clearTitle}>Queues are clear</Text><Text style={styles.rowSub}>No assigned work currently needs action.</Text></View>
            </View>
            : attention.map((item) => <Pressable key={item.key} onPress={() => router.push(item.href as never)} accessibilityRole="link" style={({ pressed }) => [styles.attentionRow, pressed && styles.rowPressed]}>
              <View style={styles.attentionIcon}><Ionicons name={item.icon} size={18} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.rowMain}>{item.label}</Text><Text style={styles.rowSub}>{item.description}</Text></View>
              <Text style={styles.attentionCount}>{item.count}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>)}
          {visibleQueues.some((item) => item.key === "pending_kyc") && <View style={styles.verificationNote}>
            <Ionicons name="information-circle-outline" size={17} color={colors.muted} />
            <Text style={styles.verificationText}>Verification remains available in the workspace but is paused as a required customer step for this release.</Text>
          </View>}
        </View>
      </View>

      {management && <View style={styles.sectionSurface} testID="admin-recent-activity">
        <View style={styles.sectionBar}>
          <View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Recent activity</Text><Text style={styles.sectionHint}>Recent changes to earlier per-card denomination rates.</Text></View>
          <Pressable onPress={() => router.push("/admin/rate-history")} accessibilityRole="link" accessibilityLabel="View rate history" style={styles.textLink}><Text style={styles.linkText}>Rate history</Text><Ionicons name="arrow-forward" size={14} color={colors.brandPrimary} /></Pressable>
        </View>
        {activity.isLoading && !activity.data ? <View style={styles.loadingRow}><ActivityIndicator color={colors.brandPrimary} /><Text style={styles.sectionHint}>Loading activity…</Text></View>
          : activity.isError ? <View style={styles.loadingRow}><Text style={styles.errorText}>Rate activity is unavailable.</Text><Pressable onPress={() => { void activity.refetch(); }}><Text style={styles.linkText}>Try again</Text></Pressable></View>
          : !activity.data?.changes.length ? <View style={styles.emptyCompact}><Text style={styles.sectionHint}>No rate changes have been recorded yet.</Text></View>
          : activity.data.changes.slice(0, 5).map((change, index) => <View key={`${change.target}:${change.version}:${index}`} style={styles.activityRow}>
            <View style={styles.activityMarker}><View style={styles.activityDot} />{index < Math.min(4, activity.data.changes.length - 1) && <View style={styles.activityLine} />}</View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.rowMain}>{change.brand_name} · Rate {rateActionLabel(change.action)}</Text>
              <Text style={styles.rowSub}>{rateActivityDetail(change)}</Text>
            </View>
            <Text style={styles.activityTime}>{formatDateTime(change.at)}</Text>
          </View>)}
      </View>}
    </ScrollView>
  </View>;
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.screenBgAlt },
  loading: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: c.screenBgAlt },
  content: { width: "100%", maxWidth: 1440, alignSelf: "center", paddingTop: spacing.xxl, gap: spacing.xxl },
  pageHeading: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  eyebrow: { color: c.brandPrimary, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  greeting: { color: c.onSurface, fontSize: 28, fontWeight: "800", marginTop: 4, letterSpacing: -0.4 },
  subtitle: { color: c.onSurfaceSecondary, fontSize: 13, marginTop: 5 },
  secondaryButton: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 9, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md },
  secondaryButtonText: { color: c.brandPrimary, fontSize: 12, fontWeight: "800" },
  sectionHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { color: c.onSurface, fontSize: 15, fontWeight: "800" },
  sectionHint: { color: c.muted, fontSize: 11, marginTop: 3 },
  syncText: { color: c.brandPrimary, fontSize: 11, fontWeight: "700" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.md },
  metric: { minWidth: 190, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  metricLabelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  metricLabel: { color: c.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  metricValue: { color: c.onSurface, fontSize: 25, fontWeight: "800", marginTop: spacing.sm, letterSpacing: -0.5 },
  metricDescription: { color: c.muted, fontSize: 10, marginTop: 3 },
  inlineNotice: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  workspaceGrid: { gap: spacing.lg },
  workspaceGridDesktop: { flexDirection: "row", alignItems: "flex-start" },
  sectionSurface: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, overflow: "hidden" },
  recentTradesPanel: { minWidth: 0 },
  sectionBar: { minHeight: 58, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider },
  textLink: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: spacing.xs },
  linkText: { color: c.brandPrimary, fontSize: 12, fontWeight: "800" },
  loadingRow: { minHeight: 96, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  errorText: { color: c.error, fontSize: 12 },
  tableHeader: { minHeight: 36, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, backgroundColor: c.surfaceSecondary, gap: spacing.md },
  tableHeading: { color: c.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.45 },
  tableRow: { minHeight: 62, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: c.divider, gap: spacing.md },
  rowPressed: { backgroundColor: c.surfaceSecondary },
  orderColumn: { flex: 1.2, minWidth: 100 },
  customerColumn: { flex: 1.2, minWidth: 100 },
  cardColumn: { flex: 1.4, minWidth: 130 },
  amountColumn: { flex: 1.1, minWidth: 100 },
  statusColumn: { flex: 1, minWidth: 100 },
  rowMain: { color: c.onSurface, fontSize: 12, fontWeight: "700" },
  rowSub: { color: c.muted, fontSize: 10.5, marginTop: 3 },
  mobileRow: { flexDirection: "row", padding: spacing.lg, gap: spacing.md, borderTopWidth: 1, borderTopColor: c.divider },
  mobileRowRight: { alignItems: "flex-end", gap: 7 },
  clearState: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  clearIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.successBg, alignItems: "center", justifyContent: "center" },
  clearTitle: { color: c.onSurface, fontSize: 12, fontWeight: "800" },
  attentionRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: c.divider },
  attentionIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: c.brandSecondary, alignItems: "center", justifyContent: "center" },
  attentionCount: { minWidth: 28, textAlign: "right", color: c.onSurface, fontSize: 15, fontWeight: "800" },
  verificationNote: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: c.surfaceSecondary, borderTopWidth: 1, borderTopColor: c.divider },
  verificationText: { flex: 1, color: c.muted, fontSize: 10.5, lineHeight: 16 },
  emptyCompact: { minHeight: 72, justifyContent: "center", paddingHorizontal: spacing.lg },
  activityRow: { minHeight: 60, flexDirection: "row", alignItems: "stretch", gap: spacing.md, paddingHorizontal: spacing.lg },
  activityMarker: { width: 18, alignItems: "center", position: "relative" },
  activityDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.brandPrimary, marginTop: 18, zIndex: 1 },
  activityLine: { position: "absolute", top: 26, bottom: -18, width: 1, backgroundColor: c.border },
  activityTime: { alignSelf: "center", color: c.muted, fontSize: 10.5, maxWidth: 150, textAlign: "right" },
  pressed: { opacity: 0.72 },
}));

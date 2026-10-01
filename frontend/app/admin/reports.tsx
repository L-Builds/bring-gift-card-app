import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api } from "@/src/api/client";
import { formatDateTime, formatMoney } from "@/src/lib/format";
import { EmptyState } from "@/src/components/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Stats = {
  pending_trades: number;
  pending_withdrawals: number;
  total_customers: number;
  total_brands: number;
  pending_kyc: number;
  open_tickets: number;
};
type Change = {
  target: string;
  action: string;
  at: string;
  version: number;
  brand_name: string;
  market?: { name: string; currency: string; minor_digits: number };
  rate?: { face_value: number; payout_minor: number };
};
type IconName = React.ComponentProps<typeof Ionicons>["name"];

const snapshot: { label: string; key: keyof Stats; icon: IconName; note: string }[] = [
  { label: "Pending trades", key: "pending_trades", icon: "swap-horizontal-outline", note: "Awaiting review or more information" },
  { label: "Payout requests", key: "pending_withdrawals", icon: "cash-outline", note: "Pending or processing withdrawals" },
  { label: "Open support", key: "open_tickets", icon: "chatbubbles-outline", note: "Customer conversations still open" },
  { label: "Customers", key: "total_customers", icon: "people-outline", note: "Registered customer accounts" },
  { label: "Catalog", key: "total_brands", icon: "albums-outline", note: "Gift-card brand records" },
];

export default function Reports() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const desktop = width >= 900;
  const metricWidth = width >= 1180 ? "19%" : width >= 720 ? "48.5%" : "100%";

  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get<Stats>("/admin/stats"),
    refetchInterval: 15000,
  });
  const history = useQuery({
    queryKey: ["denomination-history"],
    queryFn: () => api.get<{ changes: Change[] }>("/admin/denomination-history"),
    refetchInterval: 60000,
  });
  const refresh = () => { void Promise.all([stats.refetch(), history.refetch()]); };

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
          <Text style={styles.eyebrow}>REPORTS</Text>
          <Text style={styles.title}>Operations report</Text>
          <Text style={styles.subtitle}>Live operational counts and recorded rate activity. No revenue, profit, or payout estimates are invented here.</Text>
        </View>
        <Pressable onPress={refresh} accessibilityRole="button" accessibilityLabel="Refresh report" style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]} testID="admin-reports-refresh">
          {(stats.isFetching || history.isFetching) ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Ionicons name="refresh-outline" size={17} color={colors.brandPrimary} />}
          {width >= 600 && <Text style={styles.refreshText}>Refresh</Text>}
        </Pressable>
      </View>

      <View>
        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionTitle}>Operations snapshot</Text>
            <Text style={styles.sectionHint}>Current records from the production admin API.</Text>
          </View>
          {stats.data && <Text style={styles.sectionMeta}>Verification pending: {stats.data.pending_kyc}</Text>}
        </View>
        {stats.isLoading && !stats.data ? <View style={styles.loadingBlock}><ActivityIndicator color={colors.brandPrimary} /><Text style={styles.sectionHint}>Loading current counts…</Text></View>
          : stats.isError && !stats.data ? <View style={styles.errorBlock}><Text style={styles.errorText}>Could not load current counts.</Text><Pressable onPress={() => { void stats.refetch(); }}><Text style={styles.linkText}>Retry</Text></Pressable></View>
          : <View style={styles.metricGrid} testID="reports-operations-snapshot">
            {snapshot.map((item) => <View key={item.key} style={[styles.metric, { width: metricWidth }]}>
              <View style={styles.metricTop}><Ionicons name={item.icon} size={17} color={colors.brandPrimary} /><Text style={styles.metricLabel}>{item.label}</Text></View>
              <Text style={styles.metricValue}>{(stats.data?.[item.key] ?? 0).toLocaleString()}</Text>
              <Text style={styles.metricNote}>{item.note}</Text>
            </View>)}
          </View>}
      </View>

      <View style={styles.sectionSurface} testID="reports-rate-activity">
        <View style={styles.sectionBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>Recent rate activity</Text>
            <Text style={styles.sectionHint}>Recorded changes to card denomination payouts.</Text>
          </View>
        </View>
        {history.isLoading && !history.data ? <View style={styles.loadingBlock}><ActivityIndicator color={colors.brandPrimary} /><Text style={styles.sectionHint}>Loading rate history…</Text></View>
          : history.isError && !history.data ? <View style={styles.errorBlock}><Text style={styles.errorText}>Could not load rate history.</Text><Pressable onPress={() => { void history.refetch(); }}><Text style={styles.linkText}>Retry</Text></Pressable></View>
          : !history.data?.changes.length ? <EmptyState icon="bar-chart-outline" title="No rate activity yet" subtitle="Rate changes will appear here after management updates a denomination." />
          : desktop ? <View>
            <View style={styles.tableHead}>
              <Text style={[styles.tableHeading, styles.brandColumn]}>Card</Text>
              <Text style={[styles.tableHeading, styles.marketColumn]}>Market</Text>
              <Text style={[styles.tableHeading, styles.changeColumn]}>Change</Text>
              <Text style={[styles.tableHeading, styles.payoutColumn]}>Payout</Text>
              <Text style={[styles.tableHeading, styles.timeColumn]}>Recorded</Text>
            </View>
            {history.data.changes.slice(0, 12).map((change, index) => <View key={`${change.target}-${change.version}-${index}`} style={styles.tableRow}>
              <Text style={[styles.tablePrimary, styles.brandColumn]} numberOfLines={1}>{change.brand_name}</Text>
              <Text style={[styles.tablePrimary, styles.marketColumn]} numberOfLines={1}>{change.market?.name ?? "Market"}</Text>
              <View style={styles.changeColumn}><View style={[styles.actionPill, change.action === "rate.disabled" && styles.actionPillMuted]}><Text style={[styles.actionPillText, change.action === "rate.disabled" && styles.actionPillTextMuted]}>{change.action === "rate.disabled" ? "Disabled" : "Updated"}</Text></View></View>
              <Text style={[styles.tablePrimary, styles.payoutColumn]} numberOfLines={1}>{change.rate ? `$${change.rate.face_value} → ${change.market ? formatMoney(change.rate.payout_minor, change.market.currency, change.market.minor_digits) : `${change.rate.payout_minor} minor units`}` : "—"}</Text>
              <Text style={[styles.tableSecondary, styles.timeColumn]} numberOfLines={1}>{formatDateTime(change.at)}</Text>
            </View>)}
          </View>
          : <View>{history.data.changes.slice(0, 10).map((change, index) => <View key={`${change.target}-${change.version}-${index}`} style={styles.mobileRow}>
            <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.tablePrimary}>{change.brand_name} · {change.market?.name ?? "Market"}</Text><Text style={styles.tableSecondary}>{change.rate ? `$${change.rate.face_value} → ${change.market ? formatMoney(change.rate.payout_minor, change.market.currency, change.market.minor_digits) : `${change.rate.payout_minor} minor units`}` : "No denomination payload"}</Text><Text style={styles.tableSecondary}>{formatDateTime(change.at)}</Text></View>
            <View style={[styles.actionPill, change.action === "rate.disabled" && styles.actionPillMuted]}><Text style={[styles.actionPillText, change.action === "rate.disabled" && styles.actionPillTextMuted]}>{change.action === "rate.disabled" ? "Disabled" : "Updated"}</Text></View>
          </View>)}</View>}
      </View>
    </ScrollView>
  </View>;
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.screenBgAlt },
  content: { width: "100%", maxWidth: 1440, alignSelf: "center", paddingTop: spacing.xxl, gap: spacing.xxl },
  pageHeading: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  eyebrow: { color: c.brandPrimary, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: c.onSurface, fontSize: 27, fontWeight: "800", marginTop: 4, letterSpacing: -0.35 },
  subtitle: { color: c.onSurfaceSecondary, fontSize: 13, marginTop: 5, maxWidth: 760, lineHeight: 19 },
  refreshButton: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 9, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md },
  refreshText: { color: c.brandPrimary, fontSize: 12, fontWeight: "800" },
  sectionHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { color: c.onSurface, fontSize: 15, fontWeight: "800" },
  sectionHint: { color: c.muted, fontSize: 11, marginTop: 3 },
  sectionMeta: { color: c.onSurfaceSecondary, fontSize: 11, fontWeight: "700" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.md },
  metric: { minWidth: 170, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  metricTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  metricLabel: { color: c.onSurfaceSecondary, fontSize: 11.5, fontWeight: "700" },
  metricValue: { color: c.onSurface, fontSize: 24, fontWeight: "800", marginTop: spacing.sm, letterSpacing: -0.4 },
  metricNote: { color: c.muted, fontSize: 10, marginTop: 3, lineHeight: 15 },
  sectionSurface: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, overflow: "hidden" },
  sectionBar: { minHeight: 58, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: c.divider },
  loadingBlock: { minHeight: 110, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md },
  errorBlock: { minHeight: 80, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md },
  errorText: { color: c.error, fontSize: 12 },
  linkText: { color: c.brandPrimary, fontSize: 12, fontWeight: "800" },
  tableHead: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: c.surfaceSecondary },
  tableHeading: { color: c.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.45 },
  tableRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: c.divider },
  tablePrimary: { color: c.onSurface, fontSize: 12, fontWeight: "700" },
  tableSecondary: { color: c.muted, fontSize: 10.5 },
  brandColumn: { flex: 1.25, minWidth: 120 },
  marketColumn: { flex: 1, minWidth: 100 },
  changeColumn: { flex: 0.85, minWidth: 90 },
  payoutColumn: { flex: 1.5, minWidth: 150 },
  timeColumn: { flex: 1.2, minWidth: 130 },
  actionPill: { alignSelf: "flex-start", backgroundColor: c.infoBg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  actionPillMuted: { backgroundColor: c.surfaceTertiary },
  actionPillText: { color: c.info, fontSize: 10, fontWeight: "800" },
  actionPillTextMuted: { color: c.onSurfaceSecondary },
  mobileRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderTopWidth: 1, borderTopColor: c.divider },
  pressed: { opacity: 0.72 },
}));

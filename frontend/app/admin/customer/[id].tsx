import React, { useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, BrandMonogram, LoadingView, EmptyState } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { formatNaira, formatMoney, formatDate, formatDateTime, initials } from "@/src/lib/format";
import { ticketStatusLabel } from "@/src/lib/support";

type Detail = {
  user: { id: string; currency?:string; minor_digits?:number; full_name: string; email: string; phone: string; country: string; role: string; auth_provider: string; created_at: string; referral_code: string; disabled: boolean; last_login_at: string | null };
  balance_kobo: number;
  stats: { trades: number; approved_trades: number; total_traded_kobo: number; withdrawals: number; total_withdrawn_kobo: number; referred_count: number };
  trades: { id: string; order_id: string; brand_name: string; brand_color: string; card_value_usd: number; quantity: number; expected_payout_kobo: number; approved_payout_kobo: number | null; status: string; created_at: string }[];
  withdrawals: { id: string; ref: string; amount_kobo: number; status: string; created_at: string; destination: { provider_name: string; account_number: string } }[];
  ledger: { id: string; type: string; amount_kobo: number; description: string; created_at: string }[];
  payout_accounts: { id: string; provider_name: string; account_number: string; account_name: string }[];
  tickets: { id: string; ref: string; subject: string; status: string; category_label: string; last_message_at: string }[];
};

const TABS = ["Trades", "Withdrawals", "Ledger", "Accounts", "Support"] as const;

export default function AdminCustomerDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Trades");

  const { data, isLoading } = useQuery({ queryKey: ["admin-user", id], queryFn: () => api.get<Detail>(`/admin/users/${id}`) });

  const money = (value:number, opts: {decimals?:number;showSign?:boolean}={}) => formatMoney(value,data?.user.currency||"NGN",data?.user.minor_digits??2,opts);
  if (isLoading || !data) return <ScreenBackground><StackHeader title="Customer" /><LoadingView /></ScreenBackground>;

  const { user, stats } = data;
  const Row = ({ label, value }: { label: string; value: string }) => (
    <View style={styles.detailRow}><Text style={styles.detailKey}>{label}</Text><Text style={styles.detailVal} selectable>{value}</Text></View>
  );
  const Stat = ({ label, value }: { label: string; value: string }) => (
    <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>
  );

  return (
    <ScreenBackground>
      <StackHeader title="Customer" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        <View style={styles.headCard}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials(user.full_name || user.email)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user.full_name}</Text>
            <Text style={styles.email} selectable>{user.email}</Text>
            <Text style={styles.metaSmall}>Joined {formatDate(user.created_at)} • {user.auth_provider === "google" ? "Google sign-in" : "Email"}{user.disabled ? " • DISABLED" : ""}</Text>
          </View>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available balance</Text>
          <Text style={styles.balanceValue} testID="admin-customer-balance">{money(data.balance_kobo)}</Text>
          <View style={styles.statRow}>
            <Stat label="Trades" value={`${stats.approved_trades}/${stats.trades}`} />
            <Stat label="Traded" value={money(stats.total_traded_kobo, { decimals: 0 })} />
            <Stat label="Withdrawn" value={money(stats.total_withdrawn_kobo, { decimals: 0 })} />
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Contact & account</Text>
          <Row label="Phone" value={user.phone || "—"} />
          <Row label="Country" value={user.country} />
          <Row label="Referral code" value={user.referral_code || "—"} />
          <Row label="Referred users" value={String(stats.referred_count)} />
          {!!user.last_login_at && <Row label="Last login" value={formatDateTime(user.last_login_at)} />}
        </View>

        <View style={styles.tabs}>
          {TABS.map((t) => {
            const active = tab === t;
            return (
              <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, active && styles.tabActive]} testID={`admin-customer-tab-${t.toLowerCase()}`}>
                <Text style={[styles.tabText, active && { color: colors.onBrandPrimary }]}>{t}</Text>
              </Pressable>
            );
          })}
        </View>

        {tab === "Trades" && (data.trades.length === 0 ? <EmptyState icon="swap-horizontal" title="No trades yet" /> : data.trades.map((t) => (
          <Pressable key={t.id} style={styles.item} onPress={() => router.push(`/admin/trade/${t.id}`)} testID={`admin-customer-trade-${t.id}`}>
            <BrandMonogram name={t.brand_name} color={t.brand_color} size={42} />
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{t.brand_name}</Text>
              <Text style={styles.metaSmall}>{t.order_id} • ${t.card_value_usd} × {t.quantity} • {formatDate(t.created_at)}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text style={styles.itemAmount}>{money(t.approved_payout_kobo ?? t.expected_payout_kobo)}</Text>
              <StatusBadge status={t.status} />
            </View>
          </Pressable>
        )))}

        {tab === "Withdrawals" && (data.withdrawals.length === 0 ? <EmptyState icon="cash-outline" title="No withdrawals yet" /> : data.withdrawals.map((w) => (
          <View key={w.id} style={styles.item} testID={`admin-customer-wd-${w.id}`}>
            <View style={styles.itemIcon}><Ionicons name="cash" size={20} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{w.destination.provider_name} • {w.destination.account_number}</Text>
              <Text style={styles.metaSmall}>{w.ref} • {formatDate(w.created_at)}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text style={styles.itemAmount}>-{money(w.amount_kobo)}</Text>
              <StatusBadge status={w.status} />
            </View>
          </View>
        )))}

        {tab === "Ledger" && (data.ledger.length === 0 ? <EmptyState icon="receipt-outline" title="No ledger entries" /> : data.ledger.map((l) => (
          <View key={l.id} style={styles.item} testID={`admin-customer-ledger-${l.id}`}>
            <View style={[styles.itemIcon, { backgroundColor: l.amount_kobo >= 0 ? colors.successBg : colors.errorBg }]}>
              <Ionicons name={l.amount_kobo >= 0 ? "arrow-down" : "arrow-up"} size={18} color={l.amount_kobo >= 0 ? colors.success : colors.error} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{l.type.replace(/_/g, " ")}</Text>
              <Text style={styles.metaSmall} numberOfLines={1}>{l.description} • {formatDateTime(l.created_at)}</Text>
            </View>
            <Text style={[styles.itemAmount, { color: l.amount_kobo >= 0 ? colors.success : colors.error }]}>{money(l.amount_kobo, { showSign: true })}</Text>
          </View>
        )))}

        {tab === "Accounts" && (data.payout_accounts.length === 0 ? <EmptyState icon="card-outline" title="No payout accounts" /> : data.payout_accounts.map((a) => (
          <View key={a.id} style={styles.item}>
            <BrandMonogram name={a.provider_name} color={colors.brandPrimary} size={42} />
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{a.provider_name}</Text>
              <Text style={styles.metaSmall}>{a.account_number} • {a.account_name}</Text>
            </View>
          </View>
        )))}
        {tab === "Support" && (data.tickets.length === 0 ? <EmptyState icon="chatbubbles-outline" title="No support tickets" /> : data.tickets.map((t) => (
          <Pressable key={t.id} style={styles.item} onPress={() => router.push(`/admin/support/${t.id}`)} testID={`admin-customer-ticket-${t.id}`}>
            <View style={styles.itemIcon}><Ionicons name="chatbubble-ellipses" size={20} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemTitle, { textTransform: "none" }]} numberOfLines={1}>{t.subject}</Text>
              <Text style={styles.metaSmall}>{t.ref} • {t.category_label} • {formatDate(t.last_message_at)}</Text>
            </View>
            <StatusBadge status={ticketStatusLabel(t.status)} />
          </Pressable>
        )))}
      </ScrollView>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  headCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.xs },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 20 },
  name: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
  email: { color: colors.onSurfaceSecondary, fontSize: 13 },
  metaSmall: { color: colors.muted, fontSize: 11, marginTop: 2 },
  muted: { color: colors.muted, fontSize: 13 },
  balanceCard: { backgroundColor: colors.brandPrimary, borderRadius: radius.xl, padding: spacing.lg },
  balanceLabel: { color: colors.onBrandPrimary, opacity: 0.8, fontSize: 13 },
  balanceValue: { color: colors.onBrandPrimary, fontSize: 30, fontWeight: "800", marginTop: 2 },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  stat: { flex: 1, backgroundColor: "rgba(255,255,255,0.16)", borderRadius: radius.md, padding: spacing.sm },
  statValue: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 14 },
  statLabel: { color: colors.onBrandPrimary, opacity: 0.8, fontSize: 11 },
  block: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.xs },
  blockTitle: { fontWeight: "800", color: colors.onSurface, fontSize: 15, marginBottom: spacing.xs },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  detailKey: { color: colors.muted, fontSize: 14 },
  detailVal: { color: colors.onSurface, fontWeight: "700", fontSize: 14, maxWidth: "60%", textAlign: "right" },
  tabs: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radius.pill, padding: 4 },
  tab: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabText: { fontWeight: "700", fontSize: 12, color: colors.onSurfaceSecondary },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  itemIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  itemTitle: { fontWeight: "800", color: colors.onSurface, fontSize: 14, textTransform: "capitalize" },
  itemAmount: { fontWeight: "800", color: colors.onSurface, fontSize: 14 },
}));

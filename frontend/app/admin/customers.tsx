import React, { useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, TextInput, ScrollView, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, LoadingView, EmptyState, QueryErrorView, StatusBadge } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { formatMoney, formatDate, initials } from "@/src/lib/format";

type Customer = {
  currency?: string; minor_digits?: number; id: string; full_name: string; email: string; phone: string; role: string;
  auth_provider: string; balance_kobo: number; trades_count: number; created_at: string; kyc_status?: string;
};
const KYC_FILTERS = [
  { key: "all", label: "All" },
  { key: "unverified", label: "Unverified" },
  { key: "pending", label: "Pending" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Rejected" },
] as const;
const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "trades", label: "Most trades" },
  { key: "balance", label: "Balance" },
] as const;

export default function AdminCustomers() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const desktop = width >= 1100;
  const [q, setQ] = useState("");
  const [kyc, setKyc] = useState("all");
  const [sort, setSort] = useState<"newest" | "trades" | "balance">("newest");

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ["admin-users", q, kyc],
    queryFn: () => api.get<{ users: Customer[] }>(`/admin/users?q=${encodeURIComponent(q)}${kyc === "all" ? "" : `&kyc=${encodeURIComponent(kyc)}`}`)
  });

  const rows = useMemo(() => {
    return [...(data?.users ?? [])].sort((a, b) => {
      if (sort === "trades") return b.trades_count - a.trades_count;
      if (sort === "balance") return b.balance_kobo - a.balance_kobo;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [data?.users, sort]);

  return (
    <ScreenBackground>
      <StackHeader title="Customers" />
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search" size={19} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search name, email, phone or referral code"
            placeholderTextColor={colors.muted}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            testID="admin-customer-search"
          />
          {!!q && <Pressable onPress={() => setQ("")} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable>}
        </View>
        <View style={styles.sortGroup}>
          {SORTS.map((option) => {
            const active = sort === option.key;
            return (
              <Pressable key={option.key} onPress={() => setSort(option.key)} style={[styles.sortButton, active && styles.sortButtonActive]} testID={`admin-customer-sort-${option.key}`}>
                <Text style={[styles.sortText, active && styles.sortTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.chipRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowContent}>
          <Text style={styles.filterLabel}>Verification</Text>
          {KYC_FILTERS.map((option) => {
            const active = kyc === option.key;
            return (
              <Pressable key={option.key} onPress={() => setKyc(option.key)} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]} testID={`admin-customer-kyc-${option.key}`}>
                <Text style={[styles.chipText, { color: active ? colors.onBrandPrimary : colors.onSurface }]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <LoadingView />
      ) : isError || !data ? (
        <QueryErrorView title="Customers unavailable" onRetry={() => { void refetch(); }} retrying={isRefetching} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(u) => u.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, { gap: desktop ? 0 : spacing.md }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No customers found" subtitle="Try a different search or verification filter." />}
          ListHeaderComponent={desktop && rows.length > 0 ? <View style={styles.tableHead}>
            <Text style={[styles.tableHeading, { flex: 1.25 }]}>Customer</Text>
            <Text style={[styles.tableHeading, { flex: 1.55 }]}>Email</Text>
            <Text style={[styles.tableHeading, { flex: 1.05 }]}>Phone</Text>
            <Text style={[styles.tableHeading, { flex: 0.9 }]}>Verification</Text>
            <Text style={[styles.tableHeading, { flex: 0.65 }]}>Trades</Text>
            <Text style={[styles.tableHeading, { flex: 1 }]}>Balance</Text>
            <Text style={[styles.tableHeading, { flex: 0.9 }]}>Joined</Text>
            <View style={{ width: 24 }} />
          </View> : null}
          renderItem={({ item }) => desktop ? (
            <Pressable style={styles.tableRow} onPress={() => router.push(`/admin/customer/${item.id}`)} testID={`admin-customer-${item.id}`} accessibilityRole="button" accessibilityLabel={`Open customer ${item.full_name || item.email}`}>
              <View style={[styles.tableIdentity, { flex: 1.25 }]}>
                <View style={styles.tableAvatar}><Text style={styles.tableAvatarText}>{initials(item.full_name || item.email)}</Text></View>
                <Text style={[styles.tablePrimary, { flex: 1 }]} numberOfLines={1}>{item.full_name || "Customer"}</Text>
              </View>
              <Text style={[styles.tablePrimary, { flex: 1.55 }]} numberOfLines={1}>{item.email}</Text>
              <Text style={[styles.tablePrimary, { flex: 1.05 }]} numberOfLines={1}>{item.phone || "Not provided"}</Text>
              <View style={{ flex: 0.9, alignItems: "flex-start" }}><StatusBadge status={item.kyc_status || "unverified"} /></View>
              <Text style={[styles.tablePrimary, { flex: 0.65 }]}>{item.trades_count}</Text>
              <Text style={[styles.tablePrimary, { flex: 1 }]} numberOfLines={1}>{formatMoney(item.balance_kobo, item.currency || "NGN", item.minor_digits ?? 2)}</Text>
              <Text style={[styles.tableSecondaryStrong, { flex: 0.9 }]} numberOfLines={1}>{formatDate(item.created_at)}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ) : (
            <Pressable style={styles.card} onPress={() => router.push(`/admin/customer/${item.id}`)} testID={`admin-customer-${item.id}`}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{initials(item.full_name || item.email)}</Text></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.full_name || "Customer"}</Text>
                  {item.role === "admin" && <View style={styles.adminTag}><Text style={styles.adminTagText}>ADMIN</Text></View>}
                </View>
                <Text style={styles.meta} numberOfLines={1}>{item.email}</Text>
                <Text style={styles.metaSmall}>{item.trades_count} trade{item.trades_count === 1 ? "" : "s"} • {item.auth_provider === "google" ? "Google" : "Email"}</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 6 }}>
                <Text style={styles.amount}>{formatMoney(item.balance_kobo, item.currency || "NGN", item.minor_digits ?? 2)}</Text>
                <StatusBadge status={item.kyc_status || "unverified"} />
              </View>
            </Pressable>
          )}
        />
      )}
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  toolbar: { width: "100%", maxWidth: 1320, alignSelf: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  search: { minWidth: 280, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, height: 44 },
  searchInput: { flex: 1, fontSize: 14, color: colors.onSurface },
  sortGroup: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 3, gap: 2 },
  sortButton: { height: 34, minWidth: 72, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  sortButtonActive: { backgroundColor: colors.brandSecondary },
  sortText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  sortTextActive: { color: colors.brandPrimary },
  chipRowWrap: { minHeight: 52, justifyContent: "center" },
  chipRowContent: { width: "100%", maxWidth: 1320, paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center", alignSelf: "center" },
  filterLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginRight: 2 },
  chip: { height: 34, borderRadius: radius.pill, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipIdle: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 12, fontWeight: "700" },
  listContent: { width: "100%", maxWidth: 1320, alignSelf: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, paddingTop: spacing.xs },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 16 },
  name: { fontWeight: "800", color: colors.onSurface, fontSize: 15, flexShrink: 1 },
  adminTag: { backgroundColor: colors.brandSecondary, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  adminTagText: { color: colors.brandPrimary, fontSize: 10, fontWeight: "800" },
  meta: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 1 },
  metaSmall: { color: colors.muted, fontSize: 11, marginTop: 2 },
  amount: { fontWeight: "800", color: colors.onSurface, fontSize: 14 },
  tableHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  tableHeading: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  tableRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  tableIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tableAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  tableAvatarText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 10 },
  tablePrimary: { color: colors.onSurface, fontSize: 12, fontWeight: "700" },
  tableSecondaryStrong: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "600" },
}));

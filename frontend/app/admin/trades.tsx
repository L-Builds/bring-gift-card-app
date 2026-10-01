import React, { useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, ScrollView, TextInput, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, LoadingView, EmptyState, QueryErrorView } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { BrandIcon } from "@/src/components/brand-icon";
import { formatMoney, formatDateTime } from "@/src/lib/format";

type AdminTrade = {
  currency?: string; minor_digits?: number; id: string; order_id: string; brand_id: string; brand_name: string; brand_color: string;
  brand_has_logo?: boolean; brand_logo_version?: string; customer_name: string; customer_email?: string;
  card_value_usd: number; quantity: number; expected_payout_kobo: number; status: string; created_at: string;
};
const FILTERS = [
  { key: "PENDING_REVIEW", label: "Pending" },
  { key: "NEED_MORE_INFO", label: "Need Info" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "all", label: "All" },
] as const;
const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
] as const;

export default function AdminTrades() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const desktop = width >= 1100;
  const [filter, setFilter] = useState("PENDING_REVIEW");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ["admin-trades", filter],
    queryFn: () => api.get<{ trades: AdminTrade[] }>(`/admin/trades?status=${filter}`)
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = (data?.trades ?? []).filter((item) => !term || [
      item.order_id, item.customer_name, item.customer_email ?? "", item.brand_name,
    ].some((value) => value.toLowerCase().includes(term)));
    return [...filtered].sort((a, b) => {
      const delta = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return sort === "newest" ? delta : -delta;
    });
  }, [data?.trades, q, sort]);

  return (
    <ScreenBackground>
      <StackHeader title="Trade Queue" />
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search" size={19} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search order, customer or gift card"
            placeholderTextColor={colors.muted}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            testID="admin-trade-search"
          />
          {!!q && <Pressable onPress={() => setQ("")} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable>}
        </View>
        <View style={styles.sortGroup}>
          {SORTS.map((option) => {
            const active = sort === option.key;
            return (
              <Pressable key={option.key} onPress={() => setSort(option.key)} style={[styles.sortButton, active && styles.sortButtonActive]} testID={`admin-trade-sort-${option.key}`}>
                <Text style={[styles.sortText, active && styles.sortTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.chipRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowContent}>
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]} testID={`admin-filter-${f.key}`}>
                <Text style={[styles.chipText, { color: active ? colors.onBrandPrimary : colors.onSurface }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <LoadingView />
      ) : isError || !data ? (
        <QueryErrorView title="Trade queue unavailable" onRetry={() => { void refetch(); }} retrying={isRefetching} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(t) => t.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, { gap: desktop ? 0 : spacing.md }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="checkmark-done" title={q ? "No matching trades" : "Nothing here"} subtitle={q ? "Try a different order, customer or gift card." : "No trades in this status."} />}
          ListHeaderComponent={desktop && rows.length > 0 ? <View style={styles.tableHead}>
            <Text style={[styles.tableHeading, { flex: 1.35 }]}>Order</Text>
            <Text style={[styles.tableHeading, { flex: 1.35 }]}>Customer</Text>
            <Text style={[styles.tableHeading, { flex: 1.4 }]}>Gift card</Text>
            <Text style={[styles.tableHeading, { flex: 0.75 }]}>Value</Text>
            <Text style={[styles.tableHeading, { flex: 1.15 }]}>Expected payout</Text>
            <Text style={[styles.tableHeading, { flex: 0.95 }]}>Status</Text>
            <View style={{ width: 24 }} />
          </View> : null}
          renderItem={({ item }) => (
            desktop ? (
              <Pressable style={styles.tableRow} onPress={() => router.push(`/admin/trade/${item.id}`)} testID={`admin-trade-${item.id}`} accessibilityRole="button" accessibilityLabel={`Open trade ${item.order_id}`}>
                <View style={{ flex: 1.35 }}>
                  <Text style={styles.tablePrimary} numberOfLines={1}>{item.order_id}</Text>
                  <Text style={styles.tableSecondary}>{formatDateTime(item.created_at)}</Text>
                </View>
                <View style={{ flex: 1.35 }}>
                  <Text style={styles.tablePrimary} numberOfLines={1}>{item.customer_name || "Customer"}</Text>
                  {!!item.customer_email && <Text style={styles.tableSecondary} numberOfLines={1}>{item.customer_email}</Text>}
                </View>
                <View style={[styles.tableBrand, { flex: 1.4 }]}>
                  <BrandIcon brand={{ id: item.brand_id, name: item.brand_name, color: item.brand_color, has_logo: item.brand_has_logo, logo_version: item.brand_logo_version }} size={30} />
                  <Text style={[styles.tablePrimary, { flex: 1 }]} numberOfLines={1}>{item.brand_name}</Text>
                </View>
                <Text style={[styles.tablePrimary, { flex: 0.75 }]}>${item.card_value_usd} × {item.quantity}</Text>
                <Text style={[styles.tablePrimary, { flex: 1.15 }]} numberOfLines={1}>{formatMoney(item.expected_payout_kobo, item.currency || "NGN", item.minor_digits ?? 2)}</Text>
                <View style={{ flex: 0.95, alignItems: "flex-start" }}><StatusBadge status={item.status} /></View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ) : (
              <Pressable style={styles.card} onPress={() => router.push(`/admin/trade/${item.id}`)} testID={`admin-trade-${item.id}`}>
                <BrandIcon brand={{ id: item.brand_id, name: item.brand_name, color: item.brand_color, has_logo: item.brand_has_logo, logo_version: item.brand_logo_version }} size={46} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.brand}>{item.brand_name}</Text>
                  <Text style={styles.meta}>{item.customer_name} • ${item.card_value_usd} × {item.quantity}</Text>
                  <Text style={styles.metaSmall}>{item.order_id} • {formatDateTime(item.created_at)}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  <Text style={styles.amount}>{formatMoney(item.expected_payout_kobo, item.currency || "NGN", item.minor_digits ?? 2)}</Text>
                  <StatusBadge status={item.status} />
                </View>
              </Pressable>
            )
          )}
        />
      )}
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  toolbar: { width: "100%", maxWidth: 1320, alignSelf: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  search: { minWidth: 260, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, height: 44 },
  searchInput: { flex: 1, fontSize: 14, color: colors.onSurface },
  sortGroup: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 3, gap: 2 },
  sortButton: { height: 34, minWidth: 72, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  sortButtonActive: { backgroundColor: colors.brandSecondary },
  sortText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  sortTextActive: { color: colors.brandPrimary },
  chipRowWrap: { minHeight: 52, justifyContent: "center" },
  chipRowContent: { width: "100%", maxWidth: 1320, paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center", alignSelf: "center" },
  chip: { height: 34, borderRadius: radius.pill, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipIdle: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 13, fontWeight: "700" },
  listContent: { width: "100%", maxWidth: 1320, alignSelf: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, paddingTop: spacing.xs },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  brand: { fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  meta: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 1 },
  metaSmall: { color: colors.muted, fontSize: 11, marginTop: 2 },
  amount: { fontWeight: "800", color: colors.onSurface, fontSize: 14 },
  tableHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  tableHeading: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  tableRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  tablePrimary: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  tableSecondary: { color: colors.muted, fontSize: 11, marginTop: 3 },
  tableBrand: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
}));

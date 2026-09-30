import React, { useState } from "react";
import { View, Text, Pressable, FlatList, ScrollView, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, LoadingView, EmptyState, QueryErrorView } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { BrandIcon } from "@/src/components/brand-icon";
import { formatNaira, formatMoney, formatDate } from "@/src/lib/format";

type AdminTrade = {
  currency?:string; minor_digits?:number; id: string; order_id: string; brand_id: string; brand_name: string; brand_color: string; brand_has_logo?: boolean; brand_logo_version?: string; customer_name: string;
  card_value_usd: number; quantity: number; expected_payout_kobo: number; status: string; created_at: string;
};
const FILTERS = [
  { key: "PENDING_REVIEW", label: "Pending" },
  { key: "NEED_MORE_INFO", label: "Need Info" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "all", label: "All" },
];

export default function AdminTrades() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const desktop = width >= 1100;
  const [filter, setFilter] = useState("PENDING_REVIEW");

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ["admin-trades", filter],
    queryFn: () => api.get<{ trades: AdminTrade[] }>(`/admin/trades?status=${filter}`),
  });

  return (
    <ScreenBackground>
      <StackHeader title="Trade Queue" />
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
          data={data?.trades ?? []}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: desktop ? 0 : spacing.md, paddingTop: spacing.xs }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="checkmark-done" title="Nothing here" subtitle="No trades in this status." />}
          ListHeaderComponent={desktop && data.trades.length > 0 ? <View style={styles.tableHead}>
            <Text style={[styles.tableHeading, { flex: 1.4 }]}>Order</Text>
            <Text style={[styles.tableHeading, { flex: 1.3 }]}>Customer</Text>
            <Text style={[styles.tableHeading, { flex: 1.4 }]}>Gift card</Text>
            <Text style={[styles.tableHeading, { flex: 0.8 }]}>Value</Text>
            <Text style={[styles.tableHeading, { flex: 1.2 }]}>Expected payout</Text>
            <Text style={[styles.tableHeading, { flex: 0.9 }]}>Status</Text>
          </View> : null}
          renderItem={({ item }) => (
            desktop ? <Pressable style={styles.tableRow} onPress={() => router.push(`/admin/trade/${item.id}`)} testID={`admin-trade-${item.id}`} accessibilityRole="button" accessibilityLabel={`Open trade ${item.order_id}`}>
              <View style={{ flex: 1.4 }}><Text style={styles.tablePrimary} numberOfLines={1}>{item.order_id}</Text><Text style={styles.tableSecondary}>{formatDate(item.created_at)}</Text></View>
              <Text style={[styles.tablePrimary, { flex: 1.3 }]} numberOfLines={1}>{item.customer_name || "Customer"}</Text>
              <View style={[styles.tableBrand, { flex: 1.4 }]}><BrandIcon brand={{ id: item.brand_id, name: item.brand_name, color: item.brand_color, has_logo: item.brand_has_logo, logo_version: item.brand_logo_version }} size={32} /><Text style={[styles.tablePrimary, { flex: 1 }]} numberOfLines={1}>{item.brand_name}</Text></View>
              <Text style={[styles.tablePrimary, { flex: 0.8 }]}>${item.card_value_usd} × {item.quantity}</Text>
              <Text style={[styles.tablePrimary, { flex: 1.2 }]} numberOfLines={1}>{formatMoney(item.expected_payout_kobo,item.currency||"NGN",item.minor_digits??2)}</Text>
              <View style={{ flex: 0.9, alignItems: "flex-start" }}><StatusBadge status={item.status} /></View>
            </Pressable> :
            <Pressable style={styles.card} onPress={() => router.push(`/admin/trade/${item.id}`)} testID={`admin-trade-${item.id}`}>
              <BrandIcon brand={{ id: item.brand_id, name: item.brand_name, color: item.brand_color, has_logo: item.brand_has_logo, logo_version: item.brand_logo_version }} size={46} />
              <View style={{ flex: 1 }}>
                <Text style={styles.brand}>{item.brand_name}</Text>
                <Text style={styles.meta}>{item.customer_name} • ${item.card_value_usd} × {item.quantity}</Text>
                <Text style={styles.metaSmall}>{item.order_id} • {formatDate(item.created_at)}</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 6 }}>
                <Text style={styles.amount}>{formatMoney(item.expected_payout_kobo,item.currency||"NGN",item.minor_digits??2)}</Text>
                <StatusBadge status={item.status} />
              </View>
            </Pressable>
          )}
        />
      )}
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  chipRowWrap: { height: 56, justifyContent: "center" },
  chipRowContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center" },
  chip: { height: 36, borderRadius: radius.pill, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipIdle: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 14, fontWeight: "700" },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  brand: { fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  meta: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 1 },
  metaSmall: { color: colors.muted, fontSize: 11, marginTop: 2 },
  amount: { fontWeight: "800", color: colors.onSurface, fontSize: 14 },
  tableHead: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  tableHeading: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "800" },
  tableRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 70, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  tablePrimary: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  tableSecondary: { color: colors.muted, fontSize: 11, marginTop: 3 },
  tableBrand: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
}));

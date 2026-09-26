import React, { useState } from "react";
import { View, Text, Pressable, FlatList, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, BrandMonogram, LoadingView, EmptyState } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { formatNaira, formatMoney, formatDate } from "@/src/lib/format";

type AdminTrade = {
  currency?:string; minor_digits?:number; id: string; order_id: string; brand_name: string; brand_color: string; customer_name: string;
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
  const [filter, setFilter] = useState("PENDING_REVIEW");

  const { data, isLoading } = useQuery({
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
      ) : (
        <FlatList
          data={data?.trades ?? []}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md, paddingTop: spacing.xs }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="checkmark-done" title="Nothing here" subtitle="No trades in this status." />}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => router.push(`/admin/trade/${item.id}`)} testID={`admin-trade-${item.id}`}>
              <BrandMonogram name={item.brand_name} color={item.brand_color} size={46} />
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
}));

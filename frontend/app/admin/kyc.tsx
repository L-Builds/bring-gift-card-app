import React, { useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, ScrollView, TextInput, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, LoadingView, EmptyState, QueryErrorView } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { formatDateTime } from "@/src/lib/format";

type Sub = {
  id: string; customer_name: string; customer_email: string; id_type_label: string;
  id_number_masked: string; status: string; created_at: string; reason: string;
};
const FILTERS = [
  { key: "PENDING", label: "Pending" },
  { key: "VERIFIED", label: "Verified" },
  { key: "REJECTED", label: "Rejected" },
  { key: "all", label: "All" },
] as const;
const SORTS = [
  { key: "queue", label: "Queue order" },
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
] as const;

export default function AdminKycQueue() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const desktop = width >= 1100;
  const [filter, setFilter] = useState("PENDING");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"queue" | "newest" | "oldest">("queue");

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ["admin-kyc", filter],
    queryFn: () => api.get<{ submissions: Sub[] }>(`/admin/kyc?status=${filter}`)
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = (data?.submissions ?? []).filter((item) => !term || [
      item.customer_name, item.customer_email, item.id_type_label, item.id_number_masked,
    ].some((value) => (value || "").toLowerCase().includes(term)));
    if (sort === "queue") return filtered;
    return [...filtered].sort((a, b) => {
      const delta = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return sort === "newest" ? delta : -delta;
    });
  }, [data?.submissions, q, sort]);

  return (
    <ScreenBackground>
      <StackHeader title="Identity Reviews" />
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search" size={19} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search customer or ID type"
            placeholderTextColor={colors.muted}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            testID="admin-kyc-search"
          />
          {!!q && <Pressable onPress={() => setQ("")} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable>}
        </View>
        <View style={styles.sortGroup}>
          {SORTS.map((option) => {
            const active = sort === option.key;
            return (
              <Pressable key={option.key} onPress={() => setSort(option.key)} style={[styles.sortButton, active && styles.sortButtonActive]} testID={`admin-kyc-sort-${option.key}`}>
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
              <Pressable key={f.key} onPress={() => { setFilter(f.key); setSort("queue"); }} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]} testID={`admin-kyc-filter-${f.key}`}>
                <Text style={[styles.chipText, { color: active ? colors.onBrandPrimary : colors.onSurface }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <LoadingView />
      ) : isError || !data ? (
        <QueryErrorView title="Verification queue unavailable" onRetry={() => { void refetch(); }} retrying={isRefetching} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(s) => s.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, { gap: desktop ? 0 : spacing.md }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="id-card-outline" title={q ? "No matching submissions" : "Queue is clear"} subtitle={q ? "Try a different customer or ID search." : "No identity submissions in this status."} />}
          ListHeaderComponent={desktop && rows.length > 0 ? <View style={styles.tableHead}>
            <Text style={[styles.tableHeading, { flex: 1.35 }]}>Customer</Text>
            <Text style={[styles.tableHeading, { flex: 1.45 }]}>Email</Text>
            <Text style={[styles.tableHeading, { flex: 1.15 }]}>Document</Text>
            <Text style={[styles.tableHeading, { flex: 1.1 }]}>Submitted</Text>
            <Text style={[styles.tableHeading, { flex: 0.8 }]}>Status</Text>
            <View style={{ width: 24 }} />
          </View> : null}
          renderItem={({ item }) => desktop ? (
            <Pressable style={styles.tableRow} onPress={() => router.push(`/admin/kyc/${item.id}`)} testID={`admin-kyc-${item.id}`} accessibilityRole="button" accessibilityLabel={`Open verification for ${item.customer_name}`}>
              <View style={[styles.tableIdentity, { flex: 1.35 }]}>
                <View style={styles.tableIcon}><Ionicons name="id-card-outline" size={18} color={colors.brandPrimary} /></View>
                <Text style={[styles.tablePrimary, { flex: 1 }]} numberOfLines={1}>{item.customer_name || "Customer"}</Text>
              </View>
              <Text style={[styles.tablePrimary, { flex: 1.45 }]} numberOfLines={1}>{item.customer_email}</Text>
              <View style={{ flex: 1.15 }}><Text style={styles.tablePrimary} numberOfLines={1}>{item.id_type_label}</Text><Text style={styles.tableSecondary} numberOfLines={1}>{item.id_number_masked}</Text></View>
              <Text style={[styles.tablePrimary, { flex: 1.1 }]} numberOfLines={1}>{formatDateTime(item.created_at)}</Text>
              <View style={{ flex: 0.8, alignItems: "flex-start" }}><StatusBadge status={item.status} /></View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ) : (
            <Pressable style={styles.card} onPress={() => router.push(`/admin/kyc/${item.id}`)} testID={`admin-kyc-${item.id}`}>
              <View style={styles.icon}><Ionicons name="id-card" size={22} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.customer_name}</Text>
                <Text style={styles.meta}>{item.id_type_label} • {item.id_number_masked}</Text>
                <Text style={styles.metaSmall}>{item.customer_email} • {formatDateTime(item.created_at)}</Text>
              </View>
              <StatusBadge status={item.status} />
            </Pressable>
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
  sortButton: { height: 34, minWidth: 76, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
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
  icon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  name: { fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  meta: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 1 },
  metaSmall: { color: colors.muted, fontSize: 11, marginTop: 2 },
  tableHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  tableHeading: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  tableRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  tableIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tableIcon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  tablePrimary: { color: colors.onSurface, fontSize: 12, fontWeight: "700" },
  tableSecondary: { color: colors.muted, fontSize: 10, marginTop: 3 },
}));

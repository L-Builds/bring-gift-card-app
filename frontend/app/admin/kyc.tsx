import React, { useState } from "react";
import { View, Text, Pressable, FlatList, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, LoadingView, EmptyState } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { formatDateTime } from "@/src/lib/format";

type Sub = { id: string; customer_name: string; customer_email: string; id_type_label: string; id_number_masked: string; status: string; created_at: string; reason: string };
const FILTERS = [
  { key: "PENDING", label: "Pending" },
  { key: "VERIFIED", label: "Verified" },
  { key: "REJECTED", label: "Rejected" },
  { key: "all", label: "All" },
];

export default function AdminKycQueue() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const [filter, setFilter] = useState("PENDING");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-kyc", filter],
    queryFn: () => api.get<{ submissions: Sub[] }>(`/admin/kyc?status=${filter}`),
  });

  return (
    <ScreenBackground>
      <StackHeader title="Identity Reviews" />
      <View style={styles.chipRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowContent}>
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]} testID={`admin-kyc-filter-${f.key}`}>
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
          data={data?.submissions ?? []}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md, paddingTop: spacing.xs }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="id-card-outline" title="Queue is clear" subtitle="No identity submissions in this status." />}
          renderItem={({ item }) => (
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
  chipRowWrap: { height: 56, justifyContent: "center" },
  chipRowContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center" },
  chip: { height: 36, borderRadius: radius.pill, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipIdle: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 14, fontWeight: "700" },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  icon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  name: { fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  meta: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 1 },
  metaSmall: { color: colors.muted, fontSize: 11, marginTop: 2 },
}));

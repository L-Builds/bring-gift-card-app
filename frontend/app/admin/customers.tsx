import React, { useState } from "react";
import { View, Text, Pressable, FlatList, TextInput, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, LoadingView, EmptyState, QueryErrorView } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { formatNaira, formatMoney, initials } from "@/src/lib/format";

type Customer = {
  currency?:string; minor_digits?:number; id: string; full_name: string; email: string; phone: string; role: string;
  auth_provider: string; balance_kobo: number; trades_count: number; created_at: string;
};

export default function AdminCustomers() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const desktop = width >= 1100;
  const [q, setQ] = useState("");

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ["admin-users", q],
    queryFn: () => api.get<{ users: Customer[] }>(`/admin/users?q=${encodeURIComponent(q)}`),
  });

  return (
    <ScreenBackground>
      <StackHeader title="Customers" />
      <View style={styles.searchWrap}>
        <View style={styles.search}>
          <Ionicons name="search" size={20} color={colors.muted} />
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
      </View>

      {isLoading ? (
        <LoadingView />
      ) : isError || !data ? (
        <QueryErrorView title="Customers unavailable" onRetry={() => { void refetch(); }} retrying={isRefetching} />
      ) : (
        <FlatList
          data={data?.users ?? []}
          keyExtractor={(u) => u.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: desktop ? 0 : spacing.md, paddingTop: spacing.xs }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No customers found" subtitle="Try a different name, email or phone number." />}
          ListHeaderComponent={desktop && data.users.length > 0 ? <View style={styles.tableHead}>
            <Text style={[styles.tableHeading, { flex: 1.2 }]}>Customer</Text>
            <Text style={[styles.tableHeading, { flex: 1.6 }]}>Email</Text>
            <Text style={[styles.tableHeading, { flex: 1 }]}>Phone</Text>
            <Text style={[styles.tableHeading, { flex: 0.7 }]}>Trades</Text>
            <Text style={[styles.tableHeading, { flex: 1 }]}>Balance</Text>
          </View> : null}
          renderItem={({ item }) => (
            desktop ? <Pressable style={styles.tableRow} onPress={() => router.push(`/admin/customer/${item.id}`)} testID={`admin-customer-${item.id}`} accessibilityRole="button" accessibilityLabel={`Open customer ${item.full_name || item.email}`}>
              <View style={[styles.tableIdentity, { flex: 1.2 }]}><View style={styles.tableAvatar}><Text style={styles.tableAvatarText}>{initials(item.full_name || item.email)}</Text></View><Text style={[styles.tablePrimary, { flex: 1 }]} numberOfLines={1}>{item.full_name || "Customer"}</Text></View>
              <Text style={[styles.tablePrimary, { flex: 1.6 }]} numberOfLines={1}>{item.email}</Text>
              <Text style={[styles.tablePrimary, { flex: 1 }]} numberOfLines={1}>{item.phone || "—"}</Text>
              <Text style={[styles.tablePrimary, { flex: 0.7 }]}>{item.trades_count}</Text>
              <Text style={[styles.tablePrimary, { flex: 1 }]} numberOfLines={1}>{formatMoney(item.balance_kobo,item.currency||"NGN",item.minor_digits??2)}</Text>
            </Pressable> :
            <Pressable style={styles.card} onPress={() => router.push(`/admin/customer/${item.id}`)} testID={`admin-customer-${item.id}`}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{initials(item.full_name || item.email)}</Text></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.full_name}</Text>
                  {item.role === "admin" && <View style={styles.adminTag}><Text style={styles.adminTagText}>ADMIN</Text></View>}
                </View>
                <Text style={styles.meta} numberOfLines={1}>{item.email}</Text>
                <Text style={styles.metaSmall}>{item.trades_count} trade{item.trades_count === 1 ? "" : "s"} • {item.auth_provider === "google" ? "Google" : "Email"}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.amount}>{formatMoney(item.balance_kobo,item.currency||"NGN",item.minor_digits??2)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  searchWrap: { paddingHorizontal: spacing.lg },
  search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.lg, height: 52 },
  searchInput: { flex: 1, fontSize: 15, color: colors.onSurface },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 16 },
  name: { fontWeight: "800", color: colors.onSurface, fontSize: 15, flexShrink: 1 },
  adminTag: { backgroundColor: colors.brandSecondary, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  adminTagText: { color: colors.brandPrimary, fontSize: 10, fontWeight: "800" },
  meta: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 1 },
  metaSmall: { color: colors.muted, fontSize: 11, marginTop: 2 },
  amount: { fontWeight: "800", color: colors.onSurface, fontSize: 14 },
  tableHead: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  tableHeading: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "800" },
  tableRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 68, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  tableIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tableAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  tableAvatarText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 11 },
  tablePrimary: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
}));

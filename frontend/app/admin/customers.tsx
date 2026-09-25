import React, { useState } from "react";
import { View, Text, Pressable, FlatList, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, LoadingView, EmptyState } from "@/src/components/ui";
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
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
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
      ) : (
        <FlatList
          data={data?.users ?? []}
          keyExtractor={(u) => u.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md, paddingTop: spacing.xs }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No customers found" subtitle="Try a different name, email or phone number." />}
          renderItem={({ item }) => (
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
}));

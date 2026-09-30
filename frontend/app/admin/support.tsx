import React, { useState } from "react";
import { View, Text, Pressable, FlatList, ScrollView, TextInput, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, LoadingView, EmptyState, QueryErrorView } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { formatDateTime } from "@/src/lib/format";
import { Ticket, ticketStatusLabel } from "@/src/lib/support";

const FILTERS = [
  { key: "OPEN", label: "Needs reply" },
  { key: "AWAITING_CUSTOMER", label: "Replied" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "CLOSED", label: "Closed" },
  { key: "all", label: "All" },
];

export default function AdminSupport() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const desktop = width >= 1100;
  const [filter, setFilter] = useState("OPEN");
  const [q, setQ] = useState("");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["admin-support", filter, q],
    queryFn: () => api.get<{ tickets: Ticket[] }>(`/admin/support?status=${filter}&q=${encodeURIComponent(q)}`),
    refetchInterval: 15000,
  });

  return (
    <ScreenBackground>
      <StackHeader title="Support Tickets" />
      <View style={{ paddingHorizontal: spacing.lg }}>
        <View style={styles.search}>
          <Ionicons name="search" size={20} color={colors.muted} />
          <TextInput style={styles.searchInput} placeholder="Search subject, customer, ref" placeholderTextColor={colors.muted} value={q} onChangeText={setQ} autoCapitalize="none" testID="admin-support-search" />
          {!!q && <Pressable onPress={() => setQ("")} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable>}
        </View>
      </View>
      <View style={styles.chipRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowContent}>
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]} testID={`admin-support-filter-${f.key}`}>
                <Text style={[styles.chipText, { color: active ? colors.onBrandPrimary : colors.onSurface }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <LoadingView />
      ) : isError || !data ? (
        <QueryErrorView title="Support inbox unavailable" onRetry={() => { void refetch(); }} retrying={isRefetching} />
      ) : (
        <FlatList
          data={data?.tickets ?? []}
          keyExtractor={(t) => t.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: desktop ? 0 : spacing.md, paddingTop: spacing.xs }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="Inbox clear" subtitle="No tickets in this status." />}
          ListHeaderComponent={desktop && data.tickets.length > 0 ? <View style={styles.tableHead}>
            <Text style={[styles.tableHeading, { flex: 1.4 }]}>Subject</Text>
            <Text style={[styles.tableHeading, { flex: 1.8 }]}>Customer and message</Text>
            <Text style={[styles.tableHeading, { flex: 1.1 }]}>Reference</Text>
            <Text style={[styles.tableHeading, { flex: 1.1 }]}>Updated</Text>
            <Text style={[styles.tableHeading, { flex: 0.9 }]}>Status</Text>
          </View> : null}
          renderItem={({ item }) => (
            desktop ? <Pressable style={[styles.tableRow, item.unread_for_admin > 0 && styles.cardUnread]} onPress={() => router.push(`/admin/support/${item.id}`)} testID={`admin-ticket-${item.id}`} accessibilityRole="button" accessibilityLabel={`Open support ticket ${item.ref}`}>
              <View style={{ flex: 1.4 }}><Text style={styles.tablePrimary} numberOfLines={1}>{item.subject}</Text>{item.unread_for_admin > 0 && <Text style={styles.tableUnread}>{item.unread_for_admin} unread</Text>}</View>
              <View style={{ flex: 1.8 }}><Text style={styles.tablePrimary} numberOfLines={1}>{item.customer_name}</Text><Text style={styles.tableSecondary} numberOfLines={1}>{item.last_message_preview}</Text></View>
              <View style={{ flex: 1.1 }}><Text style={styles.tablePrimary} numberOfLines={1}>{item.ref}</Text><Text style={styles.tableSecondary} numberOfLines={1}>{item.category_label}</Text></View>
              <Text style={[styles.tablePrimary, { flex: 1.1 }]} numberOfLines={1}>{formatDateTime(item.last_message_at)}</Text>
              <View style={{ flex: 0.9, alignItems: "flex-start" }}><StatusBadge status={ticketStatusLabel(item.status)} /></View>
            </Pressable> :
            <Pressable style={[styles.card, item.unread_for_admin > 0 && styles.cardUnread]} onPress={() => router.push(`/admin/support/${item.id}`)} testID={`admin-ticket-${item.id}`}>
              <View style={styles.icon}><Ionicons name="chatbubble-ellipses" size={20} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.subject} numberOfLines={1}>{item.subject}</Text>
                  {item.unread_for_admin > 0 && <View style={styles.unreadPill}><Text style={styles.unreadText}>{item.unread_for_admin}</Text></View>}
                </View>
                <Text style={styles.preview} numberOfLines={1}>{item.customer_name}: {item.last_message_preview}</Text>
                <Text style={styles.meta}>{item.ref} • {item.category_label}{item.ref_label ? ` • ${item.ref_label}` : ""} • {formatDateTime(item.last_message_at)}</Text>
              </View>
              <StatusBadge status={ticketStatusLabel(item.status)} />
            </Pressable>
          )}
        />
      )}
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.lg, height: 52 },
  searchInput: { flex: 1, fontSize: 15, color: colors.onSurface },
  chipRowWrap: { height: 56, justifyContent: "center" },
  chipRowContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center" },
  chip: { height: 36, borderRadius: radius.pill, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipIdle: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 14, fontWeight: "700" },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: colors.brandPrimary },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  subject: { fontWeight: "800", color: colors.onSurface, fontSize: 14, flexShrink: 1 },
  unreadPill: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  unreadText: { color: colors.onError, fontSize: 10, fontWeight: "800" },
  preview: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 1 },
  meta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  tableHead: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  tableHeading: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "800" },
  tableRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 70, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  tablePrimary: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  tableSecondary: { color: colors.muted, fontSize: 11, marginTop: 3 },
  tableUnread: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800", marginTop: 3 },
}));

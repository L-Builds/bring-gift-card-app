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
import { Ticket, ticketStatusLabel } from "@/src/lib/support";

const FILTERS = [
  { key: "OPEN", label: "Needs reply" },
  { key: "AWAITING_CUSTOMER", label: "Replied" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "CLOSED", label: "Closed" },
  { key: "all", label: "All" },
] as const;
const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "unread", label: "Unread first" },
] as const;

export default function AdminSupport() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const desktop = width >= 1100;
  const [filter, setFilter] = useState("OPEN");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "unread">("newest");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["admin-support", filter, q],
    queryFn: () => api.get<{ tickets: Ticket[] }>(`/admin/support?status=${filter}&q=${encodeURIComponent(q)}`),
    refetchInterval: 15000,
  });

  const rows = useMemo(() => {
    return [...(data?.tickets ?? [])].sort((a, b) => {
      if (sort === "unread") {
        const unread = (b.unread_for_admin || 0) - (a.unread_for_admin || 0);
        if (unread) return unread;
      }
      const delta = new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
      return sort === "oldest" ? -delta : delta;
    });
  }, [data?.tickets, sort]);

  return (
    <ScreenBackground>
      <StackHeader title="Support Tickets" />
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search" size={19} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search subject, customer or reference"
            placeholderTextColor={colors.muted}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            testID="admin-support-search"
          />
          {!!q && <Pressable onPress={() => setQ("")} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable>}
        </View>
        <View style={styles.sortGroup}>
          {SORTS.map((option) => {
            const active = sort === option.key;
            return (
              <Pressable key={option.key} onPress={() => setSort(option.key)} style={[styles.sortButton, active && styles.sortButtonActive]} testID={`admin-support-sort-${option.key}`}>
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
          data={rows}
          keyExtractor={(t) => t.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, { gap: desktop ? 0 : spacing.md }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title={q ? "No matching tickets" : "Inbox clear"} subtitle={q ? "Try a different subject, customer or reference." : "No tickets in this status."} />}
          ListHeaderComponent={desktop && rows.length > 0 ? <View style={styles.tableHead}>
            <Text style={[styles.tableHeading, { flex: 1.45 }]}>Subject</Text>
            <Text style={[styles.tableHeading, { flex: 1.5 }]}>Customer</Text>
            <Text style={[styles.tableHeading, { flex: 1.55 }]}>Latest message</Text>
            <Text style={[styles.tableHeading, { flex: 1.05 }]}>Reference</Text>
            <Text style={[styles.tableHeading, { flex: 1.05 }]}>Updated</Text>
            <Text style={[styles.tableHeading, { flex: 0.85 }]}>Status</Text>
            <View style={{ width: 24 }} />
          </View> : null}
          renderItem={({ item }) => desktop ? (
            <Pressable style={[styles.tableRow, item.unread_for_admin > 0 && styles.tableRowUnread]} onPress={() => router.push(`/admin/support/${item.id}`)} testID={`admin-ticket-${item.id}`} accessibilityRole="button" accessibilityLabel={`Open support ticket ${item.ref}`}>
              <View style={{ flex: 1.45 }}>
                <View style={styles.subjectRow}>
                  <Text style={[styles.tablePrimary, { flex: 1 }]} numberOfLines={1}>{item.subject}</Text>
                  {item.unread_for_admin > 0 && <View style={styles.unreadPill}><Text style={styles.unreadText}>{item.unread_for_admin}</Text></View>}
                </View>
                <Text style={styles.tableSecondary} numberOfLines={1}>{item.category_label}</Text>
              </View>
              <View style={{ flex: 1.5 }}><Text style={styles.tablePrimary} numberOfLines={1}>{item.customer_name}</Text><Text style={styles.tableSecondary} numberOfLines={1}>{item.customer_email}</Text></View>
              <Text style={[styles.tableSecondaryStrong, { flex: 1.55 }]} numberOfLines={2}>{item.last_message_preview || "No message preview"}</Text>
              <View style={{ flex: 1.05 }}><Text style={styles.tablePrimary} numberOfLines={1}>{item.ref}</Text>{!!item.ref_label && <Text style={styles.tableSecondary} numberOfLines={1}>{item.ref_label}</Text>}</View>
              <Text style={[styles.tableSecondaryStrong, { flex: 1.05 }]} numberOfLines={1}>{formatDateTime(item.last_message_at)}</Text>
              <View style={{ flex: 0.85, alignItems: "flex-start" }}><StatusBadge status={ticketStatusLabel(item.status)} /></View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ) : (
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
  chip: { height: 34, borderRadius: radius.pill, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipIdle: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 13, fontWeight: "700" },
  listContent: { width: "100%", maxWidth: 1320, alignSelf: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, paddingTop: spacing.xs },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: colors.brandPrimary },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  subject: { fontWeight: "800", color: colors.onSurface, fontSize: 14, flexShrink: 1 },
  unreadPill: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  unreadText: { color: colors.onError, fontSize: 10, fontWeight: "800" },
  preview: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 1 },
  meta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  tableHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  tableHeading: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  tableRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 66, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  tableRowUnread: { borderLeftWidth: 3, borderLeftColor: colors.brandPrimary },
  tablePrimary: { color: colors.onSurface, fontSize: 12, fontWeight: "700" },
  tableSecondary: { color: colors.muted, fontSize: 10, marginTop: 3 },
  tableSecondaryStrong: { color: colors.onSurfaceSecondary, fontSize: 11, lineHeight: 15 },
  subjectRow: { flexDirection: "row", alignItems: "center", gap: 6 },
}));

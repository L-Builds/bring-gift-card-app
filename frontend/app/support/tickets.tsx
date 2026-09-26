import React from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, LoadingView, EmptyState, PrimaryButton } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { api } from "@/src/api/client";
import { formatDateTime } from "@/src/lib/format";
import { Ticket, ticketStatusLabel } from "@/src/lib/support";

export default function SupportTickets() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isGuest, loading } = useAuth();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["support-tickets"],
    queryFn: () => api.get<{ tickets: Ticket[]; unread: number }>("/support/tickets"),
    enabled: !isGuest,
  });

  if (loading) return <ScreenBackground><StackHeader title="Support Tickets" /><LoadingView /></ScreenBackground>;
  if (isGuest) return <Redirect href="/(auth)/login" />;

  return (
    <ScreenBackground>
      <StackHeader title="Support Tickets" right={
        <Pressable style={styles.newBtn} onPress={() => router.push("/support/new")} testID="tickets-new">
          <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      } />
      {isLoading ? (
        <LoadingView />
      ) : (
        <FlatList
          data={data?.tickets ?? []}
          keyExtractor={(t) => t.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.md, paddingTop: spacing.xs }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <EmptyState icon="chatbubbles-outline" title="No tickets yet" subtitle="Have a question about a trade, withdrawal or your account? Our team replies right here in the app." />
              <PrimaryButton title="Open a ticket" icon="add" onPress={() => router.push("/support/new")} testID="tickets-empty-new" />
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={[styles.card, item.unread_for_customer > 0 && styles.cardUnread]} onPress={() => router.push(`/support/${item.id}`)} testID={`ticket-${item.id}`}>
              <View style={styles.icon}><Ionicons name={item.last_sender === "admin" ? "headset" : "chatbubble-ellipses"} size={20} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text style={styles.subject} numberOfLines={1}>{item.subject}</Text>
                  {item.unread_for_customer > 0 && <View style={styles.dot} />}
                </View>
                <Text style={styles.preview} numberOfLines={1}>{item.last_sender === "admin" ? "Support: " : "You: "}{item.last_message_preview}</Text>
                <Text style={styles.meta}>{item.ref}{item.ref_label ? ` • ${item.ref_label}` : ""} • {formatDateTime(item.last_message_at)}</Text>
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
  newBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: colors.brandPrimary },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  subject: { fontWeight: "800", color: colors.onSurface, fontSize: 14, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  preview: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 1 },
  meta: { color: colors.muted, fontSize: 11, marginTop: 2 },
}));

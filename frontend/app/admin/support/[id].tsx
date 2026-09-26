import React from "react";
import { View, Text, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, LoadingView } from "@/src/components/ui";
import { TicketThread } from "@/src/components/ticket-thread";
import { useToast } from "@/src/components/toast";
import { api, ApiError } from "@/src/api/client";
import { formatDateTime } from "@/src/lib/format";
import { Ticket, TicketMessage, ticketStatusLabel } from "@/src/lib/support";

type Detail = { ticket: Ticket; messages: TicketMessage[]; customer: { id: string; full_name: string; email: string; phone: string } | null };

export default function AdminTicketDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-ticket", id],
    queryFn: () => api.get<Detail>(`/admin/support/${id}`),
    refetchInterval: 10000,
  });

  if (isLoading || !data) return <ScreenBackground><StackHeader title="Ticket" /><LoadingView /></ScreenBackground>;
  const { ticket, messages, customer } = data;

  const after = async () => {
    await refetch();
    qc.invalidateQueries({ queryKey: ["admin-support"] });
    qc.invalidateQueries({ queryKey: ["admin-stats"] });
  };

  const send = async (body: string) => {
    try {
      await api.post(`/admin/support/${id}/reply`, { body });
      await after();
      toast.show("Reply sent — customer notified", "success");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Reply failed", "error");
      throw e;
    }
  };

  const setStatus = async (status: string) => {
    try {
      await api.post(`/admin/support/${id}/status`, { status });
      await after();
      toast.show(`Ticket marked ${ticketStatusLabel(status).toLowerCase()}`, "success");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Update failed", "error");
    }
  };

  const openRef = () => {
    if (ticket.ref_type === "trade" && ticket.ref_id) router.push(`/admin/trade/${ticket.ref_id}`);
    else if (ticket.ref_type === "withdrawal") router.push("/admin/withdrawals");
  };

  return (
    <ScreenBackground>
      <StackHeader title={ticket.ref} right={<StatusBadge status={ticketStatusLabel(ticket.status)} />} />
      <TicketThread
        messages={messages}
        mySide="admin"
        onSend={send}
        disabled={ticket.status === "CLOSED"}
        disabledHint="Ticket closed. Reopen to reply."
        testID="admin-ticket"
        header={
          <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
            <View style={styles.head}>
              <Text style={styles.subject}>{ticket.subject}</Text>
              <Text style={styles.meta}>{ticket.category_label} • Opened {formatDateTime(ticket.created_at)}</Text>
              {!!ticket.ref_label && (
                <Pressable style={styles.refChip} onPress={openRef} testID="admin-ticket-open-ref">
                  <Ionicons name="link" size={14} color={colors.brandPrimary} />
                  <Text style={styles.refChipText}>{ticket.ref_type === "trade" ? "Trade" : "Withdrawal"} {ticket.ref_label}</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.brandPrimary} />
                </Pressable>
              )}
            </View>
            {customer && (
              <Pressable style={styles.customer} onPress={() => router.push(`/admin/customer/${customer.id}`)} testID="admin-ticket-customer">
                <View style={styles.avatar}><Ionicons name="person" size={18} color={colors.brandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.custName}>{customer.full_name}</Text>
                  <Text style={styles.meta}>{customer.email}{customer.phone ? ` • ${customer.phone}` : ""}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.muted} />
              </Pressable>
            )}
            <View style={styles.actions}>
              {ticket.status !== "RESOLVED" && ticket.status !== "CLOSED" && (
                <Pressable style={[styles.actBtn, { backgroundColor: colors.successBg }]} onPress={() => setStatus("RESOLVED")} testID="admin-ticket-resolve">
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} /><Text style={[styles.actText, { color: colors.success }]}>Resolve</Text>
                </Pressable>
              )}
              {ticket.status !== "CLOSED" ? (
                <Pressable style={[styles.actBtn, { backgroundColor: colors.surfaceTertiary }]} onPress={() => setStatus("CLOSED")} testID="admin-ticket-close">
                  <Ionicons name="lock-closed" size={16} color={colors.onSurfaceSecondary} /><Text style={[styles.actText, { color: colors.onSurfaceSecondary }]}>Close</Text>
                </Pressable>
              ) : (
                <Pressable style={[styles.actBtn, { backgroundColor: colors.brandSecondary }]} onPress={() => setStatus("OPEN")} testID="admin-ticket-reopen">
                  <Ionicons name="refresh" size={16} color={colors.brandPrimary} /><Text style={[styles.actText, { color: colors.brandPrimary }]}>Reopen</Text>
                </Pressable>
              )}
            </View>
          </View>
        }
      />
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  head: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: 4 },
  subject: { fontWeight: "800", color: colors.onSurface, fontSize: 16 },
  meta: { color: colors.muted, fontSize: 12 },
  refChip: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: colors.brandSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.md, height: 30, marginTop: 6 },
  refChipText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 12 },
  customer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  custName: { fontWeight: "800", color: colors.onSurface, fontSize: 14 },
  actions: { flexDirection: "row", gap: spacing.sm },
  actBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, borderRadius: radius.lg },
  actText: { fontWeight: "800", fontSize: 13 },
}));

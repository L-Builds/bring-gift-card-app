import React from "react";
import { View, Text, Pressable, Alert, Platform } from "react-native";
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

export default function TicketDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["support-ticket", id],
    queryFn: () => api.get<{ ticket: Ticket; messages: TicketMessage[] }>(`/support/tickets/${id}`),
    refetchInterval: 10000,
  });

  if (isLoading || !data) return <ScreenBackground><StackHeader title="Ticket" /><LoadingView /></ScreenBackground>;
  const { ticket, messages } = data;
  const closed = ticket.status === "CLOSED";

  const send = async (body: string) => {
    try {
      await api.post(`/support/tickets/${id}/messages`, { body });
      await refetch();
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Message not sent", "error");
      throw e;
    }
  };

  const doClose = async () => {
    try {
      await api.post(`/support/tickets/${id}/close`);
      await refetch();
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.show("Ticket closed", "success");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not close ticket", "error");
    }
  };

  const confirmClose = () => {
    if (Platform.OS === "web") return doClose();
    Alert.alert("Close this ticket?", "You can open a new ticket any time if you need more help.", [
      { text: "Keep open", style: "cancel" },
      { text: "Close ticket", style: "destructive", onPress: doClose },
    ]);
  };

  return (
    <ScreenBackground>
      <StackHeader
        title={ticket.ref}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/support/tickets"))}
        right={!closed ? (
          <Pressable style={styles.closeBtn} onPress={confirmClose} testID="ticket-close">
            <Ionicons name="checkmark-done" size={20} color={colors.brandPrimary} />
          </Pressable>
        ) : undefined}
      />
      <TicketThread
        messages={messages}
        mySide="customer"
        onSend={send}
        disabled={closed}
        disabledHint="This ticket is closed. Open a new ticket if you need more help."
        testID="ticket"
        header={
          <View style={styles.head} testID="ticket-head">
            <View style={{ flex: 1 }}>
              <Text style={styles.subject}>{ticket.subject}</Text>
              <Text style={styles.meta}>{ticket.category_label}{ticket.ref_label ? ` • ${ticket.ref_label}` : ""} • Opened {formatDateTime(ticket.created_at)}</Text>
              {ticket.status === "RESOLVED" && <Text style={styles.resolved}>Marked resolved by support — reply if you still need help.</Text>}
            </View>
            <StatusBadge status={ticketStatusLabel(ticket.status)} />
          </View>
        }
      />
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.sm },
  subject: { fontWeight: "800", color: colors.onSurface, fontSize: 16 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  resolved: { color: colors.success, fontSize: 12, marginTop: 6, fontWeight: "600" },
}));

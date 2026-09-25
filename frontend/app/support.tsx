import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, Linking } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { api } from "@/src/api/client";

const FAQS = [
  { q: "How long does a trade take to review?", a: "Most trades are reviewed shortly after submission. You'll get a notification when the status changes to Approved, Rejected, or Need More Information." },
  { q: "When is my wallet credited?", a: "Your Available Balance is credited only once a trade is approved by our team. Trades under review do not affect your balance." },
  { q: "How do withdrawals work?", a: "Tap Withdraw in your Wallet, choose a saved payout account, and submit. Our team processes and confirms payment to your account." },
  { q: "Are my gift card codes safe?", a: "Yes. Card images and e-codes are stored privately and only visible to authorised review staff. Codes are masked in lists." },
];

export default function Support() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<number | null>(0);
  const router = useRouter();
  const { isGuest } = useAuth();
  const { data: tickets } = useQuery({ queryKey: ["support-tickets"], queryFn: () => api.get<{ unread: number; tickets: any[] }>("/support/tickets"), enabled: !isGuest });
  const openCount = (tickets?.tickets ?? []).filter((t) => t.status === "OPEN" || t.status === "AWAITING_CUSTOMER").length;

  return (
    <ScreenBackground>
      <StackHeader title="Help & Support" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.lg }}>
        <Pressable style={styles.ticketCard} onPress={() => router.push(isGuest ? "/(auth)/login" : "/support/tickets")} testID="support-tickets">
          <View style={styles.ticketIcon}><Ionicons name="chatbubble-ellipses" size={24} color={colors.onBrandPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.ticketTitle}>Support inbox</Text>
            <Text style={styles.ticketSub}>
              {isGuest ? "Sign in to message our team in the app" : openCount ? `${openCount} open ticket${openCount === 1 ? "" : "s"}` : "Raise a case — our team replies right here"}
            </Text>
          </View>
          {!!tickets?.unread && <View style={styles.badge}><Text style={styles.badgeText}>{tickets.unread}</Text></View>}
          <Ionicons name="chevron-forward" size={20} color={colors.onBrandPrimary} />
        </Pressable>
        <Pressable style={styles.newTicket} onPress={() => router.push(isGuest ? "/(auth)/login" : "/support/new")} testID="support-new-ticket">
          <Ionicons name="add-circle" size={20} color={colors.brandPrimary} />
          <Text style={styles.newTicketText}>Open a new ticket</Text>
        </Pressable>

        <View style={styles.contactRow}>
          <Pressable style={styles.contact} onPress={() => Linking.openURL("mailto:hello@bringgiftcard.com")} testID="support-email">
            <View style={styles.cIcon}><Ionicons name="mail" size={22} color={colors.brandPrimary} /></View>
            <Text style={styles.cLabel}>Email us</Text>
            <Text style={styles.cSub}>hello@bringgiftcard.com</Text>
          </Pressable>
          <Pressable style={styles.contact} onPress={() => Linking.openURL("https://wa.me/84779423224")} testID="support-chat">
            <View style={styles.cIcon}><Ionicons name="chatbubbles" size={22} color={colors.brandPrimary} /></View>
            <Text style={styles.cLabel}>Live chat</Text>
            <Text style={styles.cSub}>Chat with our team</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Frequently asked questions</Text>
        {FAQS.map((f, i) => (
          <Pressable key={i} style={styles.faq} onPress={() => setOpen(open === i ? null : i)} testID={`faq-${i}`}>
            <View style={styles.faqHead}>
              <Text style={styles.faqQ}>{f.q}</Text>
              <Ionicons name={open === i ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
            </View>
            {open === i && <Text style={styles.faqA}>{f.a}</Text>}
          </Pressable>
        ))}
      </ScrollView>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  ticketCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.xs },
  ticketIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  ticketTitle: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 16 },
  ticketSub: { color: colors.onBrandPrimary, opacity: 0.85, fontSize: 12, marginTop: 2 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: colors.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: colors.onError, fontWeight: "800", fontSize: 12 },
  newTicket: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginTop: -spacing.sm },
  newTicketText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 14 },
  contactRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
  contact: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: 4 },
  cIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  cLabel: { fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  cSub: { color: colors.muted, fontSize: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  faq: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  faqHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  faqQ: { flex: 1, fontWeight: "700", color: colors.onSurface, fontSize: 14 },
  faqA: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 20, marginTop: spacing.sm },
}));

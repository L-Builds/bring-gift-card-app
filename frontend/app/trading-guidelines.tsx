import React from "react";
import { ScrollView, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground } from "@/src/components/ui";
import { makeStyles, radius, spacing } from "@/src/theme";

const STEPS = [
  ["pricetag-outline", "Check the current rate", "Use the rate shown in Bring Gift Card before you submit a trade."],
  ["card-outline", "Choose the correct card details", "Select the right brand, country, card type and value so your expected payout is calculated correctly."],
  ["images-outline", "Submit a clear card or e-code", "For physical cards, upload clear images. For digital cards, enter or upload the requested code/details carefully."],
  ["time-outline", "Wait for review", "Submitted trades remain under review until the company team approves, rejects, or requests more information."],
  ["chatbubble-ellipses-outline", "Respond if more information is needed", "If the team requests another image or detail, update the same trade instead of creating a duplicate submission."],
  ["wallet-outline", "Wallet credit follows approval", "Your Available Balance updates only after a trade is approved. Rejected or still-pending trades do not credit your wallet."],
];

export default function TradingGuidelines() {
  const styles = useStyles();
  return (
    <ScreenBackground>
      <StackHeader title="Trading Guidelines" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Follow these steps when selling a gift card on Bring Gift Card.</Text>
        <View style={styles.card}>
          {STEPS.map(([icon, title, body], index) => (
            <View key={title} style={[styles.row, index < STEPS.length - 1 && styles.divider]}>
              <View style={styles.iconWrap}><Ionicons name={icon as any} size={21} color="#1F5AF6" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.body}>{body}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={styles.note}>
          <Ionicons name="shield-checkmark-outline" size={20} color="#1F5AF6" />
          <Text style={styles.noteText}>Keep gift-card codes private and submit them only through the protected trade flow.</Text>
        </View>
      </ScrollView>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  intro: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, paddingHorizontal: spacing.lg },
  row: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.lg },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontWeight: "800", fontSize: 14.5 },
  body: { color: colors.onSurfaceSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  note: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.brandSecondary, borderRadius: radius.lg, padding: spacing.md },
  noteText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 12.5, lineHeight: 18 },
}));

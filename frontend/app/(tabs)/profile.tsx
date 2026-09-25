import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, Modal } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { AppHeader } from "@/src/components/app-header";
import { ScreenBackground } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { api } from "@/src/api/client";
import { initials } from "@/src/lib/format";

export default function Profile() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { user, isGuest, isAdmin, logout } = useAuth();
  const [showDetails, setShowDetails] = useState(false);

  const { data: acc } = useQuery({
    queryKey: ["payout-accounts"],
    queryFn: () => api.get<{ accounts: any[] }>("/payout-accounts"),
    enabled: !isGuest,
  });

  if (isGuest) return <Redirect href="/(auth)/login" />;

  const Row = ({ icon, label, onPress, right, danger, last }: any) => (
    <Pressable style={[styles.row, !last && styles.rowDivider]} onPress={onPress} testID={`profile-${label.toLowerCase().replace(/\s|&/g, "-")}`}>
      <View style={styles.rowLeft}>
        <View style={[styles.rowIcon, { backgroundColor: danger ? colors.errorBg : colors.brandSecondary }]}>
          <Ionicons name={icon} size={20} color={danger ? colors.error : colors.brandPrimary} />
        </View>
        <Text style={[styles.rowLabel, danger && { color: colors.error }]}>{label}</Text>
      </View>
      {right ?? <Ionicons name="chevron-forward" size={18} color={colors.muted} />}
    </Pressable>
  );

  const accountsLabel = acc?.accounts?.length ? `${acc.accounts.length} saved` : "Add account";
  const appVersion = Constants.expoConfig?.version ?? "—";

  return (
    <ScreenBackground>
      <AppHeader title="Profile" showBell />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg }}>
        <View style={styles.profileCard}>
          <View style={styles.profileTop}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(user!.full_name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{user!.full_name}</Text>
              <View style={styles.verifiedRow}>
                <Text style={styles.verified}>Member</Text>
              </View>
            </View>
            <Pressable onPress={() => setShowDetails(true)} testID="profile-details-open"><Ionicons name="chevron-forward" size={22} color={colors.onSurface} /></Pressable>
          </View>


        </View>

        <View style={styles.group}>
          <Row icon="person" label="Personal Details" onPress={() => setShowDetails(true)} />
          <Row icon="wallet" label="Payout Method" onPress={() => router.push("/payout-accounts")} right={<View style={styles.pill}><Text style={styles.pillText}>{accountsLabel}</Text></View>} />
          <Row icon="document-text" label="Transaction History" onPress={() => router.push("/(tabs)/transactions")} />
          <Row icon="people" label="Referral" onPress={() => router.push("/referral")} last />
        </View>

        <View style={styles.group}>
          <Row icon="notifications" label="Notifications" onPress={() => router.push("/notifications")} />
          <Row icon="headset" label="Help & Support" onPress={() => router.push("/support")} />
          <Row icon="document-text" label="Terms & Privacy" onPress={() => router.push("/legal/terms")} />
          <Row icon="shield-checkmark" label="Security" onPress={() => router.push("/security/pin")} last />
        </View>

        {isAdmin && (
          <View style={styles.group}>
            <Row icon="grid" label="Admin Panel" onPress={() => router.push("/admin")} last />
          </View>
        )}

        <View style={styles.group}>
          <Row icon="information-circle" label="App Version" right={<Text style={styles.version}>v{appVersion}</Text>} />
          <Row icon="log-out" label="Log Out" danger onPress={async () => { await logout(); router.replace("/"); }} last />
        </View>
      </ScrollView>

      <Modal visible={showDetails} transparent animationType="slide" onRequestClose={() => setShowDetails(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowDetails(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Personal Details</Text>
            {[
              ["Full Name", user!.full_name],
              ["Email", user!.email],
              ["Phone", user!.phone],
              ["Country", user!.country],
            ].map(([k, v]) => (
              <View key={k} style={styles.detailRow}>
                <Text style={styles.detailKey}>{k}</Text>
                <Text style={styles.detailVal}>{v || "—"}</Text>
              </View>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  profileCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.xs, shadowColor: colors.shadow, shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  profileTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 23 },
  name: { fontSize: 19, fontWeight: "800", color: colors.onSurface },
  verifiedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  verified: { color: colors.muted, fontSize: 13 },
  payoutRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.lg },
  payoutIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  payoutSmall: { color: colors.muted, fontSize: 12 },
  payoutName: { color: colors.onSurface, fontWeight: "800", fontSize: 15 },
  walletPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.md, height: 34 },
  walletPillText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 13 },
  group: { backgroundColor: colors.surface, borderRadius: radius.xl, paddingHorizontal: spacing.lg, shadowColor: colors.shadow, shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  pill: { backgroundColor: colors.brandSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  pillText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 12 },
  version: { color: colors.muted, fontSize: 13 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xxxl },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.md },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  detailKey: { color: colors.muted, fontSize: 14 },
  detailVal: { color: colors.onSurface, fontWeight: "700", fontSize: 14, maxWidth: "60%", textAlign: "right" },
}));

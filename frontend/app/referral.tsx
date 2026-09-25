import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, Share, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, PrimaryButton } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { api, ApiError } from "@/src/api/client";
import { formatDate } from "@/src/lib/format";

type ReferralData = {
  code: string;
  referred_count: number;
  referred_by_name: string | null;
  can_apply_code: boolean;
  referred: { id: string; name: string; joined_at: string }[];
};

export default function Referral() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const [applyCode, setApplyCode] = useState("");
  const [applying, setApplying] = useState(false);

  const { data } = useQuery({ queryKey: ["referral"], queryFn: () => api.get<ReferralData>("/referral") });
  const code = data?.code ?? "";

  const share = async () => {
    try {
      await Share.share({ message: `Join me on Bring Gift Card and use my referral code ${code}.` });
    } catch {
      toast.show("Could not open share", "error");
    }
  };

  const apply = async () => {
    if (applyCode.trim().length < 3) return toast.show("Enter a referral code", "error");
    setApplying(true);
    try {
      const r = await api.post<{ referred_by_name: string }>("/referral/apply", { code: applyCode.trim() });
      qc.invalidateQueries({ queryKey: ["referral"] });
      toast.show(`Referral linked to ${r.referred_by_name.split(" ")[0]}`, "success");
      setApplyCode("");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not apply code", "error");
    } finally {
      setApplying(false);
    }
  };

  return (
    <ScreenBackground>
      <StackHeader title="Referral" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={[colors.brandDeep, colors.brandPrimary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
          <Ionicons name="people" size={40} color={colors.onBrandPrimary} />
          <Text style={styles.title}>Invite friends to Bring Gift Card</Text>
          <Text style={styles.sub}>Share your code so referrals can be linked to your account.</Text>
          <View style={styles.codeBox}>
            <Text style={styles.code} testID="referral-code">{code}</Text>
            <Pressable onPress={share} testID="referral-copy"><Ionicons name="share-social-outline" size={20} color={colors.onBrandPrimary} /></Pressable>
          </View>
        </LinearGradient>

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{data?.referred_count ?? 0}</Text>
            <Text style={styles.statLabel}>Friends joined</Text>
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>How it works</Text>
          {[["share-social", "Share your referral code"], ["person-add", "Your friend joins Bring Gift Card"], ["link", "Their account is linked to your referral"]].map(([icon, text]) => (
            <View key={text} style={styles.stepRow}>
              <View style={styles.stepIcon}><Ionicons name={icon as any} size={16} color={colors.brandPrimary} /></View>
              <Text style={styles.stepText}>{text}</Text>
            </View>
          ))}
        </View>

        {data?.can_apply_code && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Have a referral code?</Text>
            <Text style={styles.hint}>Link one referral code to your account.</Text>
            <View style={styles.applyRow}>
              <TextInput style={styles.applyInput} placeholder="e.g. BGC1A2B3C" placeholderTextColor={colors.muted} autoCapitalize="characters" value={applyCode} onChangeText={setApplyCode} testID="referral-apply-input" />
              <PrimaryButton title={applying ? "…" : "Apply"} onPress={apply} loading={applying} testID="referral-apply-submit" style={{ height: 48, paddingHorizontal: spacing.lg }} />
            </View>
          </View>
        )}

        {!!data?.referred_by_name && (
          <View style={styles.referredBy}>
            <Ionicons name="person-circle" size={20} color={colors.brandPrimary} />
            <Text style={styles.referredByText}>You were referred by <Text style={{ fontWeight: "800" }}>{data.referred_by_name}</Text></Text>
          </View>
        )}

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Your referrals</Text>
          {(data?.referred ?? []).length === 0 ? (
            <Text style={styles.hint}>No one has joined with your code yet.</Text>
          ) : data!.referred.map((r) => (
            <View key={r.id} style={styles.refRow} testID={`referral-item-${r.id}`}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{r.name[0]}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.refName}>{r.name}</Text>
                <Text style={styles.hint}>Joined {formatDate(r.joined_at)}</Text>
              </View>
            </View>
          ))}
        </View>

        <PrimaryButton title="Share Referral Code" icon="share-social" onPress={share} testID="referral-share" />
      </ScrollView>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { borderRadius: radius.xxl, padding: spacing.xl, gap: spacing.sm, marginTop: spacing.xs },
  title: { color: colors.onBrandPrimary, fontSize: 20, fontWeight: "800", marginTop: spacing.sm },
  sub: { color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: 19 },
  codeBox: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(255,255,255,0.18)", borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md },
  code: { color: colors.onBrandPrimary, fontSize: 22, fontWeight: "800", letterSpacing: 2 },
  statRow: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md, gap: 2 },
  statNum: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
  statLabel: { color: colors.muted, fontSize: 11 },
  block: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm },
  blockTitle: { fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  stepText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  applyRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  applyInput: { flex: 1, height: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.md, fontSize: 15, color: colors.onSurface, letterSpacing: 1 },
  referredBy: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brandSecondary, borderRadius: radius.lg, padding: spacing.md },
  referredByText: { color: colors.brandPrimary, fontSize: 13 },
  refRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.brandPrimary, fontWeight: "800" },
  refName: { fontWeight: "700", color: colors.onSurface, fontSize: 14 },
}));

import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { api, ApiError } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { useToast } from "@/src/components/toast";
import { StackHeader } from "@/src/components/stack-header";
import { LoadingView, PrimaryButton, QueryErrorView, ScreenBackground } from "@/src/components/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { markAccountDeletionCompleted } from "@/src/lib/account-deletion-result";

type DeletionStatus = {
  status: "none" | "pending_review" | "completed";
  reference?: string;
  reason?: string;
  requires_password?: boolean;
};

export default function DeleteAccount() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { isGuest, isAdmin, loading: authLoading, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeletionStatus | null>(null);
  const statusQuery = useQuery({
    queryKey: ["account-deletion"],
    queryFn: () => api.get<DeletionStatus>("/account-deletion"),
    enabled: !authLoading && !isGuest && !isAdmin,
  });

  if (authLoading) return null;
  if (isGuest) return <Redirect href={{ pathname: "/(auth)/login", params: { return_to: "/delete-account" } }} />;
  if (isAdmin) return <Redirect href="/admin" />;
  if (statusQuery.isLoading) return <ScreenBackground><StackHeader title="Delete Account" /><LoadingView /></ScreenBackground>;
  if (statusQuery.isError || !statusQuery.data) return (
    <ScreenBackground>
      <StackHeader title="Delete Account" />
      <QueryErrorView title="Account deletion status unavailable" onRetry={() => { void statusQuery.refetch(); }} retrying={statusQuery.isRefetching} />
    </ScreenBackground>
  );

  const status = result ?? statusQuery.data;
  const passwordRequired = statusQuery.data.requires_password ?? true;
  const canSubmit = confirmation === "DELETE" && (!passwordRequired || !!password.trim());

  const submit = async () => {
    if (busy || !canSubmit) return;
    setBusy(true);
    try {
      const response = await api.post<DeletionStatus>("/account-deletion", {
        confirmation: "DELETE",
        ...(password.trim() ? { password } : {}),
      });
      setPassword("");
      setConfirmation("");
      if (response.status === "completed") {
        markAccountDeletionCompleted();
        router.replace("/account-deleted");
        await logout();
      } else {
        setResult(response);
      }
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : "Could not submit your request. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenBackground>
      <StackHeader title="Delete Account" />
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xxxl }]}
        testID="account-deletion-screen"
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name="person-remove-outline" size={27} color={colors.error} /></View>
          <Text style={styles.title}>Delete your account</Text>
          <Text style={styles.body}>You can request closure of your Bring Gift Card customer account here.</Text>
        </View>

        {status.status === "pending_review" ? (
          <View style={styles.card} testID="account-deletion-pending">
            <View style={styles.statusHead}>
              <Ionicons name="time-outline" size={22} color={colors.warning} />
              <Text style={styles.cardTitle}>Request pending review</Text>
            </View>
            <Text style={styles.body}>Your request is recorded. Our team will review any unresolved balance, trade, withdrawal, security or legal obligations before closing the account.</Text>
            {!!status.reference && <Text style={styles.reference}>Reference: {status.reference}</Text>}
            {!!status.reason && <Text style={styles.reason}>{status.reason}</Text>}
            <Pressable onPress={() => router.push("/support")} accessibilityRole="link" testID="account-deletion-support">
              <Text style={styles.link}>Contact Support</Text>
            </Pressable>
          </View>
        ) : status.status === "completed" ? (
          <View style={styles.card} testID="account-deletion-completed">
            <View style={styles.statusHead}>
              <Ionicons name="checkmark-circle-outline" size={22} color={colors.success} />
              <Text style={styles.cardTitle}>Account closed</Text>
            </View>
            <Text style={styles.body}>Your customer account has been closed. Personal account data has been removed or anonymized where appropriate. Required financial and security records may remain under our retention obligations.</Text>
            {!!status.reference && <Text style={styles.reference}>Reference: {status.reference}</Text>}
            <PrimaryButton title="Continue" onPress={() => { markAccountDeletionCompleted(); router.replace("/account-deleted"); void logout(); }} testID="account-deletion-finish" />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>What happens to your information</Text>
              <View style={styles.infoRow}><Ionicons name="checkmark-circle-outline" size={19} color={colors.brandPrimary} /><Text style={styles.infoText}>Your profile, sign-in details, saved payout methods and other data no longer needed will be removed or anonymized when closure is completed.</Text></View>
              <View style={styles.infoRow}><Ionicons name="document-text-outline" size={19} color={colors.brandPrimary} /><Text style={styles.infoText}>Trade, transaction, wallet, withdrawal and security records may be kept where needed for financial, fraud prevention or legal reasons.</Text></View>
              <View style={styles.infoRow}><Ionicons name="time-outline" size={19} color={colors.brandPrimary} /><Text style={styles.infoText}>If you have an unresolved balance, trade, withdrawal or review, your request may need staff review before closure.</Text></View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Confirm your request</Text>
              <Text style={styles.body}>Account closure cannot be undone after it is completed.</Text>
              {passwordRequired && (
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Current password</Text>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    style={styles.input}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Enter your password"
                    placeholderTextColor={colors.muted}
                    testID="account-deletion-password"
                  />
                </View>
              )}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Type DELETE to confirm</Text>
                <TextInput
                  value={confirmation}
                  onChangeText={(value) => setConfirmation(value.toUpperCase())}
                  style={styles.input}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="DELETE"
                  placeholderTextColor={colors.muted}
                  maxLength={6}
                  testID="account-deletion-confirmation"
                />
              </View>
              <PrimaryButton
                title="Request account deletion"
                onPress={() => { void submit(); }}
                loading={busy}
                disabled={!canSubmit}
                testID="account-deletion-submit"
              />
            </View>
          </>
        )}
      </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  hero: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  heroIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: colors.errorBg, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", textAlign: "center" },
  body: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md },
  cardTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  statusHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  infoText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 },
  reference: { color: colors.brandDeep, fontSize: 13, fontWeight: "700" },
  reason: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19, backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.md },
  link: { color: colors.brandPrimary, fontSize: 14, fontWeight: "700", paddingVertical: spacing.sm },
  field: { gap: spacing.sm },
  fieldLabel: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  input: { height: 52, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, paddingHorizontal: spacing.md, color: colors.onSurface, backgroundColor: colors.surface, fontSize: 15 },
}));

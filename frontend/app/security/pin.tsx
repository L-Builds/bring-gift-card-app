import React, { useState } from "react";
import { View, Text, Pressable, Modal, TextInput } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, LoadingView, PrimaryButton } from "@/src/components/ui";
import { PinPad } from "@/src/components/pin-pad";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/context/auth";
import { api, ApiError } from "@/src/api/client";

type PinStatus = { has_pin: boolean; locked_until: string | null; can_reset_with_password: boolean };
type Step = "current" | "new" | "confirm";

export default function TransactionPin() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { isGuest, loading: authLoading, refresh } = useAuth();

  const { data, isLoading } = useQuery({ queryKey: ["pin-status"], queryFn: () => api.get<PinStatus>("/security/pin"), enabled: !isGuest });

  const [step, setStep] = useState<Step | null>(null);
  const [current, setCurrent] = useState("");
  const [first, setFirst] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [password, setPassword] = useState("");
  const [resetPin, setResetPin] = useState("");

  if (authLoading) return <ScreenBackground><StackHeader title="Transaction PIN" /><LoadingView /></ScreenBackground>;
  if (isGuest) return <Redirect href="/(auth)/login" />;
  if (isLoading || !data) return <ScreenBackground><StackHeader title="Transaction PIN" /><LoadingView /></ScreenBackground>;

  const hasPin = data.has_pin;
  const activeStep: Step = step ?? (hasPin ? "current" : "new");
  const bump = () => setAttempt((a) => a + 1);

  const save = async (pin: string, currentPin: string) => {
    setBusy(true);
    try {
      await api.post("/security/pin", { pin, current_pin: currentPin });
      await qc.invalidateQueries({ queryKey: ["pin-status"] });
      await refresh();
      toast.show(hasPin ? "Transaction PIN changed" : "Transaction PIN set — required for withdrawals", "success");
      if (router.canGoBack()) router.back(); else router.replace("/(tabs)/profile");
    } catch (e) {
      setError(true);
      toast.show(e instanceof ApiError ? e.message : "Could not save PIN", "error");
      setStep(hasPin ? "current" : "new");
      setFirst("");
      setCurrent("");
      bump();
    } finally {
      setBusy(false);
    }
  };

  const onComplete = (pin: string) => {
    setError(false);
    if (activeStep === "current") {
      setCurrent(pin);
      setStep("new");
      bump();
    } else if (activeStep === "new") {
      setFirst(pin);
      setStep("confirm");
      bump();
    } else {
      if (pin !== first) {
        setError(true);
        toast.show("PINs don't match. Try again.", "error");
        setStep("new");
        setFirst("");
        bump();
        return;
      }
      save(pin, current);
    }
  };

  const onReset = async () => {
    if (!password) return toast.show("Enter your account password", "error");
    if (!/^\d{4}$/.test(resetPin)) return toast.show("Enter a new 4-digit PIN", "error");
    setBusy(true);
    try {
      await api.post("/security/pin/reset", { password, pin: resetPin });
      await qc.invalidateQueries({ queryKey: ["pin-status"] });
      await refresh();
      setForgot(false);
      toast.show("PIN reset successfully", "success");
      if (router.canGoBack()) router.back(); else router.replace("/(tabs)/profile");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not reset PIN", "error");
    } finally {
      setBusy(false);
    }
  };

  const title = activeStep === "current" ? "Enter your current PIN" : activeStep === "new" ? (hasPin ? "Enter a new PIN" : "Create your PIN") : "Confirm your PIN";
  const sub = activeStep === "current" ? "For your security, confirm the PIN you use today."
    : activeStep === "new" ? "Choose 4 digits you'll remember. Avoid 1234 or repeated numbers."
    : "Enter the same 4 digits again.";

  return (
    <ScreenBackground>
      <StackHeader title="Transaction PIN" />
      <View style={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Ionicons name="keypad" size={28} color={colors.brandPrimary} /></View>
          <Text style={styles.title} testID="pin-step-title">{title}</Text>
          <Text style={styles.sub}>{sub}</Text>
          {!!data.locked_until && (
            <View style={styles.lock}><Ionicons name="lock-closed" size={16} color={colors.error} /><Text style={styles.lockText}>PIN temporarily locked after too many attempts.</Text></View>
          )}
        </View>

        <PinPad onComplete={onComplete} resetKey={attempt} error={error} disabled={busy} testID="pin" />

        <View style={styles.footer}>
          <View style={styles.steps}>
            {(hasPin ? ["current", "new", "confirm"] : ["new", "confirm"]).map((s) => (
              <View key={s} style={[styles.stepDot, s === activeStep && styles.stepDotActive]} />
            ))}
          </View>
          {hasPin && data.can_reset_with_password && (
            <Pressable onPress={() => { setPassword(""); setResetPin(""); setForgot(true); }} testID="pin-forgot">
              <Text style={styles.link}>Forgot PIN?</Text>
            </Pressable>
          )}
          {hasPin && !data.can_reset_with_password && (
            <Pressable onPress={() => router.push("/support/new?category=account&subject=Reset%20my%20transaction%20PIN")} testID="pin-forgot-support">
              <Text style={styles.link}>Forgot PIN? Contact support</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Modal visible={forgot} transparent animationType="slide" onRequestClose={() => setForgot(false)}>
        <Pressable style={styles.overlay} onPress={() => setForgot(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Reset PIN with password</Text>
            <Text style={styles.sheetSub}>Confirm your account password, then choose a new 4-digit PIN.</Text>
            <View style={styles.input}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.muted} />
              <TextInput style={styles.inputText} placeholder="Account password" placeholderTextColor={colors.muted} secureTextEntry value={password} onChangeText={setPassword} testID="pin-reset-password" />
            </View>
            <View style={styles.input}>
              <Ionicons name="keypad-outline" size={20} color={colors.muted} />
              <TextInput style={styles.inputText} placeholder="New 4-digit PIN" placeholderTextColor={colors.muted} keyboardType="number-pad" maxLength={4} secureTextEntry value={resetPin} onChangeText={(t) => setResetPin(t.replace(/[^0-9]/g, ""))} testID="pin-reset-new" />
            </View>
            <PrimaryButton title="Reset PIN" onPress={onReset} loading={busy} testID="pin-reset-submit" style={{ marginTop: spacing.sm }} />
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  body: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: "space-between" },
  hero: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.md },
  heroIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs },
  title: { fontSize: 22, fontWeight: "800", color: colors.onSurface, textAlign: "center" },
  sub: { color: colors.muted, textAlign: "center", fontSize: 14, lineHeight: 20, paddingHorizontal: spacing.lg },
  lock: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.errorBg, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6, marginTop: spacing.xs },
  lockText: { color: colors.error, fontSize: 12, fontWeight: "600" },
  footer: { alignItems: "center", gap: spacing.md },
  steps: { flexDirection: "row", gap: 6 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  stepDotActive: { backgroundColor: colors.brandPrimary, width: 20 },
  link: { color: colors.brandPrimary, fontWeight: "700", paddingVertical: spacing.sm },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center" },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  sheetSub: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  input: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.lg, height: 56 },
  inputText: { flex: 1, fontSize: 15, color: colors.onSurface },
}));

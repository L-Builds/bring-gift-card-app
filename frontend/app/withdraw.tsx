import React, { useEffect, useState, useRef } from "react";
import { View, Text, Pressable, TextInput, Modal } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, PrimaryButton, BrandMonogram, EmptyState } from "@/src/components/ui";
import { PinPad } from "@/src/components/pin-pad";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/context/auth";
import { api, ApiError } from "@/src/api/client";
import { formatNaira, toMinor } from "@/src/lib/format";

type Account = { id: string; provider_name: string; account_number: string; account_name: string };

export default function Withdraw() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { refresh, user } = useAuth();

  const requestKey = useRef(`wd_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const [amount, setAmount] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [narration, setNarration] = useState("");
  const [loading, setLoading] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinAttempt, setPinAttempt] = useState(0);
  const [pinError, setPinError] = useState(false);

  const { data: wallet } = useQuery({ queryKey: ["wallet"], queryFn: () => api.get<{ available_balance_kobo: number }>("/wallet") });
  const { data: accData } = useQuery({ queryKey: ["payout-accounts"], queryFn: () => api.get<{ accounts: Account[] }>("/payout-accounts") });

  useEffect(()=>{requestKey.current=`wd_${Date.now()}_${Math.random().toString(36).slice(2)}`;},[amount,selected]);
  const balance = wallet?.available_balance_kobo ?? 0;
  const accounts = accData?.accounts ?? [];

  useEffect(() => {
    if (!selected && accounts.length > 0) setSelected(accounts[0].id);
  }, [accounts, selected]);

  const setAll = () => setAmount(String(balance / 10 ** (user?.minor_digits ?? 2)));

  const validate = () => {
    const kobo = toMinor(amount, user?.minor_digits ?? 2);
    if (!kobo) return toast.show("Enter a valid withdrawal amount", "error"), null;
    if (kobo > balance) return toast.show("Amount exceeds your available balance", "error"), null;
    if (!selected) return toast.show("Select a payout account", "error"), null;
    return kobo;
  };

  const onPressWithdraw = () => {
    if (loading) return;
    if (validate() === null) return;
    if (!user?.has_pin) {
      toast.show("Set a 4-digit transaction PIN to protect withdrawals", "info", { actionLabel: "Set PIN", onPress: () => router.push("/security/pin") });
      return;
    }
    setPinError(false);
    setPinAttempt((a) => a + 1);
    setPinOpen(true);
  };

  const submit = async (pin: string) => {
    const kobo = validate();
    if (kobo === null) return setPinOpen(false);
    setLoading(true);
    try {
      const w = await api.post<{ ref: string }>("/withdrawals", { amount_kobo: kobo, payout_account_id: selected, narration, pin }, true, {"Idempotency-Key": requestKey.current});
      setPinOpen(false);
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      await refresh();
      toast.show(`Withdrawal ${w.ref} submitted`, "success");
      if (router.canGoBack()) router.back();
      else router.replace("/wallet");
    } catch (e) {
      if (e instanceof ApiError && e.code === "PIN_REQUIRED") {
        setPinOpen(false);
        toast.show(e.message, "error", { actionLabel: "Set PIN", onPress: () => router.push("/security/pin") });
      } else if (e instanceof ApiError && e.code === "PIN_WRONG") {
        setPinError(true);
        setPinAttempt((a) => a + 1);
        toast.show(e.message, "error");
      } else if (e instanceof ApiError && e.code === "PIN_LOCKED") {
        setPinOpen(false);
        toast.show(e.message, "error", { duration: 5000 });
      } else {
        setPinOpen(false);
        toast.show(e instanceof ApiError ? e.message : "Withdrawal failed", "error");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenBackground>
      <StackHeader title="Withdraw" />
      <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + 100, gap: spacing.lg }}>
        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>Enter amount</Text>
          <View style={styles.amountRow}>
            <TextInput
              style={styles.amountInput}
              placeholder={`${user?.currency || "NGN"} amount`}
              placeholderTextColor={colors.onSurface}
              keyboardType="number-pad"
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
              testID="withdraw-amount"
            />
            <Pressable style={styles.allBtn} onPress={setAll} testID="withdraw-all"><Text style={styles.allText}>ALL</Text></Pressable>
          </View>
          <View style={styles.balInfo}>
            <Ionicons name="wallet" size={16} color={colors.brandPrimary} />
            <Text style={styles.balText}>Available: {formatNaira(balance)}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Payout account</Text>
        {accounts.length === 0 ? (
          <View style={styles.emptyCard}>
            <EmptyState icon="card-outline" title="No payout account" subtitle="Add a payout account to withdraw your funds." />
            <PrimaryButton title="Add Payout Account" onPress={() => router.push("/add-payout-account")} testID="withdraw-add-account" />
          </View>
        ) : (
          accounts.map((a) => {
            const active = selected === a.id;
            return (
              <Pressable key={a.id} style={[styles.account, active && styles.accountActive]} onPress={() => setSelected(a.id)} testID={`withdraw-account-${a.id}`}>
                <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={22} color={active ? colors.brandPrimary : colors.muted} />
                <BrandMonogram name={a.provider_name} color={colors.brandPrimary} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.accName}>{a.provider_name}</Text>
                  <Text style={styles.accNum}>{a.account_number}</Text>
                  <Text style={styles.accHolder}>{a.account_name}</Text>
                </View>
              </Pressable>
            );
          })
        )}

        {accounts.length > 0 && (
          <View style={styles.narrationField}>
            <Ionicons name="document-text-outline" size={20} color={colors.muted} />
            <TextInput style={styles.narrationInput} placeholder="Narration (Optional)" placeholderTextColor={colors.muted} value={narration} onChangeText={setNarration} testID="withdraw-narration" />
          </View>
        )}
      </KeyboardAwareScrollView>

      {accounts.length > 0 && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          {!user?.has_pin && (
            <Pressable style={styles.pinHint} onPress={() => router.push("/security/pin")} testID="withdraw-set-pin">
              <Ionicons name="keypad" size={16} color={colors.brandPrimary} />
              <Text style={styles.pinHintText}>Set a transaction PIN to enable withdrawals</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.brandPrimary} />
            </Pressable>
          )}
          <PrimaryButton title="Withdraw Funds" icon="arrow-forward" onPress={onPressWithdraw} loading={loading} testID="withdraw-submit" />
        </View>
      )}

      <Modal visible={pinOpen} transparent animationType="slide" onRequestClose={() => !loading && setPinOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => !loading && setPinOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Enter transaction PIN</Text>
            <Text style={styles.sheetSub}>Confirm withdrawal of <Text style={{ fontWeight: "800", color: colors.onSurface }}>{formatNaira(parseInt(amount || "0", 10) * 100)}</Text></Text>
            <PinPad onComplete={submit} resetKey={pinAttempt} error={pinError} disabled={loading} testID="withdraw-pin" />
            <Pressable onPress={() => router.push("/security/pin")} style={{ alignSelf: "center", paddingTop: spacing.md }} testID="withdraw-pin-forgot">
              <Text style={styles.link}>Forgot PIN?</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  amountCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl },
  amountLabel: { color: colors.muted, fontSize: 14 },
  amountRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  amountInput: { flex: 1, fontSize: 34, fontWeight: "800", color: colors.onSurface, padding: 0 },
  allBtn: { backgroundColor: colors.brandSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, height: 40, alignItems: "center", justifyContent: "center" },
  allText: { color: colors.brandPrimary, fontWeight: "800" },
  balInfo: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brandSecondary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  balText: { color: colors.brandPrimary, fontWeight: "600", fontSize: 13 },
  sectionLabel: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md },
  account: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1.5, borderColor: colors.surface },
  accountActive: { borderColor: colors.brandPrimary },
  accName: { fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  accNum: { color: colors.onSurfaceSecondary, fontSize: 13 },
  accHolder: { color: colors.muted, fontSize: 12 },
  narrationField: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.lg, height: 56 },
  narrationInput: { flex: 1, fontSize: 15, color: colors.onSurface },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.screenBg, gap: spacing.sm },
  pinHint: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brandSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 40 },
  pinHintText: { flex: 1, color: colors.brandPrimary, fontWeight: "700", fontSize: 12 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center" },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface, textAlign: "center" },
  sheetSub: { color: colors.muted, fontSize: 14, textAlign: "center", marginBottom: spacing.sm },
  link: { color: colors.brandPrimary, fontWeight: "700" },
}));

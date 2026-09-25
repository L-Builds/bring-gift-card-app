import React, { useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { PrimaryButton } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { api, ApiError } from "@/src/api/client";

export default function ForgotPassword() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();

  const params = useLocalSearchParams<{token?:string}>();
  const [step, setStep] = useState<1 | 2>(params.token ? 2 : 1);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState(params.token || "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const requestReset = async () => {
    if (!email.trim()) return toast.show("Enter your email", "error");
    setLoading(true);
    try {
      const res = await api.post<{ message: string; dev_token?: string }>("/auth/password-reset/request", { email: email.trim() }, false);
      if (res.dev_token) setToken(res.dev_token);
      toast.show(res.dev_token ? "Reset code ready — set a new password" : res.message, "success");
      setStep(2);
    } catch(e) {
      toast.show(e instanceof ApiError ? e.message : "Could not process request", "error");
    } finally {
      setLoading(false);
    }
  };

  const confirmReset = async () => {
    if (!token.trim()) return toast.show("Enter the reset code", "error");
    if (password.length < 10) return toast.show("Password must be at least 10 characters", "error");
    setLoading(true);
    try {
      await api.post("/auth/password-reset/confirm", { token: token.trim(), password }, false);
      toast.show("Password updated. Please log in.", "success");
      router.replace("/(auth)/login");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Reset failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.screenBg }}>
      <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
        <View style={[styles.top, { paddingTop: insets.top + spacing.md }]}>
          <Pressable style={styles.back} onPress={() => router.back()} testID="forgot-back">
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.sub}>
            {step === 1 ? "Enter your account email to receive a reset code." : "Enter the reset code and choose a new password."}
          </Text>
        </View>

        <View style={styles.card}>
          {step === 1 ? (
            <>
              <View style={styles.input}>
                <Ionicons name="mail-outline" size={20} color={colors.muted} />
                <TextInput style={styles.inputText} placeholder="Enter your email" placeholderTextColor={colors.muted} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} testID="forgot-email" />
              </View>
              <PrimaryButton title="Send Reset Code" onPress={requestReset} loading={loading} testID="forgot-send" style={{ marginTop: spacing.sm }} />
            </>
          ) : (
            <>
              <View style={styles.input}>
                <Ionicons name="key-outline" size={20} color={colors.muted} />
                <TextInput style={styles.inputText} placeholder="Reset code" placeholderTextColor={colors.muted} autoCapitalize="none" value={token} onChangeText={setToken} testID="forgot-token" />
              </View>
              <View style={styles.input}>
                <Ionicons name="lock-closed-outline" size={20} color={colors.muted} />
                <TextInput style={styles.inputText} placeholder="New password" placeholderTextColor={colors.muted} secureTextEntry value={password} onChangeText={setPassword} testID="forgot-new-password" />
              </View>
              <PrimaryButton title="Update Password" onPress={confirmReset} loading={loading} testID="forgot-confirm" style={{ marginTop: spacing.sm }} />
            </>
          )}
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  top: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface },
  sub: { fontSize: 14, color: colors.muted, marginTop: 6, lineHeight: 20 },
  card: { backgroundColor: colors.surface, marginHorizontal: spacing.lg, borderRadius: radius.xxl, padding: spacing.xl, shadowColor: colors.shadow, shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  input: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.lg, height: 56, marginBottom: spacing.md },
  inputText: { flex: 1, fontSize: 15, color: colors.onSurface },
}));

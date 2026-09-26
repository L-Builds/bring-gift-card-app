import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { PrimaryButton } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/context/auth";
import { ApiError } from "@/src/api/client";
import { startGoogleSignIn } from "@/src/lib/google-auth";

export default function Login() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { login, loginWithGoogle, user, googleBusy } = useAuth();

  const [tab, setTab] = useState<"email" | "phone">("email");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gLoading, setGLoading] = useState(false);

  useEffect(() => {
    if (user) router.replace(user.role === "admin" ? "/admin" : "/(tabs)");
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeTab = (next: "email" | "phone") => {
    setTab(next);
    setIdentifier("");
  };

  const onGoogle = async () => {
    setGLoading(true);
    try {
      const sid = await startGoogleSignIn();
      if (!sid) return;
      const u = await loginWithGoogle(sid);
      if (u) toast.show(`Welcome, ${u.full_name.split(" ")[0]}!`, "success");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Google sign-in failed", "error");
    } finally {
      setGLoading(false);
    }
  };

  const onLogin = async () => {
    const value = identifier.trim();
    if (!value || !password) {
      return toast.show(tab === "email" ? "Enter your email and password" : "Enter your phone number and password", "error");
    }
    setLoading(true);
    try {
      const u = await login(value, password, tab);
      toast.show(`Welcome back, ${u.full_name.split(" ")[0]}!`, "success");
      router.replace(u.role === "admin" ? "/admin" : "/(tabs)");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Login failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={[colors.screenBgAlt, colors.screenBg]} style={styles.screen}>
      <KeyboardAwareScrollView bottomOffset={20} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
          <Pressable style={styles.back} onPress={() => router.replace("/(tabs)")} testID="login-back" accessibilityLabel="Back to Home">
            <Ionicons name="arrow-back" size={21} color={colors.onSurface} />
          </Pressable>

          <View style={styles.brandRow}>
            <Image source={require("../../assets/brand/logo-blue.png")} style={styles.logo} contentFit="contain" />
            <Text style={styles.brandTitle}>Bring Gift Card</Text>
          </View>

          <Image source={require("../../assets/auth/login-hero-art.jpg")} style={styles.heroArt} contentFit="cover" />
          <View style={styles.heroCopy}>
            <Text style={styles.hello}>Hello Again,</Text>
            <Text style={styles.welcome}>Welcome Back 👋</Text>
            <Text style={styles.sub}>Sign in to continue trading gift cards securely</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.tabs}>
            <Pressable onPress={() => changeTab("email")} style={styles.tab} testID="login-tab-email">
              <Text style={[styles.tabText, tab === "email" && styles.tabTextActive]}>Email</Text>
              {tab === "email" && <View style={styles.tabUnderline} />}
            </Pressable>
            <Pressable onPress={() => changeTab("phone")} style={styles.tab} testID="login-tab-phone">
              <Text style={[styles.tabText, tab === "phone" && styles.tabTextActive]}>Phone Number</Text>
              {tab === "phone" && <View style={styles.tabUnderline} />}
            </Pressable>
          </View>

          <View style={styles.input}>
            <Ionicons name={tab === "email" ? "mail-outline" : "call-outline"} size={20} color={colors.muted} />
            <TextInput
              style={styles.inputText}
              placeholder={tab === "email" ? "Enter your email" : "Enter your phone number"}
              placeholderTextColor={colors.muted}
              keyboardType={tab === "email" ? "email-address" : "phone-pad"}
              autoCapitalize="none"
              autoCorrect={false}
              value={identifier}
              onChangeText={setIdentifier}
              testID={tab === "email" ? "login-email" : "login-phone"}
            />
          </View>

          <View style={styles.input}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.muted} />
            <TextInput
              style={styles.inputText}
              placeholder="Enter password"
              placeholderTextColor={colors.muted}
              secureTextEntry={!show}
              value={password}
              onChangeText={setPassword}
              testID="login-password"
            />
            <Pressable onPress={() => setShow((s) => !s)} hitSlop={10} accessibilityLabel={show ? "Hide password" : "Show password"}>
              <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={20} color={colors.muted} />
            </Pressable>
          </View>

          <Pressable style={styles.forgot} onPress={() => router.push("/(auth)/forgot-password")} testID="login-forgot">
            <Text style={styles.forgotText}>Forgot Password?</Text>
          </Pressable>

          <Text style={styles.agreeText}><Text style={styles.policyText} onPress={()=>router.push("/legal/privacy")}>Privacy Policy</Text> · <Text style={styles.policyText} onPress={()=>router.push("/legal/terms")}>Terms & Conditions</Text></Text>

          <PrimaryButton title="Log In" onPress={onLogin} loading={loading} testID="login-submit" style={styles.primaryButton} />

          <View style={styles.signupRow}>
            <Text style={styles.muted}>Don&apos;t have an account? </Text>
            <Pressable onPress={() => router.replace("/(auth)/signup")} testID="login-goto-signup">
              <Text style={styles.link}>Sign Up</Text>
            </Pressable>
          </View>

          <View style={styles.orRow}>
            <View style={styles.line} />
            <Text style={styles.orText}>Or Log In With</Text>
            <View style={styles.line} />
          </View>

          <View style={styles.socialRow}>
            <Pressable style={styles.socialBtn} onPress={onGoogle} disabled={gLoading || googleBusy} testID="login-google" accessibilityLabel="Continue with Google">
              {gLoading || googleBusy ? <ActivityIndicator color={colors.brandPrimary} /> : <Ionicons name="logo-google" size={28} color="#DB4437" />}
            </Pressable>
            <View style={[styles.socialBtn, styles.socialDisabled]} accessibilityLabel="Apple sign-in unavailable">
              <Ionicons name="logo-apple" size={29} color={colors.onSurface} />
            </View>
          </View>

          <Text style={styles.footer}>Trade Gift Cards Instantly & Securely</Text>
        </View>
      </KeyboardAwareScrollView>
    </LinearGradient>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1 },
  scroll: { paddingBottom: spacing.xxxl },
  hero: { minHeight: 338, paddingHorizontal: spacing.lg, position: "relative", overflow: "hidden" },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm, zIndex: 4 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, zIndex: 3 },
  logo: { width: 52, height: 52 },
  brandTitle: { fontSize: 25, fontWeight: "800", color: colors.onSurface },
  heroArt: { position: "absolute", right: 2, top: 64, width: 196, height: 192, borderRadius: 22, opacity: 0.98 },
  heroCopy: { marginTop: 74, width: "68%", zIndex: 3 },
  hello: { fontSize: 16, color: colors.onSurfaceSecondary },
  welcome: { fontSize: 31, lineHeight: 36, fontWeight: "800", color: colors.onSurface, marginTop: 4 },
  sub: { fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: spacing.sm, maxWidth: 260 },
  card: { backgroundColor: colors.surface, marginTop: -18, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxl, minHeight: 560 },
  tabs: { flexDirection: "row", gap: spacing.xxl, marginBottom: spacing.xl },
  tab: { alignItems: "center" },
  tabText: { fontSize: 18, fontWeight: "600", color: colors.onSurfaceSecondary },
  tabTextActive: { color: colors.brandPrimary, fontWeight: "800" },
  tabUnderline: { height: 4, width: 44, borderRadius: 2, backgroundColor: colors.brandPrimary, marginTop: 8 },
  input: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1.4, borderColor: colors.borderStrong, borderRadius: radius.xl, paddingHorizontal: spacing.lg, height: 60, marginBottom: spacing.md, backgroundColor: colors.surface },
  inputText: { flex: 1, fontSize: 16, color: colors.onSurface },
  forgot: { alignSelf: "flex-end", marginTop: -2 },
  forgotText: { color: colors.brandLink, fontWeight: "700", fontSize: 15, textDecorationLine: "underline" },
  agreeRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xl, alignItems: "flex-start" },
  checkbox: { width: 24, height: 24, borderRadius: 5, borderWidth: 1.6, borderColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  checkboxActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  agreeText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13.5, lineHeight: 20 },
  policyText: { color: colors.brandLink, fontWeight: "700" },
  primaryButton: { marginTop: spacing.xl },
  signupRow: { flexDirection: "row", justifyContent: "center", marginTop: spacing.xl },
  muted: { color: colors.onSurfaceSecondary, fontSize: 15 },
  link: { color: colors.brandPrimary, fontWeight: "800", fontSize: 15 },
  orRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.xl },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { color: colors.muted, fontSize: 13.5 },
  socialRow: { flexDirection: "row", justifyContent: "center", gap: spacing.lg, marginTop: spacing.lg },
  socialBtn: { width: 58, height: 58, borderRadius: 29, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", shadowColor: colors.shadow, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  socialDisabled: { opacity: 0.48 },
  footer: { textAlign: "center", color: colors.muted, fontSize: 12.5, marginTop: spacing.xxl },
}));

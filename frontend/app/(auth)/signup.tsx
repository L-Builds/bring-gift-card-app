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
import { useQuery } from "@tanstack/react-query";
import { Market } from "@/src/lib/market";
import { Modal, ScrollView } from "react-native";
import { api, ApiError } from "@/src/api/client";
import { startGoogleSignIn } from "@/src/lib/google-auth";

function Input({ icon, ...props }: any) { const styles = useStyles(); const {colors} = useTheme(); return (
    <View style={styles.input}>
      <Ionicons name={icon} size={21} color={colors.muted} />
      <TextInput style={styles.inputText} placeholderTextColor={colors.muted} {...props} />
    </View>
  );
}

export default function Signup() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { signup, loginWithGoogle, user, googleBusy } = useAuth();

  const [market, setMarket] = useState<Market | null>(null);
  const [countryOpen, setCountryOpen] = useState(false);
  const markets = useQuery({queryKey:["markets"],queryFn:()=>api.get<{markets:Market[]}>("/markets",false)});
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gLoading, setGLoading] = useState(false);

  useEffect(() => {
    if (user) router.replace(user.role === "admin" ? "/admin" : "/(tabs)");
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const onSignup = async () => {
    if (!fullName.trim() || !email.trim() || !phone.trim() || !password) return toast.show("Please fill in all fields", "error");
    if (password.length < 10) return toast.show("Password must be at least 10 characters", "error");
    if (!agree) return toast.show("Please accept the Terms & Privacy Policy", "error");
    if (!market) return toast.show("Select your country", "error");
    setLoading(true);
    try {
      const u = await signup({ full_name: fullName.trim(), email: email.trim(), phone: phone.trim(), password, market_code: market.code, accepted_terms: agree });
      toast.show(`Welcome, ${u.full_name.split(" ")[0]}!`, "success");
      router.replace("/(tabs)");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Sign up failed", "error");
    } finally {
      setLoading(false);
    }
  };



  return (
    <LinearGradient colors={[colors.screenBgAlt, colors.screenBg]} style={styles.screen}>
      <KeyboardAwareScrollView bottomOffset={20} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
          <Pressable style={styles.back} onPress={() => router.replace("/(tabs)")} testID="signup-back" accessibilityLabel="Back to Home">
            <Ionicons name="arrow-back" size={21} color={colors.onSurface} />
          </Pressable>

          <View style={styles.brandRow}>
            <Image source={require("../../assets/brand/logo-blue.png")} style={styles.logo} contentFit="contain" />
            <View>
              <Text style={styles.brandTitle}>Bring Gift Card</Text>
              <Text style={styles.brandTag}>Trade Gift Cards Securely</Text>
            </View>
          </View>

          <Image source={require("../../assets/auth/signup-hero-art.jpg")} style={styles.heroArt} contentFit="cover" />
          <View style={styles.heroCopy}>
            <Text style={styles.welcome}>Create Your <Text style={{ color: colors.brandPrimary }}>Account</Text></Text>
            <Text style={styles.sub}>Start trading gift cards in minutes.</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Pressable style={[styles.input, styles.countryField]} onPress={()=>setCountryOpen(true)} testID="signup-country"><Text style={styles.countryText}>{market ? `${market.name} · ${market.currency}` : "Select country / wallet currency"}</Text></Pressable>
          <Modal visible={countryOpen} transparent animationType="slide" onRequestClose={()=>setCountryOpen(false)}><View style={{flex:1,justifyContent:"center",backgroundColor:"#0008",padding:24}}><ScrollView style={{backgroundColor:"white",borderRadius:20,maxHeight:500}}>{markets.error && <Text>{markets.error.message}</Text>}{markets.data?.markets.map(m=><Pressable key={m.code} style={{padding:18}} onPress={()=>{setMarket(m);setCountryOpen(false);}}><Text>{m.name} · {m.currency}</Text></Pressable>)}<Pressable style={{padding:18}} onPress={()=>setCountryOpen(false)}><Text>Close</Text></Pressable></ScrollView></View></Modal>

          <Input icon="person-outline" placeholder="Full Name" value={fullName} onChangeText={setFullName} testID="signup-name" />
          <Input icon="mail-outline" placeholder="Email Address" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} value={email} onChangeText={setEmail} testID="signup-email" />
          <Input icon="call-outline" placeholder="Phone Number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} testID="signup-phone" />

          <View style={styles.input}>
            <Ionicons name="lock-closed-outline" size={21} color={colors.muted} />
            <TextInput style={styles.inputText} placeholder="Create Password" placeholderTextColor={colors.muted} secureTextEntry={!show} value={password} onChangeText={setPassword} testID="signup-password" />
            <Pressable onPress={() => setShow((s) => !s)} hitSlop={10} accessibilityLabel={show ? "Hide password" : "Show password"}>
              <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={20} color={colors.muted} />
            </Pressable>
          </View>

          <Pressable style={styles.agreeRow} onPress={() => setAgree((a) => !a)} testID="signup-agree">
            <View style={[styles.checkbox, agree && styles.checkboxActive]}>
              {agree && <Ionicons name="checkmark" size={14} color={colors.onBrandPrimary} />}
            </View>
            <Text style={styles.agreeText}>
              By signing up, you agree to our <Text style={styles.policyText} onPress={()=>router.push("/legal/privacy")}>Privacy Policy</Text> and <Text style={styles.policyText} onPress={()=>router.push("/legal/terms")}>Terms & Conditions</Text>
            </Text>
          </Pressable>

          <PrimaryButton title="Sign Up" onPress={onSignup} loading={loading} testID="signup-submit" style={styles.primaryButton} />

          <View style={styles.signupRow}>
            <Text style={styles.muted}>Already have an account? </Text>
            <Pressable onPress={() => router.replace("/(auth)/login")} testID="signup-goto-login">
              <Text style={styles.link}>Log In</Text>
            </Pressable>
          </View>

          <View style={styles.orRow}>
            <View style={styles.line} />
            <Text style={styles.orText}>Or Sign Up With</Text>
            <View style={styles.line} />
          </View>

          <View style={styles.socialRow}>
            <Pressable style={styles.socialBtn} onPress={onGoogle} disabled={gLoading || googleBusy} testID="signup-google" accessibilityLabel="Continue with Google">
              {gLoading || googleBusy ? <ActivityIndicator color={colors.brandPrimary} /> : <Ionicons name="logo-google" size={28} color="#DB4437" />}
            </Pressable>
            <View style={[styles.socialBtn, styles.socialDisabled]} accessibilityLabel="Apple sign-up unavailable">
              <Ionicons name="logo-apple" size={29} color={colors.onSurface} />
            </View>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </LinearGradient>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1 },
  scroll: { paddingBottom: spacing.xxxl },
  hero: { minHeight: 318, paddingHorizontal: spacing.lg, position: "relative", overflow: "hidden" },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm, zIndex: 4 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, zIndex: 3 },
  logo: { width: 54, height: 54 },
  brandTitle: { fontSize: 24, fontWeight: "800", color: colors.onSurface },
  brandTag: { fontSize: 12.5, color: colors.onSurfaceSecondary, marginTop: 1 },
  heroArt: { position: "absolute", right: 4, top: 65, width: 180, height: 180, borderRadius: 22 },
  heroCopy: { marginTop: 68, width: "68%", zIndex: 3 },
  welcome: { fontSize: 30, lineHeight: 35, fontWeight: "800", color: colors.onSurface },
  sub: { fontSize: 15, color: colors.muted, marginTop: spacing.sm },
  card: { backgroundColor: colors.surface, marginTop: -12, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  input: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1.4, borderColor: colors.borderStrong, borderRadius: radius.xl, paddingHorizontal: spacing.lg, height: 60, marginBottom: spacing.md, backgroundColor: colors.surface },
  inputText: { flex: 1, fontSize: 16, color: colors.onSurface },
  countryField: { backgroundColor: colors.surfaceSecondary },
  flag: { width: 26, height: 26, borderRadius: 13, overflow: "hidden", flexDirection: "row" },
  countryText: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.onSurface },
  agreeRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm, alignItems: "flex-start" },
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
}));

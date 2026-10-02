import React, { useEffect, useRef, useState } from "react";
import { Pressable, Animated, Easing, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/src/theme";
import { useAuth } from "@/src/context/auth";
import { takeGoogleTradeIntent, tradeHref } from "@/src/lib/trade-intent";
import { takeGoogleAccountDeletionReturn } from "@/src/lib/account-deletion-return";

export default function Splash() {
  const router = useRouter();
  const { colors } = useTheme();
  const { loading, user, googleSignInCompleted } = useAuth();
  const [animationComplete, setAnimationComplete] = useState(false);
  const routed = useRef(false);

  const scale = useRef(new Animated.Value(1)).current;
  const logoFade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!animationComplete || loading || routed.current) return;
    routed.current = true;
    const intent = googleSignInCompleted ? takeGoogleTradeIntent() : null;
    const returnToDeleteAccount = googleSignInCompleted && takeGoogleAccountDeletionReturn();
    router.replace(user?.role === "admin" ? "/admin" : user && returnToDeleteAccount ? "/delete-account" : user && intent ? tradeHref(intent) : "/(tabs)");
  }, [animationComplete, googleSignInCompleted, loading, router, user]);

  useEffect(() => {
    // Hold the centered logo completely still, then continue the existing zoom-through/fade transition.
    const animation = Animated.sequence([
      Animated.delay(1500),
      Animated.parallel([
        Animated.timing(scale, { toValue: 6, duration: 900, easing: Easing.in(Easing.cubic), useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(logoFade, { toValue: 0, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== "web" }),
      ]),
    ]);
    animation.start(({ finished }) => { if (finished) setAnimationComplete(true); });
    return () => animation.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Pressable style={{ flex: 1 }} onPress={() => setAnimationComplete(true)} testID="splash-skip">
      <LinearGradient colors={[colors.screenBgAlt, colors.screenBg]} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Animated.View style={{ opacity: logoFade, transform: [{ scale }] }}>
          <Image
            source={require("../assets/brand/logo-blue.png")}
            style={{ width: 170, height: 170 }}
            contentFit="contain"
          />
        </Animated.View>
      </LinearGradient>
    </Pressable>
  );
}

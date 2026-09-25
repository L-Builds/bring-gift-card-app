import React, { useEffect, useRef, useState } from "react";
import { View, Pressable, Animated, Easing, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/src/theme";
import { useAuth } from "@/src/context/auth";

export default function Splash() {
  const router = useRouter();
  const { colors } = useTheme();
  const { loading } = useAuth();
  const [done, setDone] = useState(false);

  const scale = useRef(new Animated.Value(1)).current;
  const logoFade = useRef(new Animated.Value(1)).current;

  const finish = () => {
    if (done) return;
    setDone(true);
    // Home tab is reachable by guests; auth gating happens on protected actions.
    router.replace("/(tabs)");
  };

  useEffect(() => {
    // Hold the centered logo completely still, then continue the existing zoom-through/fade transition.
    Animated.sequence([
      Animated.delay(1500),
      Animated.parallel([
        Animated.timing(scale, { toValue: 6, duration: 900, easing: Easing.in(Easing.cubic), useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(logoFade, { toValue: 0, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== "web" }),
      ]),
    ]).start(() => finish());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Pressable style={{ flex: 1 }} onPress={finish} testID="splash-skip">
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

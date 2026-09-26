import { useCardRates, rateLabel } from "@/src/lib/market";
import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { AppHeader } from "@/src/components/app-header";
import { ScreenBackground, BrandMonogram, LoadingView } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { api } from "@/src/api/client";
import { formatNaira } from "@/src/lib/format";

type Brand = { id: string; name: string; color: string; rate_kobo_per_usd: number; category: string };

const BRAND_IMAGES: Record<string, any> = {
  "apple/itunes": require("../../assets/home/brands/apple-itunes.png"),
  "razer gold": require("../../assets/home/brands/razer-gold.png"),
  steam: require("../../assets/home/brands/steam.png"),
  playstation: require("../../assets/home/brands/playstation.png"),
  xbox: require("../../assets/home/brands/xbox.png"),
  amazon: require("../../assets/home/brands/amazon.png"),
  "google play": require("../../assets/home/brands/google-play.png"),
  nike: require("../../assets/home/brands/nike.png"),
};

function BrandIcon({ brand }: { brand: Brand }) {
  const image = BRAND_IMAGES[brand.name.trim().toLowerCase()];
  if (!image) return <BrandMonogram name={brand.name} color={brand.color} size={40} />;
  return <Image source={image} style={{ width: 40, height: 40 }} contentFit="contain" />;
}

export default function Home() {
  const rates = useCardRates();
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { user, isGuest, balanceKobo, refresh } = useAuth();
  const [hideBalance, setHideBalance] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["brands", "popular"],
    queryFn: () => api.get<{ brands: Brand[] }>("/brands?popular=true", false),
  });

  const gate = (path: string) => () => {
    if (isGuest) router.push("/(auth)/login");
    else router.push(path as any);
  };

  const onRefresh = async () => {
    await Promise.all([refetch(), refresh()]);
  };

  return (
    <ScreenBackground>
      <AppHeader greeting={{ hi: "Hi", name: isGuest ? "Guest" : user!.full_name.split(" ")[0] }} showCurrency showBell />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        {isGuest ? (
          <LinearGradient colors={[colors.brandDeep, colors.brandPrimary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <Image source={require("../../assets/home/hero-card-art.png")} style={styles.heroArt} contentFit="cover" />
            <View style={styles.heroCopy}>
              <Text style={styles.heroHello}>Hello,</Text>
              <Text style={styles.heroTitle}>Welcome to <Text style={styles.heroAccent}>Bring Gift Card</Text></Text>
              <Text style={styles.heroSub}>Trade Gift Cards Instantly & Securely</Text>
              <Pressable style={styles.heroBtn} onPress={gate("/(tabs)/rates")} testID="home-check-rates">
                <Text style={styles.heroBtnText}>Check Rates</Text>
                <Ionicons name="arrow-forward" size={20} color={colors.onSurface} />
              </Pressable>
            </View>
          </LinearGradient>
        ) : (
          <View testID="home-balance-card">
            <LinearGradient colors={[colors.brandDeep, colors.brandPrimary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.balanceCard}>
              <Image source={require("../../assets/home/balance-wallet-art.png")} style={styles.balanceArt} contentFit="cover" />
              <View style={styles.balanceCopy}>
                <View style={styles.balanceTop}>
                  <Text style={styles.balanceLabel}>Available Balance</Text>
                  <Pressable onPress={() => setHideBalance((h) => !h)} hitSlop={10} testID="home-toggle-balance">
                    <Ionicons name={hideBalance ? "eye-off-outline" : "eye-outline"} size={20} color="rgba(255,255,255,0.9)" />
                  </Pressable>
                </View>
                <Text style={styles.balanceValue}>{hideBalance ? "• • • • • •" : formatNaira(balanceKobo)}</Text>
              </View>
              <Pressable
                style={styles.balanceWalletHit}
                onPress={() => router.push("/wallet")}
                accessibilityRole="button"
                accessibilityLabel="Open wallet"
                testID="home-balance-wallet-button"
              />
            </LinearGradient>
          </View>
        )}

        <View style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="flame" size={36} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Popular Gift Cards</Text>
                <Text style={styles.sectionSub}>Top gift cards traded on Bring Gift Card</Text>
              </View>
            </View>
            <Pressable onPress={gate("/(tabs)/rates")} style={styles.viewAll} testID="home-view-all">
              <Text style={styles.viewAllText}>View All</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.brandLink} />
            </Pressable>
          </View>

          {isLoading ? (
            <LoadingView />
          ) : (
            <View style={styles.brandList}>
              {(data?.brands ?? []).map((b, i, list) => (
                <Pressable
                  key={b.id}
                  onPress={gate(`/card/${b.id}`)}
                  style={[styles.brandRow, i < list.length - 1 && styles.brandDivider]}
                  testID={`home-brand-${b.id}`}
                >
                  <BrandIcon brand={b} />
                  <Text style={styles.brandName}>{b.name}</Text>
                  <View style={styles.brandRight}>
                    <Text style={styles.brandRate}>{rateLabel(b.id, rates.data)}</Text>
                    <Ionicons name="chevron-forward" size={17} color={colors.muted} />
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <Pressable onPress={gate("/(tabs)/trade")} testID="home-start-trading">
          <View style={styles.promo}>
            <Image source={require("../../assets/home/promo-card-art.png")} style={styles.promoArt} contentFit="cover" />
            <View style={styles.promoCopy}>
              <Text style={styles.promoTitle}>Turn Your Gift Cards</Text>
              <Text style={[styles.promoTitle, { color: colors.brandPrimary }]}>Into Real Value</Text>
              <Text style={styles.promoSub}>Fast  •  Secure  •  Trusted</Text>
              <View style={styles.promoBtn}>
                <Text style={styles.promoBtnText}>Start Trading</Text>
                <Ionicons name="arrow-forward" size={18} color={colors.onBrandPrimary} />
              </View>
            </View>
          </View>
        </Pressable>
      </ScrollView>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  hero: {
    minHeight: 174,
    borderRadius: radius.xl,
    overflow: "hidden",
    marginTop: spacing.xs,
    position: "relative",
  },
  heroArt: { position: "absolute", right: 0, top: 0, width: "48%", height: "100%" },
  heroCopy: { paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, width: "64%", zIndex: 2 },
  heroHello: { color: "rgba(255,255,255,0.92)", fontSize: 15 },
  heroTitle: { color: colors.onBrandPrimary, fontSize: 20, fontWeight: "800", marginTop: 2, lineHeight: 25 },
  heroAccent: { color: "#22D3EE" },
  heroSub: { color: "rgba(255,255,255,0.94)", marginTop: 6, fontSize: 12.5 },
  heroBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    height: 42,
    borderRadius: radius.pill,
    marginTop: spacing.lg,
  },
  heroBtnText: { color: colors.onSurface, fontWeight: "800", fontSize: 14 },
  balanceCard: {
    minHeight: 155,
    borderRadius: radius.xl,
    overflow: "hidden",
    marginTop: spacing.xs,
    position: "relative",
    justifyContent: "center",
  },
  balanceArt: { position: "absolute", right: 0, top: 0, width: "57%", height: "100%" },
  balanceCopy: { width: "62%", paddingHorizontal: spacing.xl, zIndex: 2 },
  balanceTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  balanceLabel: { color: "rgba(255,255,255,0.93)", fontSize: 14, fontWeight: "500" },
  balanceValue: { color: colors.onBrandPrimary, fontSize: 27, fontWeight: "800", marginTop: spacing.md, letterSpacing: 0.5 },
  balanceWalletHit: { position: "absolute", right: 0, top: 0, bottom: 0, width: 76, zIndex: 4 },
  sectionCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: "hidden",
    shadowColor: colors.shadow,
    shadowOpacity: 0.045,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
  sectionSub: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  viewAll: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: spacing.sm },
  viewAllText: { color: colors.brandLink, fontWeight: "700", fontSize: 13.5 },
  brandList: { paddingHorizontal: spacing.lg },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 57 },
  brandDivider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  brandName: { flex: 1, fontSize: 14.5, fontWeight: "600", color: colors.onSurface },
  brandRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandRate: { fontSize: 13.5, fontWeight: "600", color: colors.onSurface },
  promo: {
    minHeight: 126,
    borderRadius: radius.xl,
    overflow: "hidden",
    marginTop: spacing.lg,
    backgroundColor: "#EAF6FF",
    position: "relative",
  },
  promoArt: { position: "absolute", right: 0, top: 0, width: "58%", height: "100%" },
  promoCopy: { width: "58%", paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, zIndex: 2 },
  promoTitle: { fontSize: 18, fontWeight: "800", color: colors.onSurface, lineHeight: 22 },
  promoSub: { color: colors.muted, marginTop: 4, fontWeight: "500", fontSize: 11.5 },
  promoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.lg,
    height: 38,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  promoBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 13 },
}));

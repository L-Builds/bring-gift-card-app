import { Market, useCardRates } from "@/src/lib/market";
import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { AppHeader } from "@/src/components/app-header";
import { ScreenBackground, LoadingView } from "@/src/components/ui";
import { BrandIcon } from "@/src/components/brand-icon";
import { useAuth } from "@/src/context/auth";
import { api } from "@/src/api/client";
import { formatMoney, formatNaira } from "@/src/lib/format";
import { tradeAuthHref, tradeHref } from "@/src/lib/trade-intent";

type Brand = { id: string; name: string; color: string; rate_kobo_per_usd: number; category: string; has_logo?: boolean; logo_version?: string };
type PopularBonus = {
  enabled: boolean;
  market_code: string;
  currency: string;
  minor_digits: number;
  amount_minor: number;
  min_card_value_usd?: number | null;
};
type HeadlineRate = {
  id: string;
  brand_id: string;
  market_code: string;
  rate_minor_per_unit: number;
  version: number;
  is_active: boolean;
};

type PopularCard = {
  position: number;
  brand: Brand;
  headline_rate: HeadlineRate;
  bonus?: PopularBonus | null;
};

function currencyAmount(minor: number, currency: string, digits: number, trimZeroDecimals = false) {
  const value = (minor || 0) / 10 ** digits;
  const showDecimals = trimZeroDecimals && Number.isInteger(value) ? 0 : digits;
  return formatMoney(minor, currency, digits, { decimals: showDecimals });
}

export default function Home() {
  const rates = useCardRates();
  const styles = useStyles();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 400;
  const router = useRouter();
  const { user, isGuest, balanceKobo, refresh } = useAuth();
  const marketCode = user?.market_code || "NG";
  const [hideBalance, setHideBalance] = useState(false);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["popular-cards", marketCode],
    queryFn: () => api.get<{ popular_cards: PopularCard[]; market: Market | null }>(`/popular-cards?market_code=${encodeURIComponent(marketCode)}`, false),
  });
  const allBrands = useQuery({
    queryKey: ["brands", "rates", "all", marketCode],
    queryFn: () => api.get<{ brands: Brand[] }>(`/brands?market_code=${encodeURIComponent(marketCode)}&purpose=rates`, false),
    enabled: !isError && data?.popular_cards.length === 0,
  });

  const gate = (path: string) => () => {
    if (isGuest) router.push("/(auth)/login");
    else router.push(path as any);
  };

  const openPopularTrade = (brandId: string) => {
    const intent = { brand_id: brandId };
    router.push(isGuest ? tradeAuthHref("login", intent) : tradeHref(intent));
  };

  const onRefresh = async () => {
    await Promise.all([refetch(), data?.popular_cards.length === 0 ? allBrands.refetch() : Promise.resolve(), rates.refetch(), refresh()]);
  };

  const popularCards = data?.popular_cards ?? [];
  const popularMarket = data?.market ?? rates.data?.market ?? null;
  const catalogError = popularCards.length === 0 && (isError || allBrands.isError);
  const catalogLoading = isLoading || (popularCards.length === 0 && allBrands.isLoading);
  const currencyLabel = isGuest
    ? rates.isError && !rates.data ? "Market error" : rates.isLoading ? "Checking market" : rates.data?.market?.currency ?? "No market"
    : undefined;
  const balanceLabel = formatNaira(balanceKobo);
  const balanceWidth = (Math.min(width, 480) - 2 * spacing.lg) * (compact ? 0.76 : 0.62) - 2 * (compact ? spacing.md : spacing.xl);
  const balanceFontSize = Math.max(15, Math.min(27, Math.floor(balanceWidth / (balanceLabel.length * 0.62))));

  return (
    <ScreenBackground>
      <AppHeader greeting={{ hi: "Hi", name: isGuest ? "Guest" : user!.full_name.split(" ")[0] }} showCurrency currencyLabel={currencyLabel} showBell />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        {isGuest ? (
          <View style={styles.hero}>
            <Image source={require("../../assets/home/hero-card-art-wide.png")} style={styles.heroArt} contentFit="cover" />
            <View style={[styles.heroCopy, compact && styles.heroCopyCompact]}>
              <Text style={styles.heroHello}>Hello,</Text>
              <Text style={styles.heroTitle}>Welcome to{"\n"}<Text style={styles.heroAccent}>Bring Gift Card</Text></Text>
              <Text style={styles.heroSub}>Trade Gift Cards Instantly & Securely</Text>
              <Pressable style={[styles.heroBtn, compact && styles.heroBtnCompact]} onPress={() => router.push("/(tabs)/rates")} testID="home-check-rates">
                <Text style={styles.heroBtnText} numberOfLines={1}>Check Rates</Text>
                <Ionicons name="arrow-forward" size={20} color={colors.onSurface} />
              </Pressable>
            </View>
          </View>
        ) : (
          <View testID="home-balance-card">
            <LinearGradient colors={[colors.brandDeep, colors.brandPrimary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.balanceCard}>
              <Image source={require("../../assets/home/balance-wallet-art.png")} style={styles.balanceArt} contentFit="cover" />
              <View style={[styles.balanceCopy, compact && styles.balanceCopyCompact]}>
                <View style={styles.balanceTop}>
                  <Text style={styles.balanceLabel}>Available Balance</Text>
                  <Pressable onPress={() => setHideBalance((h) => !h)} hitSlop={10} testID="home-toggle-balance">
                    <Ionicons name={hideBalance ? "eye-off-outline" : "eye-outline"} size={20} color="rgba(255,255,255,0.9)" />
                  </Pressable>
                </View>
                <Text style={[styles.balanceValue, { fontSize: balanceFontSize }]} numberOfLines={1}>{hideBalance ? "• • • • • •" : balanceLabel}</Text>
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
            <Text style={styles.sectionTitle}>Popular Gift Cards</Text>
            <Pressable onPress={() => router.push("/(tabs)/rates")} style={styles.viewAll} testID="home-view-all">
              <Text style={styles.viewAllText}>View All</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.brandLink} />
            </Pressable>
          </View>

          {catalogLoading ? (
            <LoadingView />
          ) : (
            <View style={styles.brandList}>
              {catalogError ? (
                <View style={styles.emptyMessage} testID="home-catalog-error">
                  <Text style={styles.noBrands}>Gift cards could not be loaded right now.</Text>
                  <Pressable onPress={onRefresh} accessibilityRole="button" testID="home-catalog-retry">
                    <Text style={styles.retryText}>Try again</Text>
                  </Pressable>
                </View>
              ) : popularCards.length === 0 ? (
                <Text style={styles.noBrands} testID="home-catalog-empty">
                  {allBrands.data?.brands.length ? "No popular gift cards are featured right now. View all cards to browse what's available." : "No gift cards have been published yet."}
                </Text>
              ) : null}
              {isError && popularCards.length > 0 && <Text style={styles.staleNotice}>Could not refresh gift cards. Showing the last loaded list.</Text>}
              {popularCards.map((item, i, list) => {
                const b = item.brand;
                const market = popularMarket;
                const mainRate = market
                  ? `$1 = ${currencyAmount(item.headline_rate.rate_minor_per_unit, market.currency, market.minor_digits)}`
                  : "Rate unavailable";
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => openPopularTrade(b.id)}
                    style={[styles.brandRow, i < list.length - 1 && styles.brandDivider]}
                    testID={`home-brand-${b.id}`}
                  >
                    <BrandIcon brand={b} size={40} />
                    <View style={styles.brandNameBlock}>
                      <Text style={styles.brandName} numberOfLines={2}>{b.name}</Text>
                    </View>
                    <View style={styles.brandPriceBlock}>
                      <Text style={styles.brandRate} numberOfLines={1}>{mainRate}</Text>
                      {item.bonus?.enabled ? (
                        <View style={styles.bonusBlock} testID={`home-brand-bonus-${b.id}`}>
                          <Text style={styles.bonusAmount} numberOfLines={1}>
                            + {currencyAmount(item.bonus.amount_minor, item.bonus.currency, item.bonus.minor_digits, true)} bonus
                          </Text>
                          {item.bonus.min_card_value_usd ? (
                            <Text style={styles.bonusCondition} numberOfLines={1}>${item.bonus.min_card_value_usd} card upward</Text>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <Pressable onPress={gate("/(tabs)/trade")} testID="home-start-trading">
          <View style={styles.promo}>
            <Image source={require("../../assets/home/promo-card-art-reference.png")} style={styles.promoArt} contentFit="fill" />
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
    minHeight: 188,
    borderRadius: radius.xl,
    overflow: "hidden",
    marginTop: spacing.xs,
    position: "relative",
    backgroundColor: colors.brandDeep,
  },
  heroArt: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, width: "100%", height: "100%" },
  heroCopy: { paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, width: "52%", zIndex: 2 },
  heroCopyCompact: { paddingHorizontal: spacing.md, width: "67%" },
  heroHello: { color: "rgba(255,255,255,0.92)", fontSize: 15 },
  heroTitle: { color: colors.onBrandPrimary, fontSize: 20, fontWeight: "800", marginTop: 2, lineHeight: 24 },
  heroAccent: { color: "#22D3EE" },
  heroSub: { color: "rgba(255,255,255,0.94)", marginTop: 7, fontSize: 12.5, lineHeight: 18 },
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
  heroBtnCompact: { paddingHorizontal: spacing.md, gap: spacing.xs },
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
  balanceCopyCompact: { width: "76%", paddingHorizontal: spacing.md },
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
  sectionTitle: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
  viewAll: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: spacing.sm },
  viewAllText: { color: colors.brandLink, fontWeight: "700", fontSize: 13.5 },
  brandList: { paddingHorizontal: spacing.lg },
  noBrands: { paddingVertical: spacing.xl, textAlign: "center", color: colors.muted },
  emptyMessage: { alignItems: "center", paddingBottom: spacing.lg },
  retryText: { color: colors.brandLink, fontWeight: "700", padding: spacing.sm },
  staleNotice: { color: colors.muted, fontSize: 12, paddingVertical: spacing.sm },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 68, paddingVertical: spacing.sm },
  brandDivider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  brandNameBlock: { flex: 1, minWidth: 0 },
  brandName: { fontSize: 14.5, fontWeight: "700", color: colors.onSurface },
  brandPriceBlock: { alignItems: "flex-end", justifyContent: "center", maxWidth: "58%", minWidth: 118 },
  brandRate: { fontSize: 13.5, fontWeight: "700", color: colors.onSurface, textAlign: "right" },
  bonusBlock: { marginTop: 3, alignItems: "flex-end" },
  bonusAmount: { color: colors.brandPrimary, fontSize: 11.5, fontWeight: "700", textAlign: "right" },
  bonusCondition: { color: colors.muted, fontSize: 10.5, fontWeight: "600", marginTop: 1, textAlign: "right" },
  promo: {
    minHeight: 142,
    borderRadius: radius.xl,
    overflow: "hidden",
    marginTop: spacing.lg,
    backgroundColor: "#F2F8FF",
    borderWidth: 1,
    borderColor: "#E4EEF9",
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

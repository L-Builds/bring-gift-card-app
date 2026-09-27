import { useCardRates, rateLabel } from "@/src/lib/market";
import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, BrandMonogram, PrimaryButton, LoadingView } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { formatMoney } from "@/src/lib/format";
import { tradeAuthHref, tradeHref } from "@/src/lib/trade-intent";

type Brand = {
  id: string;
  name: string;
  color: string;
  category: string;
  rate_kobo_per_usd: number;
  submission_types?: string[];
  countries: string[];
  subcategories: string[];
};

const BRAND_IMAGES: Record<string, any> = {
  "apple/itunes": require("../../assets/home/brands/apple-itunes.png"),
  "razer gold": require("../../assets/home/brands/razer-gold.png"),
  steam: require("../../assets/home/brands/steam.png"),
  playstation: require("../../assets/home/brands/playstation.png"),
  xbox: require("../../assets/home/brands/xbox.png"),
  amazon: require("../../assets/home/brands/amazon.png"),
  "google play": require("../../assets/home/brands/google-play.png"),
  nike: require("../../assets/home/brands/nike.png"),
  paysafecard: require("../../assets/rates/brands/paysafecard.png"),
  sephora: require("../../assets/rates/brands/sephora.png"),
  one4all: require("../../assets/rates/brands/one4all.png"),
  ebay: require("../../assets/rates/brands/ebay.png"),
  footlocker: require("../../assets/rates/brands/footlocker.png"),
};

function BrandIcon({ brand }: { brand: Brand }) {
  const image = BRAND_IMAGES[brand.name.trim().toLowerCase()];
  if (!image) return <BrandMonogram name={brand.name} color={brand.color} size={76} />;
  return <Image source={image} style={{ width: 76, height: 76, borderRadius: 38 }} contentFit="contain" />;
}

export default function CardDetail() {
  const rates = useCardRates();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isGuest } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  const cardRates = useMemo(
    () => (rates.data?.rates ?? []).filter((rate) => rate.brand_id === id).sort((a, b) => a.face_value - b.face_value),
    [rates.data?.rates, id],
  );
  const selectedRate = cardRates.find((rate) => rate.id === selectedRateId) ?? cardRates[0];
  const tradeIntent = {
    brand_id: id,
    card_value_usd: selectedRate ? String(selectedRate.face_value) : undefined,
    quantity: selectedRate ? String(quantity) : undefined,
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["brand", id],
    queryFn: () => api.get<Brand>(`/brands/${id}`),
  });

  if (isLoading || !data) {
    return (
      <ScreenBackground>
        <StackHeader title="Card Details" />
        {isLoading ? <LoadingView /> : (
          <View style={styles.loadError}>
            <Text style={styles.rateNote}>Card details could not be loaded.</Text>
            <PrimaryButton title="Try again" onPress={() => { void refetch(); }} testID="card-retry" />
          </View>
        )}
      </ScreenBackground>
    );
  }

  const Chip = ({ text }: { text: string }) => (
    <View style={styles.chip}><Text style={styles.chipText}>{text}</Text></View>
  );

  return (
    <ScreenBackground>
      <StackHeader title="Card Details" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + 100, gap: spacing.lg }}>
        <View style={styles.hero}>
          <BrandIcon brand={data} />
          <Text style={styles.name}>{data.name}</Text>
          <View style={styles.catPill}><Text style={styles.catText}>{data.category}</Text></View>
        </View>

        <View style={styles.rateCard}>
          <Text style={styles.rateLabel}>Check your payout</Text>
          {selectedRate && rates.data?.market ? (
            <>
              <Text style={styles.rateNote}>Choose a published card value</Text>
              <View style={styles.denomRow}>
                {cardRates.map((rate) => (
                  <Pressable key={rate.id} onPress={() => setSelectedRateId(rate.id)}
                    style={[styles.denomButton, selectedRate.id === rate.id && styles.denomActive]}
                    testID={`card-value-${rate.face_value}`}>
                    <Text style={[styles.denomText, selectedRate.id === rate.id && { color: colors.onBrandPrimary }]}>${rate.face_value}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.quantityRow}>
                <Text style={styles.quantityLabel}>Quantity</Text>
                <Pressable onPress={() => setQuantity((current) => Math.max(1, current - 1))} style={styles.quantityButton} testID="card-qty-minus"><Text style={styles.quantitySymbol}>−</Text></Pressable>
                <Text style={styles.quantityValue}>{quantity}</Text>
                <Pressable onPress={() => setQuantity((current) => Math.min(100, current + 1))} style={styles.quantityButton} testID="card-qty-plus"><Text style={styles.quantitySymbol}>+</Text></Pressable>
              </View>
              <Text style={styles.rateValue}>{formatMoney(selectedRate.payout_minor * quantity, rates.data.market.currency, rates.data.market.minor_digits)}</Text>
              <Text style={styles.rateNote}>Indicative payout for {quantity} × ${selectedRate.face_value}. The current quote is confirmed before you submit a trade.</Text>
            </>
          ) : (
            <Text style={styles.rateValue}>{rates.isError && !rates.data ? "Rates unavailable" : rates.isLoading ? "Checking rates…" : rateLabel(data.id, rates.data)}</Text>
          )}
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Accepted submission types</Text>
          <View style={styles.wrap}>
            {(data.submission_types?.length ? data.submission_types : ["physical", "ecode"]).map((t) => <Chip key={t} text={t === "ecode" ? "E-code" : "Physical"} />)}
          </View>
        </View>

        {!!data.countries.length && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Countries / regions</Text>
            <View style={styles.wrap}>{data.countries.map((c) => <Chip key={c} text={c} />)}</View>
          </View>
        )}

        {!!data.subcategories.length && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Card types / sub-categories</Text>
            <View style={styles.wrap}>{data.subcategories.map((s) => <Chip key={s} text={s} />)}</View>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <PrimaryButton
          title={`Trade ${data.name}`}
          icon="swap-horizontal"
          onPress={() => router.push(isGuest ? tradeAuthHref("login", tradeIntent) : tradeHref(tradeIntent))}
          testID="card-trade"
        />
      </View>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  loadError: { alignItems: "center", justifyContent: "center", flex: 1, paddingHorizontal: spacing.xl, gap: spacing.md },
  hero: { alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  name: { fontSize: 22, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm },
  catPill: { backgroundColor: colors.brandSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  catText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 12 },
  rateCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center" },
  rateLabel: { color: colors.muted, fontSize: 13 },
  rateValue: { fontSize: 26, fontWeight: "800", color: colors.onSurface, marginTop: 4 },
  rateNote: { color: colors.muted, fontSize: 12, marginTop: spacing.sm, textAlign: "center", lineHeight: 18 },
  denomRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm, marginTop: spacing.md },
  denomButton: { borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  denomActive: { backgroundColor: colors.brandPrimary },
  denomText: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },
  quantityRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.lg },
  quantityLabel: { color: colors.onSurfaceSecondary, fontWeight: "600", marginRight: spacing.sm },
  quantityButton: { width: 32, height: 32, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  quantitySymbol: { color: colors.brandPrimary, fontSize: 20, fontWeight: "700" },
  quantityValue: { minWidth: 20, textAlign: "center", color: colors.onSurface, fontWeight: "700" },
  block: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md },
  blockTitle: { fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  chipText: { color: colors.onSurfaceSecondary, fontWeight: "600", fontSize: 13 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.screenBg },
}));

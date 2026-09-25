import { useCardRates, rateLabel } from "@/src/lib/market";
import React from "react";
import { View, Text, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, BrandMonogram, PrimaryButton, LoadingView } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { formatNaira } from "@/src/lib/format";

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
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["brand", id],
    queryFn: () => api.get<Brand>(`/brands/${id}`),
  });

  if (isLoading || !data) {
    return (
      <ScreenBackground>
        <StackHeader title="Card Details" />
        <LoadingView />
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
          <Text style={styles.rateLabel}>Current rate</Text>
          <Text style={styles.rateValue}>{rateLabel(data.id, rates.data)}</Text>
          <Text style={styles.rateNote}>This rate comes from the current Bring Gift Card catalog and may change before a trade is submitted.</Text>
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
          onPress={() => router.push({ pathname: "/(tabs)/trade", params: { brand_id: data.id } })}
          testID="card-trade"
        />
      </View>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  hero: { alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  name: { fontSize: 22, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm },
  catPill: { backgroundColor: colors.brandSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  catText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 12 },
  rateCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center" },
  rateLabel: { color: colors.muted, fontSize: 13 },
  rateValue: { fontSize: 26, fontWeight: "800", color: colors.onSurface, marginTop: 4 },
  rateNote: { color: colors.muted, fontSize: 12, marginTop: spacing.sm, textAlign: "center", lineHeight: 18 },
  block: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md },
  blockTitle: { fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  chipText: { color: colors.onSurfaceSecondary, fontWeight: "600", fontSize: 13 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.screenBg },
}));

import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { api } from "@/src/api/client";
import { BrandIcon } from "@/src/components/brand-icon";
import { EmptyState, LoadingView, QueryErrorView } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { formatMoney } from "@/src/lib/format";
import { DetailedRate, useDetailedRates, useHeadlineRates } from "@/src/lib/market";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Brand = {
  id: string;
  name: string;
  category: string;
  color: string;
  has_logo?: boolean;
  logo_version?: string;
  countries?: string[];
};

type DetailedType = DetailedRate["submission_type"];

const COUNTRY_NAMES: Record<string, string> = {
  US: "US",
  USA: "US",
  UK: "UK",
  GB: "UK",
  CA: "Canada",
  CANADA: "Canada",
  AU: "Australia",
  AUSTRALIA: "Australia",
  JP: "Japan",
  JAPAN: "Japan",
  DE: "Germany",
  GERMANY: "Germany",
};

function countryLabel(value: string) {
  const normalized = value.trim().toUpperCase();
  return COUNTRY_NAMES[normalized] || value.trim();
}

export default function Rates() {
  const { user } = useAuth();
  const payoutMarket = user?.market_code || "NG";
  const headlines = useHeadlineRates();
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 520;
  const [query, setQuery] = useState("");
  const [selectedBrandId, setSelectedBrandId] = useState("all");
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedType, setSelectedType] = useState<DetailedType>("physical");
  const detailed = useDetailedRates(selectedBrandId);

  const brands = useQuery({
    queryKey: ["rate-brands", payoutMarket],
    queryFn: () => api.get<{ brands: Brand[] }>(`/brands?purpose=rates&market_code=${encodeURIComponent(payoutMarket)}`, false),
    refetchInterval: 15000,
  });

  const allBrands = brands.data?.brands ?? [];
  const filteredBrands = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return allBrands;
    return allBrands.filter((brand) => [brand.name, brand.category].some((value) => value?.toLowerCase().includes(term)));
  }, [allBrands, query]);

  const selectedBrand = allBrands.find((brand) => brand.id === selectedBrandId) ?? null;
  const detailedRows = useMemo(
    () => (detailed.data?.detailed_rates ?? []).filter((rate) => rate.is_active && rate.card_country.trim().toUpperCase() !== "GENERAL"),
    [detailed.data?.detailed_rates],
  );
  const countries = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const rate of detailedRows) {
      const country = rate.card_country.trim().toUpperCase();
      if (country && !seen.has(country)) {
        seen.add(country);
        result.push(country);
      }
    }
    return result;
  }, [detailedRows]);

  useEffect(() => {
    if (!selectedBrand || !countries.length) {
      setSelectedCountry("");
      return;
    }
    if (!countries.includes(selectedCountry)) setSelectedCountry(countries[0]);
  }, [countries, selectedBrand, selectedCountry]);

  const selectedCountryRows = useMemo(
    () => detailedRows.filter((rate) => rate.card_country.trim().toUpperCase() === selectedCountry),
    [detailedRows, selectedCountry],
  );
  const physicalRate = selectedCountryRows.find((rate) => rate.submission_type === "physical") ?? null;
  const codeRate = selectedCountryRows.find((rate) => rate.submission_type === "ecode") ?? null;

  useEffect(() => {
    if (selectedType === "physical" && !physicalRate && codeRate) setSelectedType("ecode");
    if (selectedType === "ecode" && !codeRate && physicalRate) setSelectedType("physical");
  }, [codeRate, physicalRate, selectedType]);

  const selectedRate = selectedType === "physical" ? physicalRate : codeRate;
  const market = selectedBrand ? detailed.data?.market ?? headlines.data?.market ?? null : headlines.data?.market ?? null;
  const loading = brands.isLoading || headlines.isLoading || (selectedBrand ? detailed.isLoading : false);
  const failed = brands.isError || headlines.isError || (selectedBrand ? detailed.isError : false);
  const refetching = brands.isRefetching || headlines.isRefetching || (selectedBrand ? detailed.isRefetching : false);
  const retry = () => { void brands.refetch(); void headlines.refetch(); if (selectedBrand) void detailed.refetch(); };

  const headlineRate = (brandId: string) =>
    (headlines.data?.headline_rates ?? []).find((rate) => rate.brand_id === brandId && rate.is_active) ?? null;

  const selectedData = selectedBrand ? [selectedBrand] : filteredBrands;

  return <View style={{ flex: 1, backgroundColor: colors.screenBg }}>
    <View style={[styles.blueHeader, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={22} color={colors.onSurfaceSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search gift cards"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          testID="rates-search"
        />
      </View>
    </View>

    <FlatList<Brand>
      data={selectedData}
      keyExtractor={(item) => item.id}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.page, selectedData.length === 0 && styles.emptyPage]}
      ListHeaderComponent={<>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>Gift Card Rates</Text>
          <Text style={styles.subtitle}>Check current rates before you trade.</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.brandTabs} testID="rates-brand-tabs">
          <Pressable onPress={() => setSelectedBrandId("all")} style={[styles.brandTab, selectedBrandId === "all" && styles.brandTabActive]} testID="rates-tab-all-cards">
            <Text style={[styles.brandTabText, selectedBrandId === "all" && styles.brandTabTextActive]}>All Cards</Text>
          </Pressable>
          {allBrands.map((brand) => <Pressable key={brand.id} onPress={() => setSelectedBrandId(brand.id)} style={[styles.brandTab, selectedBrandId === brand.id && styles.brandTabActive]} testID={`rates-tab-${brand.id}`}>
            <Text style={[styles.brandTabText, selectedBrandId === brand.id && styles.brandTabTextActive]} numberOfLines={1}>{brand.name}</Text>
          </Pressable>)}
        </ScrollView>

        {selectedBrand && <View style={styles.detailHead}>
          <View style={styles.brandIdentity}>
            <BrandIcon brand={selectedBrand} size={54} borderRadius={13} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.brandName}>{selectedBrand.name}</Text>
            </View>
          </View>
        </View>}
      </>}
      ListEmptyComponent={loading ? <LoadingView /> : failed ? <QueryErrorView title="Could not load rates" onRetry={retry} retrying={refetching} /> : <EmptyState
        icon="search"
        title={query.trim() ? "No cards found" : "No rates published yet"}
        subtitle={query.trim() ? "Try another gift card name." : "Active gift cards will appear here once management publishes rates."}
      />}
      renderItem={({ item: brand, index }) => {
        if (!selectedBrand) {
          const headline = headlineRate(brand.id);
          return <Pressable onPress={() => setSelectedBrandId(brand.id)} style={[styles.cardRow, index > 0 && styles.rowDivider]} testID={`rates-all-card-${brand.id}`}>
            <BrandIcon brand={brand} size={46} borderRadius={12} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardName}>{brand.name}</Text>
            </View>
            <Text style={styles.headlineRateText}>
              {headline && market ? `$1 = ${formatMoney(headline.rate_minor_per_unit, market.currency, market.minor_digits)}` : "Rate unavailable"}
            </Text>
          </Pressable>;
        }

        if (detailed.isLoading) return <LoadingView />;
        if (detailed.isError) return <QueryErrorView title="Could not load this card's rates" onRetry={() => void detailed.refetch()} retrying={detailed.isRefetching} />;
        if (!countries.length) return <EmptyState icon="pricetag-outline" title="No rates published" subtitle="There are no active detailed rates for this card and payout market yet." />;

        return <View style={styles.detailWorkspace} testID="individual-card-rate-workspace">
          <View style={[styles.countryRail, compact && styles.countryRailCompact]}>
            <Text style={styles.countryRailTitle}>Countries</Text>
            {countries.map((country) => <Pressable
              key={country}
              onPress={() => setSelectedCountry(country)}
              style={[styles.countryItem, selectedCountry === country && styles.countryItemActive]}
              testID={`rates-country-${country.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            >
              <Text style={[styles.countryItemText, selectedCountry === country && styles.countryItemTextActive]} numberOfLines={1}>{countryLabel(country)}</Text>
            </Pressable>)}
          </View>

          <View style={styles.ratePanel}>
            <View style={styles.typeToggle} testID="rates-type-toggle">
              <Pressable
                onPress={() => physicalRate && setSelectedType("physical")}
                disabled={!physicalRate}
                style={[styles.typeButton, selectedType === "physical" && styles.typeButtonActive, !physicalRate && styles.typeButtonDisabled]}
                testID="rates-type-physical"
              >
                <Text style={[styles.typeButtonText, selectedType === "physical" && styles.typeButtonTextActive, !physicalRate && styles.typeButtonTextDisabled]}>PHYSICAL</Text>
              </Pressable>
              <Pressable
                onPress={() => codeRate && setSelectedType("ecode")}
                disabled={!codeRate}
                style={[styles.typeButton, selectedType === "ecode" && styles.typeButtonActive, !codeRate && styles.typeButtonDisabled]}
                testID="rates-type-code"
              >
                <Text style={[styles.typeButtonText, selectedType === "ecode" && styles.typeButtonTextActive, !codeRate && styles.typeButtonTextDisabled]}>CODE</Text>
              </Pressable>
            </View>

            <View style={styles.rateDisplay}>
              <Text style={styles.rateLabel}>Rate per unit</Text>
              <Text style={styles.rateValue} testID="rates-per-unit-value">
                {selectedRate && market ? formatMoney(selectedRate.rate_minor_per_unit, market.currency, market.minor_digits) : "Rate unavailable"}
              </Text>
            </View>
          </View>
        </View>;
      }}
      ListFooterComponent={<View style={{ height: Math.max(insets.bottom, spacing.lg) }} />}
    />
  </View>;
}

const useStyles = makeStyles((colors) => ({
  blueHeader: {
    backgroundColor: colors.brandDeep,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  searchBox: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.onSurface },
  page: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  emptyPage: { flexGrow: 1 },
  titleWrap: { paddingTop: spacing.xxl, paddingBottom: spacing.md },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface },
  subtitle: { marginTop: 4, fontSize: 14, color: colors.onSurfaceSecondary, lineHeight: 20 },
  brandTabs: { gap: spacing.xs, paddingVertical: spacing.sm, paddingRight: spacing.lg },
  brandTab: { height: 40, maxWidth: 160, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  brandTabActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  brandTabText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700" },
  brandTabTextActive: { color: colors.onBrandPrimary },
  detailHead: { marginTop: spacing.md, backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, overflow: "hidden" },
  brandIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  brandName: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  cardRow: { minHeight: 78, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  cardName: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  headlineRateText: { color: colors.onSurface, fontSize: 14, fontWeight: "800", textAlign: "right" },
  detailWorkspace: { flexDirection: "row", minHeight: 260, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, overflow: "hidden" },
  countryRail: { width: 150, paddingVertical: spacing.md, backgroundColor: colors.surfaceSecondary, borderRightWidth: 1, borderRightColor: colors.divider },
  countryRailCompact: { width: 112 },
  countryRailTitle: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  countryItem: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderLeftWidth: 3, borderLeftColor: "transparent" },
  countryItemActive: { backgroundColor: colors.surface, borderLeftColor: colors.brandPrimary },
  countryItemText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700" },
  countryItemTextActive: { color: colors.onSurface, fontWeight: "800" },
  ratePanel: { flex: 1, minWidth: 0, padding: spacing.lg },
  typeToggle: { flexDirection: "row", alignSelf: "flex-start", padding: 3, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary },
  typeButton: { minHeight: 38, minWidth: 86, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  typeButtonActive: { backgroundColor: colors.brandPrimary },
  typeButtonDisabled: { opacity: 0.45 },
  typeButtonText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
  typeButtonTextActive: { color: colors.onBrandPrimary },
  typeButtonTextDisabled: { color: colors.muted },
  rateDisplay: { flex: 1, justifyContent: "center", paddingVertical: spacing.xl },
  rateLabel: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700" },
  rateValue: { marginTop: spacing.sm, color: colors.onSurface, fontSize: 30, fontWeight: "800" },
}));

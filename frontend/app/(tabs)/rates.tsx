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
import { CardRate, useCardRates } from "@/src/lib/market";
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

const countryKey = (rate: CardRate) => rate.card_country?.trim().toUpperCase() || "GENERAL";

function submissionTypeLabel(type: CardRate["submission_type"]) {
  if (type === "physical") return "Physical";
  if (type === "ecode") return "Code";
  return "Any";
}

function perDollarMinor(rate: CardRate) {
  if (rate.rate_minor_per_usd != null) return rate.rate_minor_per_usd;
  if (rate.face_value > 0 && rate.payout_minor % rate.face_value === 0) return rate.payout_minor / rate.face_value;
  return null;
}

function rangeText(rate: CardRate) {
  if (rate.range_min == null || rate.range_max == null) return "Fixed";
  return `Range $${rate.range_min}–$${rate.range_max}`;
}

export default function Rates() {
  const { user } = useAuth();
  const payoutMarket = user?.market_code || "NG";
  const rates = useCardRates();
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 520;
  const [query, setQuery] = useState("");
  const [selectedBrandId, setSelectedBrandId] = useState("all");
  const [selectedCountry, setSelectedCountry] = useState("");

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
  const selectedRates = useMemo(() => {
    if (!selectedBrand) return [];
    return (rates.data?.rates ?? [])
      .filter((rate) => rate.brand_id === selectedBrand.id && rate.is_active)
      .sort((a, b) => b.face_value - a.face_value || (a.range_min ?? -1) - (b.range_min ?? -1) || a.submission_type.localeCompare(b.submission_type));
  }, [rates.data?.rates, selectedBrand]);

  const countries = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const rate of selectedRates) {
      const key = countryKey(rate);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(key);
      }
    }
    return result;
  }, [selectedRates]);

  useEffect(() => {
    if (!selectedBrand) {
      setSelectedCountry("");
      return;
    }
    if (!countries.length) {
      setSelectedCountry("");
      return;
    }
    if (!countries.includes(selectedCountry)) setSelectedCountry(countries[0]);
  }, [countries, selectedBrand, selectedCountry]);

  const visibleRules = useMemo(() => {
    if (!selectedBrand) return [];
    if (!selectedCountry) return selectedRates;
    return selectedRates.filter((rate) => countryKey(rate) === selectedCountry);
  }, [selectedBrand, selectedCountry, selectedRates]);

  const market = rates.data?.market ?? null;
  const loading = brands.isLoading || rates.isLoading;
  const failed = brands.isError || rates.isError;
  const refetching = brands.isRefetching || rates.isRefetching;
  const retry = () => { void brands.refetch(); void rates.refetch(); };

  const brandSummary = (brandId: string) => {
    const rows = (rates.data?.rates ?? []).filter((rate) => rate.brand_id === brandId && rate.is_active);
    const places = new Set(rows.map(countryKey));
    return `${places.size} ${places.size === 1 ? "country" : "countries"} · ${rows.length} ${rows.length === 1 ? "rate" : "rates"}`;
  };

  const headlineRate = (brandId: string) =>
    (rates.data?.rates ?? []).find((rate) => rate.brand_id === brandId && rate.is_active && rate.is_headline) ?? null;

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

    <FlatList
      data={selectedBrand ? visibleRules : filteredBrands}
      keyExtractor={(item) => selectedBrand ? (item as CardRate).id : (item as Brand).id}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.page, (selectedBrand ? visibleRules.length : filteredBrands.length) === 0 && styles.emptyPage]}
      ListHeaderComponent={<>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>Gift Card Rates</Text>
          <Text style={styles.subtitle}>{market ? `Payouts shown in ${market.currency} for ${market.name}.` : "Check current rates before you trade."}</Text>
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
              <Text style={styles.brandMeta}>{brandSummary(selectedBrand.id)}</Text>
            </View>
          </View>
          {countries.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.countryTabs} testID="rates-country-tabs">
            {countries.map((country) => <Pressable key={country} onPress={() => setSelectedCountry(country)} style={[styles.countryTab, selectedCountry === country && styles.countryTabActive]} testID={`rates-country-${country.toLowerCase()}`}>
              <Text style={[styles.countryTabText, selectedCountry === country && styles.countryTabTextActive]}>{country === "GENERAL" ? "General" : country}</Text>
            </Pressable>)}
          </ScrollView>}
          {visibleRules.length > 0 && <View style={styles.rateTableHeader}>
            <Text style={[styles.rateHeading, { flex: compact ? 1.25 : 1.5 }]}>Card Value</Text>
            <Text style={[styles.rateHeading, { flex: 1 }]}>Type</Text>
            <Text style={[styles.rateHeading, { flex: 1.3, textAlign: "right" }]}>Rate</Text>
          </View>}
        </View>}
      </>}
      ListEmptyComponent={loading ? <LoadingView /> : failed ? <QueryErrorView title="Could not load rates" onRetry={retry} retrying={refetching} /> : <EmptyState
        icon={selectedBrand ? "pricetag-outline" : "search"}
        title={selectedBrand ? "No rates published" : query.trim() ? "No cards found" : "No rates published yet"}
        subtitle={selectedBrand ? "There are no active rate rules for this card and payout market yet." : query.trim() ? "Try another gift card name." : "Active gift cards will appear here once management publishes rates."}
      />}
      renderItem={({ item, index }) => {
        if (!selectedBrand) {
          const brand = item as Brand;
          return <Pressable onPress={() => setSelectedBrandId(brand.id)} style={[styles.cardRow, index > 0 && styles.rowDivider]} testID={`rates-all-card-${brand.id}`}>
            <BrandIcon brand={brand} size={46} borderRadius={12} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardName}>{brand.name}</Text>
              <Text style={styles.cardMeta}>{brandSummary(brand.id)}</Text>
            </View>
            <View style={styles.viewRates}>
              {(() => {
                const headline = headlineRate(brand.id);
                const perUsd = headline ? perDollarMinor(headline) : null;
                return perUsd != null && market ? <>
                  <Text style={styles.headlineRateText}>{formatMoney(perUsd, market.currency, market.minor_digits)}/$1</Text>
                  <Text style={styles.headlineRateMeta}>Display rate</Text>
                </> : <>
                  <Text style={styles.viewRatesText}>View rates</Text>
                  <Ionicons name="chevron-forward" size={17} color={colors.brandPrimary} />
                </>;
              })()}
            </View>
          </Pressable>;
        }

        const rate = item as CardRate;
        const perUsd = perDollarMinor(rate);
        const digits = market?.minor_digits ?? 2;
        const currency = market?.currency || "NGN";
        return <View style={[styles.rateRow, index > 0 && styles.rowDivider]} testID={`rates-rule-${rate.id}`}>
          <View style={{ flex: compact ? 1.25 : 1.5, minWidth: 0 }}>
            <Text style={styles.valueMain}>${rate.face_value}</Text>
            <Text style={styles.valueSub}>{rangeText(rate)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.typeText}>{submissionTypeLabel(rate.submission_type)}</Text>
          </View>
          <View style={{ flex: 1.3, alignItems: "flex-end" }}>
            <Text style={styles.rateText}>{perUsd != null ? `${formatMoney(perUsd, currency, digits)}/$1` : formatMoney(rate.payout_minor, currency, digits)}</Text>
            {perUsd == null && <Text style={styles.rateSub}>per card</Text>}
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
  detailHead: { marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  brandIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  brandName: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  brandMeta: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 3 },
  countryTabs: { gap: spacing.xs, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  countryTab: { minHeight: 36, minWidth: 54, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  countryTabActive: { backgroundColor: colors.brandPrimary },
  countryTabText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "800" },
  countryTabTextActive: { color: colors.onBrandPrimary },
  rateTableHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: 10, backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.divider },
  rateHeading: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  cardRow: { minHeight: 78, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  cardName: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  cardMeta: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 3 },
  viewRates: { minWidth: 100, alignItems: "flex-end", justifyContent: "center", gap: 2 },
  viewRatesText: { color: colors.brandPrimary, fontSize: 12, fontWeight: "800" },
  headlineRateText: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  headlineRateMeta: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "700" },
  rateRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.surface },
  valueMain: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  valueSub: { color: colors.onSurfaceSecondary, fontSize: 11, marginTop: 3 },
  typeText: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  rateText: { color: colors.onSurface, fontSize: 13, fontWeight: "800", textAlign: "right" },
  rateSub: { color: colors.onSurfaceSecondary, fontSize: 10, marginTop: 2 },
}));

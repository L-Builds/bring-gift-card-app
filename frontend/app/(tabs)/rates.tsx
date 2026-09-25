import { useCardRates, rateLabel } from "@/src/lib/market";
import React, { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, ScrollView, Modal } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { BrandMonogram, LoadingView, EmptyState } from "@/src/components/ui";
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
  paysafecard: require("../../assets/rates/brands/paysafecard.png"),
  sephora: require("../../assets/rates/brands/sephora.png"),
  one4all: require("../../assets/rates/brands/one4all.png"),
  ebay: require("../../assets/rates/brands/ebay.png"),
  footlocker: require("../../assets/rates/brands/footlocker.png"),
};

function BrandIcon({ brand }: { brand: Brand }) {
  const image = BRAND_IMAGES[brand.name.trim().toLowerCase()];
  if (!image) return <BrandMonogram name={brand.name} color={brand.color} size={48} />;
  return <Image source={image} style={{ width: 48, height: 48, borderRadius: 24 }} contentFit="contain" />;
}

export default function Rates() {
  const rates = useCardRates();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isGuest } = useAuth();
  const [chip, setChip] = useState("All Cards");
  const [q, setQ] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  const { data: categoryData } = useQuery({
    queryKey: ["brand-categories"],
    queryFn: () => api.get<{ categories: string[] }>("/categories"),
    enabled: !isGuest,
  });

  const chips = useMemo(() => {
    const backendCategories = (categoryData?.categories ?? [])
      .filter((c) => c && c.toLowerCase() !== "all")
      .filter((c, i, arr) => arr.findIndex((x) => x.toLowerCase() === c.toLowerCase()) === i);
    return ["All Cards", "Popular", ...backendCategories];
  }, [categoryData]);

  const category = chip === "All Cards" || chip === "Popular" ? "" : chip;
  const popular = chip === "Popular";
  const params = new URLSearchParams();
  if (popular) params.set("popular", "true");
  if (category) params.set("category", category);
  if (q.trim()) params.set("q", q.trim());

  const { data, isLoading } = useQuery({
    queryKey: ["rates", chip, q],
    queryFn: () => api.get<{ brands: Brand[] }>(`/brands?${params.toString()}`),
    enabled: !isGuest,
  });

  if (isGuest) return <Redirect href="/(auth)/login" />;

  const chooseFilter = (value: string) => {
    setChip(value);
    setFilterOpen(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.screenBg }}>
      <View style={[styles.blueHeader, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={24} color={colors.onSurfaceSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search gift cards (e.g. Amazon, Steam)"
              placeholderTextColor={colors.muted}
              value={q}
              onChangeText={setQ}
              testID="rates-search"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filter gift cards"
            onPress={() => setFilterOpen(true)}
            style={styles.filterBtn}
            testID="rates-filter"
          >
            <Ionicons name="options-outline" size={30} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.titleWrap}>
        <Text style={styles.title}>Gift Card Rates</Text>
        <Text style={styles.subtitle}>Check live rates before you trade</Text>
      </View>

      <View style={styles.chipRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowContent}>
          {chips.map((c) => {
            const active = c === chip;
            return (
              <Pressable
                key={c}
                onPress={() => setChip(c)}
                style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}
                testID={`rates-chip-${c.toLowerCase().replace(/\s/g, "-")}`}
              >
                <Text style={[styles.chipText, { color: active ? colors.onBrandPrimary : colors.onSurfaceSecondary }]}>{c}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <LoadingView />
      ) : (
        <FlatList
          data={data?.brands ?? []}
          keyExtractor={(b) => b.id}
          showsVerticalScrollIndicator={false}
          style={styles.listCard}
          contentContainerStyle={(data?.brands?.length ?? 0) === 0 ? styles.emptyList : undefined}
          ListEmptyComponent={<EmptyState icon="search" title="No cards found" subtitle="Try a different search or category." />}
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() => router.push(`/card/${item.id}`)}
              style={[styles.row, index < ((data?.brands.length ?? 0) - 1) && styles.rowDivider]}
              testID={`rates-brand-${item.id}`}
            >
              <BrandIcon brand={item} />
              <Text style={styles.rowName}>{item.name}</Text>
              <View style={styles.rowRight}>
                <Text style={styles.rowRate}>{rateLabel(item.id, rates.data)}</Text>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </View>
            </Pressable>
          )}
        />
      )}

      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setFilterOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Filter gift cards</Text>
            <Text style={styles.sheetSub}>Choose a category</Text>
            {chips.map((c) => {
              const active = chip === c;
              return (
                <Pressable key={c} style={styles.optionRow} onPress={() => chooseFilter(c)} testID={`rates-filter-${c.toLowerCase().replace(/\s/g, "-")}`}>
                  <Text style={[styles.optionText, active && { color: colors.brandPrimary }]}>{c}</Text>
                  <Ionicons name={active ? "checkmark-circle" : "chevron-forward"} size={20} color={active ? colors.brandPrimary : colors.muted} />
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  blueHeader: {
    backgroundColor: colors.brandDeep,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    minHeight: 58,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.onSurface },
  filterBtn: { width: 48, height: 58, alignItems: "center", justifyContent: "center" },
  titleWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.sm },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface },
  subtitle: { fontSize: 15, color: colors.onSurfaceSecondary, marginTop: 4 },
  chipRowWrap: { height: 64, justifyContent: "center" },
  chipRowContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center" },
  chip: { height: 42, borderRadius: radius.pill, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipIdle: { backgroundColor: colors.surface },
  chipText: { fontSize: 14, fontWeight: "600" },
  listCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: "hidden",
  },
  emptyList: { minHeight: 280, justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 82, paddingHorizontal: spacing.lg, backgroundColor: colors.surface },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowName: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.onSurface },
  rowRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowRate: { fontSize: 14, fontWeight: "600", color: colors.onSurface },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.xl, paddingBottom: spacing.xxxl },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.lg },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  sheetSub: { color: colors.muted, marginTop: 3, marginBottom: spacing.md },
  optionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.divider },
  optionText: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
}));

import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as ImagePicker from "expo-image-picker";
import { api, uploadBrandLogo } from "@/src/api/client";
import { BrandIcon } from "@/src/components/brand-icon";
import { useToast } from "@/src/components/toast";
import { AdminPage, Panel, Field, Action, Toggle, Note } from "@/src/components/admin-form";
import { Market } from "@/src/lib/market";
import { formatMoney, toMinor } from "@/src/lib/format";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Brand = {
  id: string; name: string; category: string; color: string;
  is_active: boolean; is_popular: boolean; is_tradable?: boolean;
  has_logo?: boolean; logo_version?: string; archived_at?: string;
  submission_types: ("physical" | "ecode")[]; subcategories: string[]; countries: string[];
};

type HeadlineRate = {
  id: string;
  brand_id: string;
  market_code: string;
  rate_minor_per_unit: number;
  version: number;
  is_active: boolean;
  archived_at?: string | null;
};

type PopularCard = {
  brand_id: string;
  position: number;
  bonus_enabled: boolean;
  bonus_market_code?: string | null;
  bonus_amount_minor?: number | null;
  min_card_value_usd?: number | null;
  brand: Brand | null;
  bonus_market?: Market | null;
  headline_rates: HeadlineRate[];
};

type PopularDraft = {
  brandId: string;
  bonusEnabled: boolean;
  bonusMarketCode: string;
  bonusAmount: string;
  minCardValue: string;
};

const blankPopularDraft: PopularDraft = {
  brandId: "", bonusEnabled: false, bonusMarketCode: "", bonusAmount: "", minCardValue: "",
};

function currencySymbol(currency: string) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0).find((part) => part.type === "currency")?.value || currency;
  } catch { return currency; }
}

function minorToInput(minor: number | null | undefined, digits: number) {
  if (minor == null) return "";
  return (minor / 10 ** digits).toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function minorToGroupedInput(minor: number | null | undefined, digits: number) {
  if (minor == null) return "";
  return new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(minor / 10 ** digits);
}

const blank: Brand = { id: "", name: "", category: "Other", color: "#1F5AF6", is_active: false,
  is_popular: false, submission_types: ["physical", "ecode"], subcategories: [], countries: [] };

function normalizeBrand(brand: Brand): Brand {
  return {
    ...blank,
    ...brand,
    countries: brand.countries ?? [],
    subcategories: brand.subcategories ?? [],
    submission_types: brand.submission_types?.length ? brand.submission_types : ["physical", "ecode"],
  };
}

function readiness(brand: Brand) {
  if (brand.archived_at) return "Archived";
  if (!brand.is_active) return "Paused";
  return brand.is_tradable ? "Tradable" : "Needs market + rate";
}

function BoolPill({ value, yes = "Yes", no = "No" }: { value: boolean; yes?: string; no?: string }) {
  const styles = useStyles();
  return <View style={[styles.pill, value ? styles.pillPositive : styles.pillNeutral]}>
    <Text style={[styles.pillText, value ? styles.pillTextPositive : styles.pillTextNeutral]}>{value ? yes : no}</Text>
  </View>;
}

type DetailedRate = {
  id: string;
  brand_id: string;
  market_code: string;
  card_country: string;
  submission_type: "physical" | "ecode";
  rate_minor_per_unit: number;
  version: number;
  is_active: boolean;
  archived_at?: string | null;
};

type DetailedCountry = {
  code: string;
  physical?: DetailedRate;
  ecode?: DetailedRate;
  isActive: boolean;
};

function countryDisplayName(code: string) {
  if (!code) return "Country / region";
  try {
    const region = code.toUpperCase() === "UK" ? "GB" : code.toUpperCase();
    return new Intl.DisplayNames(["en"], { type: "region" }).of(region) || code.toUpperCase();
  } catch { return code.toUpperCase(); }
}

function SelectorSheet({ visible, title, children, onClose }: { visible: boolean; title: string; children: React.ReactNode; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <Pressable style={styles.modalBackdrop} onPress={onClose}>
      <Pressable style={styles.selectorSheet} onPress={(event) => event.stopPropagation()}>
        <View style={styles.selectorHeader}>
          <Text style={styles.editorTitle}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.iconButton}>
            <Ionicons name="close" size={21} color={colors.onSurface} />
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: spacing.xs }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </Pressable>
    </Pressable>
  </Modal>;
}

export function CatalogWorkspace({ initialTab = "catalog" }: { initialTab?: "catalog" | "rates" }) {
  const { width } = useWindowDimensions();
  const desktop = width >= 1024;
  const tab = initialTab;
  const { brand_id } = useLocalSearchParams<{ brand_id?: string }>();
  const [form, setForm] = useState<Brand>({ ...blank });
  const [country, setCountry] = useState("NG");
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  const [marketPickerOpen, setMarketPickerOpen] = useState(false);
  const [headlineAmount, setHeadlineAmount] = useState("");
  const [selectedDetailedCountry, setSelectedDetailedCountry] = useState("");
  const [pendingDetailedCountry, setPendingDetailedCountry] = useState("");
  const [physicalRateAmount, setPhysicalRateAmount] = useState("");
  const [codeRateAmount, setCodeRateAmount] = useState("");
  const [addCountryOpen, setAddCountryOpen] = useState(false);
  const [newCountryCode, setNewCountryCode] = useState("");
  const [detailedCountryDeleteConfirm, setDetailedCountryDeleteConfirm] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogView, setCatalogView] = useState<"all" | "popular">("all");
  const [popularAddOpen, setPopularAddOpen] = useState(false);
  const [popularCurrencyOpen, setPopularCurrencyOpen] = useState(false);
  const [popularDraft, setPopularDraft] = useState<PopularDraft>({ ...blankPopularDraft });
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast(), qc = useQueryClient(), router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const brands = useQuery({ queryKey: ["admin-brands"], queryFn: () => api.get<{ brands: Brand[] }>("/admin/brands") });
  const popularCards = useQuery({
    queryKey: ["admin-popular-cards"],
    queryFn: () => api.get<{ popular_cards: PopularCard[]; max_items: number }>("/admin/popular-cards"),
    enabled: tab === "catalog",
  });
  useEffect(() => {
    const selected = brands.data?.brands.find((brand) => brand.id === brand_id);
    if (!selected) return;
    const normalized = normalizeBrand(selected);
    const id = setTimeout(() => setForm((current) => current.id === normalized.id ? current : normalized), 0);
    return () => clearTimeout(id);
  }, [brand_id, brands.data?.brands]);
  useEffect(() => {
    if (tab !== "rates" || form.id || !brands.data?.brands.length) return;
    const preferred = brands.data.brands.find((brand) => brand.id === brand_id) ?? brands.data.brands[0];
    const id = setTimeout(() => setForm(normalizeBrand(preferred)), 0);
    return () => clearTimeout(id);
  }, [tab, form.id, brand_id, brands.data?.brands]);
  const markets = useQuery({ queryKey: ["admin-markets"], queryFn: () => api.get<{ markets: Market[] }>("/admin/markets") });
  const detailedRates = useQuery({ queryKey: ["admin-detailed-rates", form.id],
    queryFn: () => api.get<{ detailed_rates: DetailedRate[] }>(`/admin/detailed-rates?brand_id=${encodeURIComponent(form.id)}`), enabled: !!form.id });
  const headlineRates = useQuery({ queryKey: ["admin-headline-rates", form.id],
    queryFn: () => api.get<{ headline_rates: HeadlineRate[] }>(`/admin/headline-rates?brand_id=${encodeURIComponent(form.id)}`), enabled: !!form.id });
  const market = markets.data?.markets.find((item) => item.code === country);
  const selectedHeadline = headlineRates.data?.headline_rates.find((rate) => rate.market_code === country && rate.is_active);
  useEffect(() => {
    setHeadlineAmount(minorToGroupedInput(selectedHeadline?.rate_minor_per_unit, market?.minor_digits ?? 2));
  }, [form.id, country, selectedHeadline?.id, selectedHeadline?.rate_minor_per_unit, market?.minor_digits]);
  useEffect(() => {
    if (!form.id) { setSelectedDetailedCountry(""); setPendingDetailedCountry(""); return; }
    if (pendingDetailedCountry && selectedDetailedCountry === pendingDetailedCountry) return;
    if (selectedDetailedCountry && detailedCountries.some((item) => item.code === selectedDetailedCountry)) return;
    setSelectedDetailedCountry(detailedCountries[0]?.code ?? "");
  }, [form.id, country, detailedCountries, selectedDetailedCountry, pendingDetailedCountry]);
  useEffect(() => {
    const digits = market?.minor_digits ?? 2;
    setPhysicalRateAmount(minorToGroupedInput(selectedDetailed?.physical?.rate_minor_per_unit, digits));
    setCodeRateAmount(minorToGroupedInput(selectedDetailed?.ecode?.rate_minor_per_unit, digits));
    setDetailedCountryDeleteConfirm(false);
  }, [selectedDetailedCountry, selectedDetailed?.physical?.id, selectedDetailed?.physical?.rate_minor_per_unit, selectedDetailed?.ecode?.id, selectedDetailed?.ecode?.rate_minor_per_unit, market?.minor_digits]);

  const visibleBrands = useMemo(() => {
    const term = catalogSearch.trim().toLowerCase();
    return (brands.data?.brands ?? []).filter((brand) => !term || [brand.name, brand.category, ...(brand.countries ?? [])]
      .some((value) => value.toLowerCase().includes(term)));
  }, [brands.data?.brands, catalogSearch]);
  const detailedCountries = useMemo<DetailedCountry[]>(() => {
    const grouped = new Map<string, DetailedCountry>();
    for (const rate of detailedRates.data?.detailed_rates ?? []) {
      if (rate.market_code !== country || rate.archived_at) continue;
      const code = rate.card_country.trim().toUpperCase();
      if (!code) continue;
      const entry = grouped.get(code) ?? { code, isActive: false };
      if (rate.submission_type === "physical") entry.physical = rate;
      if (rate.submission_type === "ecode") entry.ecode = rate;
      entry.isActive = !!(entry.physical?.is_active || entry.ecode?.is_active);
      grouped.set(code, entry);
    }
    return [...grouped.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [detailedRates.data?.detailed_rates, country]);
  const selectedDetailed = detailedCountries.find((item) => item.code === selectedDetailedCountry);
  const popularRows = popularCards.data?.popular_cards ?? [];
  const activeMarkets = (markets.data?.markets ?? []).filter((item) => item.is_active);
  const selectedPopular = popularRows.find((item) => item.brand_id === popularDraft.brandId);
  const popularBonusMarket = activeMarkets.find((item) => item.code === popularDraft.bonusMarketCode);
  const popularBrandIds = new Set(popularRows.map((item) => item.brand_id));
  const addablePopularBrands = (brands.data?.brands ?? []).filter((brand) => brand.is_active && !brand.archived_at && !popularBrandIds.has(brand.id));

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    try { await work(); await qc.invalidateQueries(); toast.show(success, "success"); }
    catch (error) { toast.show((error as Error).message || "Could not save this change", "error"); }
    finally { setBusy(false); }
  };
  const selectBrand = (brand: Brand) => { setForm(normalizeBrand(brand)); setDeleteConfirm(false); setSelectedDetailedCountry(""); setPendingDetailedCountry(""); setDetailedCountryDeleteConfirm(false); };
  const saveBrand = () => run(async () => {
    const payload = { ...form, name: form.name.trim(), category: form.category.trim() || "Other",
      countries: form.countries.map((value) => value.trim()).filter(Boolean),
      subcategories: form.subcategories.map((value) => value.trim()).filter(Boolean),
      submission_types: [...new Set(form.submission_types)] };
    const saved = form.id ? await api.patch<Brand>(`/admin/brands/${encodeURIComponent(form.id)}`, payload)
      : await api.post<Brand>("/admin/brands", payload);
    setForm(normalizeBrand(saved));
  }, form.id ? "Card changes saved" : "Gift card created");
  const uploadLogo = async () => {
    if (!form.id) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (picked.canceled || !picked.assets[0]) return;
    await run(async () => {
      await uploadBrandLogo(picked.assets[0].uri, form.id);
      const latest = await api.get<{ brands: Brand[] }>("/admin/brands");
      const updated = latest.brands.find((brand) => brand.id === form.id);
      if (updated) setForm(normalizeBrand(updated));
    }, "Card logo updated");
  };
  const removeLogo = () => run(async () => {
    setForm(normalizeBrand(await api.del<Brand>(`/admin/brands/${encodeURIComponent(form.id)}/logo`)));
  }, "Card logo removed");
  const deleteOrArchiveCard = () => run(async () => {
    const result = await api.del<{ ok: boolean; deleted: boolean; archived: boolean; brand?: Brand }>(
      `/admin/brands/${encodeURIComponent(form.id)}`
    );
    setDeleteConfirm(false);
    if (result.deleted) setForm({ ...blank });
    else if (result.brand) setForm(normalizeBrand(result.brand));
  }, "Card removed from active catalog management");
  const beginAddDetailedCountry = () => {
    setNewCountryCode("");
    setAddCountryOpen(true);
  };
  const chooseNewDetailedCountry = () => {
    const code = newCountryCode.trim().toUpperCase();
    if (!code) { toast.show("Enter a country / region code", "error"); return; }
    if (detailedCountries.some((item) => item.code === code)) {
      setPendingDetailedCountry("");
      setSelectedDetailedCountry(code);
      setAddCountryOpen(false);
      return;
    }
    setPendingDetailedCountry(code);
    setSelectedDetailedCountry(code);
    setPhysicalRateAmount("");
    setCodeRateAmount("");
    setDetailedCountryDeleteConfirm(false);
    setAddCountryOpen(false);
  };
  const saveDetailedCountryRates = () => run(async () => {
    if (!form.id || !market || !market.is_active) throw new Error("Choose a gift card and an active payout market");
    const code = selectedDetailedCountry.trim().toUpperCase();
    if (!code) throw new Error("Choose or add a country first");
    const digits = market.minor_digits ?? 2;
    const physicalMinor = form.submission_types.includes("physical") && physicalRateAmount.replace(/,/g, "").trim()
      ? toMinor(physicalRateAmount.replace(/,/g, "").trim(), digits) : null;
    const codeMinor = form.submission_types.includes("ecode") && codeRateAmount.replace(/,/g, "").trim()
      ? toMinor(codeRateAmount.replace(/,/g, "").trim(), digits) : null;
    if (!physicalMinor && !codeMinor) throw new Error("Enter at least one positive Physical or Code rate");
    await api.post("/admin/detailed-rates/country", {
      brand_id: form.id,
      market_code: country,
      card_country: code,
      physical_rate_minor_per_unit: physicalMinor,
      code_rate_minor_per_unit: codeMinor,
    });
    await detailedRates.refetch();
    setPendingDetailedCountry("");
    setSelectedDetailedCountry(code);
  }, "Detailed card rates saved");
  const setDetailedCountryEnabled = (enabled: boolean) => run(async () => {
    if (!form.id || !selectedDetailedCountry) throw new Error("Select a configured country first");
    await api.post(`/admin/detailed-rates/${encodeURIComponent(form.id)}/${encodeURIComponent(country)}/${encodeURIComponent(selectedDetailedCountry)}/${enabled ? "enable" : "disable"}`);
    await detailedRates.refetch();
  }, enabled ? "Country enabled" : "Country disabled");
  const removeDetailedCountry = () => run(async () => {
    if (!form.id || !selectedDetailedCountry) throw new Error("Select a configured country first");
    await api.del(`/admin/detailed-rates/${encodeURIComponent(form.id)}/${encodeURIComponent(country)}/${encodeURIComponent(selectedDetailedCountry)}`);
    await detailedRates.refetch();
    setDetailedCountryDeleteConfirm(false);
    setPendingDetailedCountry("");
    setSelectedDetailedCountry("");
  }, "Country removed from detailed rates");

  const saveHeadlineRate = () => run(async () => {
    if (!form.id || !market || !market.is_active) throw new Error("Choose a gift card and an active payout market");
    const amountMinor = toMinor(headlineAmount.replace(/,/g, "").trim(), market.minor_digits ?? 2);
    if (!amountMinor) throw new Error("Enter a positive payout for $1");
    await api.post<HeadlineRate>("/admin/headline-rates", {
      brand_id: form.id,
      market_code: country,
      rate_minor_per_unit: amountMinor,
    });
  }, "All Cards display rate saved");

  const selectPopular = (item: PopularCard) => {
    const digits = item.bonus_market?.minor_digits ?? 2;
    setPopularDraft({
      brandId: item.brand_id,
      bonusEnabled: !!item.bonus_enabled,
      bonusMarketCode: item.bonus_market_code || "",
      bonusAmount: minorToInput(item.bonus_amount_minor, digits),
      minCardValue: item.min_card_value_usd == null ? "" : String(item.min_card_value_usd),
    });
  };
  const addPopularCard = (brandId: string) => run(async () => {
    const saved = await api.post<PopularCard>("/admin/popular-cards", { brand_id: brandId });
    setPopularAddOpen(false);
    selectPopular(saved);
  }, "Card added to Popular Gift Cards");
  const removePopularCard = (brandId: string) => run(async () => {
    await api.del(`/admin/popular-cards/${encodeURIComponent(brandId)}`);
    if (popularDraft.brandId === brandId) setPopularDraft({ ...blankPopularDraft });
  }, "Card removed from Popular Gift Cards");
  const movePopularCard = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= popularRows.length) return;
    const ids = popularRows.map((item) => item.brand_id);
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    void run(async () => {
      await api.post("/admin/popular-cards/reorder", { brand_ids: ids });
    }, "Popular order updated");
  };
  const savePopularBonus = () => run(async () => {
    if (!popularDraft.brandId) throw new Error("Choose a Popular card first");
    const selectedMarket = activeMarkets.find((item) => item.code === popularDraft.bonusMarketCode);
    const bonusAmountMinor = popularDraft.bonusAmount.trim()
      ? toMinor(popularDraft.bonusAmount.trim(), selectedMarket?.minor_digits ?? 2)
      : null;
    const minCardValue = popularDraft.minCardValue.trim() ? Number(popularDraft.minCardValue) : null;
    if (popularDraft.bonusEnabled && !selectedMarket) throw new Error("Choose a bonus currency from an active market");
    if (popularDraft.bonusEnabled && !bonusAmountMinor) throw new Error("Enter a positive bonus amount");
    if (minCardValue != null && (!Number.isSafeInteger(minCardValue) || minCardValue <= 0)) throw new Error("Enter a valid minimum card value");
    const saved = await api.patch<PopularCard>(`/admin/popular-cards/${encodeURIComponent(popularDraft.brandId)}`, {
      bonus_enabled: popularDraft.bonusEnabled,
      bonus_market_code: selectedMarket?.code || null,
      bonus_amount_minor: bonusAmountMinor,
      min_card_value_usd: minCardValue,
    });
    selectPopular(saved);
  }, "Popular card settings saved");

  return <AdminPage title={tab === "catalog" ? "Catalog" : "Rates"}>
    <View style={styles.tabs}>
      <Pressable testID="management-tab-catalog" onPress={() => router.push("/admin/catalog")} style={[styles.tab, tab === "catalog" && styles.tabActive]}>
        <Text style={[styles.tabText, tab === "catalog" && styles.tabTextActive]}>Catalog</Text>
      </Pressable>
      <Pressable testID="management-tab-rates" onPress={() => router.push("/admin/rates")} style={[styles.tab, tab === "rates" && styles.tabActive]}>
        <Text style={[styles.tabText, tab === "rates" && styles.tabTextActive]}>Rates</Text>
      </Pressable>
      <Pressable onPress={() => router.push("/admin/rate-history")} style={styles.tab}>
        <Text style={styles.tabText}>Rate history</Text>
      </Pressable>
    </View>

    {brands.isLoading && <Note>Loading catalog…</Note>}
    {brands.error && <Panel><Note>Catalog unavailable: {brands.error.message}</Note>
      <Action title="Retry catalog" onPress={() => { void brands.refetch(); }} /></Panel>}

    {tab === "catalog" ? <>
      <View style={styles.catalogSubTabs} testID="catalog-section-tabs">
        <Pressable testID="catalog-section-all" onPress={() => setCatalogView("all")} style={[styles.catalogSubTab, catalogView === "all" && styles.catalogSubTabActive]}>
          <Text style={[styles.catalogSubTabText, catalogView === "all" && styles.catalogSubTabTextActive]}>All Gift Cards</Text>
        </Pressable>
        <Pressable testID="catalog-section-popular" onPress={() => setCatalogView("popular")} style={[styles.catalogSubTab, catalogView === "popular" && styles.catalogSubTabActive]}>
          <Text style={[styles.catalogSubTabText, catalogView === "popular" && styles.catalogSubTabTextActive]}>Popular Gift Cards</Text>
        </Pressable>
      </View>

      {catalogView === "all" ? <View style={[styles.workspace, !desktop && styles.workspaceMobile]} testID="admin-catalog-workspace">
        <View style={styles.mainColumn}>
          <View style={styles.sectionHeadingRow}>
            <View>
              <Text style={styles.sectionTitle}>Gift card catalog</Text>
              <Text style={styles.sectionSubtitle}>Manage the cards customers can see and trade.</Text>
            </View>
            <Pressable testID="catalog-add-gift-card" onPress={() => selectBrand({ ...blank })} style={styles.primaryCompact}>
              <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.primaryCompactText}>Add Gift Card</Text>
            </Pressable>
          </View>
          <Field label="Find a card" value={catalogSearch} onChangeText={setCatalogSearch} placeholder="Search name, category or country" />
          {!brands.isError && visibleBrands.length === 0 && <Panel><Note>{catalogSearch ? "No matching gift cards." : "No gift cards yet. Create one to begin."}</Note></Panel>}

          {desktop && visibleBrands.length > 0 ? <View style={styles.table} testID="catalog-desktop-table">
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeading, { flex: 0.55 }]}>Logo</Text>
              <Text style={[styles.tableHeading, { flex: 1.55 }]}>Card</Text>
              <Text style={[styles.tableHeading, { flex: 1.1 }]}>Category</Text>
              <Text style={[styles.tableHeading, { flex: 0.85 }]}>Active</Text>
              <Text style={[styles.tableHeading, { flex: 0.85 }]}>Popular</Text>
              <Text style={[styles.tableHeading, { width: 74 }]}>Action</Text>
            </View>
            {visibleBrands.map((brand) => <Pressable key={brand.id} onPress={() => selectBrand(brand)} style={[styles.tableRow, form.id === brand.id && styles.tableRowSelected]} accessibilityRole="button" accessibilityLabel={`Edit ${brand.name}`}>
              <View style={{ flex: 0.55 }}><BrandIcon brand={brand} size={38} borderRadius={10} /></View>
              <View style={{ flex: 1.55 }}>
                <Text style={styles.tablePrimary} numberOfLines={1}>{brand.name}</Text>
                <Text style={[styles.tableSecondary, { color: brand.is_tradable ? colors.success : colors.muted }]}>{readiness(brand)}</Text>
              </View>
              <Text style={[styles.tablePrimary, { flex: 1.1 }]} numberOfLines={1}>{brand.category || "Other"}</Text>
              <View style={{ flex: 0.85, alignItems: "flex-start" }}><BoolPill value={brand.is_active} /></View>
              <View style={{ flex: 0.85, alignItems: "flex-start" }}><BoolPill value={brand.is_popular} /></View>
              <Text style={[styles.editLink, { width: 74 }]}>Edit</Text>
            </Pressable>)}
          </View> : !desktop && <View style={{ gap: spacing.sm }}>
            {visibleBrands.map((brand) => <Pressable key={brand.id} onPress={() => selectBrand(brand)} style={[styles.mobileCard, form.id === brand.id && styles.tableRowSelected]}>
              <BrandIcon brand={brand} size={44} borderRadius={11} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tablePrimary}>{brand.name}</Text>
                <Text style={styles.tableSecondary}>{brand.category} · {readiness(brand)}</Text>
                <View style={styles.mobilePills}><BoolPill value={brand.is_active} yes="Active" no="Inactive" /><BoolPill value={brand.is_popular} yes="Popular" no="Not popular" /></View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>)}
          </View>}
        </View>

        <View style={styles.editorColumn} testID="catalog-card-editor">
          <Panel>
            <View style={styles.editorTitleRow}>
              <BrandIcon brand={form.id ? form : { ...form, id: "new-card" }} size={58} borderRadius={14} />
              <View style={{ flex: 1 }}>
                <Text style={styles.editorTitle}>{form.id ? "Edit Gift Card" : "Create Gift Card"}</Text>
                <Text style={styles.tableSecondary}>{form.id ? form.name || "Gift card" : "Add a new catalog record"}</Text>
              </View>
            </View>
            <Field label="Name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
            <Field label="Category" value={form.category} onChangeText={(category) => setForm({ ...form, category })} />
            <Field label="Brand color" value={form.color} onChangeText={(color) => setForm({ ...form, color })} />

            <View style={styles.logoBlock}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Current Logo</Text>
                <Text style={styles.tableSecondary}>{form.id ? (form.has_logo ? "Custom logo uploaded" : "Using bundled/fallback artwork") : "Save the card before uploading a logo"}</Text>
              </View>
              {!!form.id && <View style={styles.logoActions}>
                <Pressable style={styles.secondaryCompact} onPress={() => { void uploadLogo(); }} disabled={busy} testID="catalog-logo-replace">
                  <Text style={styles.secondaryCompactText}>{form.has_logo ? "Replace" : "Upload"}</Text>
                </Pressable>
                {form.has_logo && <Pressable style={styles.secondaryCompact} onPress={() => { void removeLogo(); }} disabled={busy} testID="catalog-logo-remove">
                  <Text style={styles.dangerLink}>Remove</Text>
                </Pressable>}
              </View>}
            </View>

            <Field label="Countries (comma separated)" value={form.countries.join(",")}
              onChangeText={(value) => setForm({ ...form, countries: value.split(",") })} />
            <Field label="Card types / subcategories (comma separated)" value={form.subcategories.join(",")}
              onChangeText={(value) => setForm({ ...form, subcategories: value.split(",") })} />
            <Toggle label="Physical cards" value={form.submission_types.includes("physical")}
              onChange={(on) => setForm({ ...form, submission_types: on ? [...new Set([...form.submission_types, "physical" as const])] : form.submission_types.filter((type) => type !== "physical") })} />
            <Toggle label="E-codes" value={form.submission_types.includes("ecode")}
              onChange={(on) => setForm({ ...form, submission_types: on ? [...new Set([...form.submission_types, "ecode" as const])] : form.submission_types.filter((type) => type !== "ecode") })} />
            <Toggle label="Active" value={form.is_active} onChange={(is_active) => setForm({ ...form, is_active })} />
            <Note>Active cards are only tradable when an active market has a positive rate. Popular placement and bonuses are managed separately under Popular Gift Cards.</Note>
            {form.archived_at && <Note>This card is archived because it has trade history. Turn Active on and save if management intentionally wants to restore it later.</Note>}
            <Action title={form.id ? "Save Changes" : "Save Card"} disabled={busy || !form.name.trim() || !form.submission_types.length} onPress={saveBrand} />
            {!!form.id && <Action title="Manage Rates" onPress={() => router.push({ pathname: "/admin/rates", params: { brand_id: form.id } })} />}
            {!!form.id && !deleteConfirm && <Pressable testID="catalog-delete-archive" onPress={() => setDeleteConfirm(true)} disabled={busy} style={styles.dangerAction}>
              <Text style={styles.dangerActionText}>Delete / Archive Card</Text>
            </Pressable>}
            {!!form.id && deleteConfirm && <View testID="catalog-delete-confirm" style={styles.deleteConfirm}>
              <Text style={styles.fieldLabel}>Remove this card?</Text>
              <Text style={styles.tableSecondary}>If it has never been used in a trade, it will be permanently deleted with its configured rates. If trade history exists, it will be archived instead so historical records remain intact.</Text>
              <View style={styles.deleteConfirmActions}>
                <Pressable onPress={() => setDeleteConfirm(false)} style={styles.secondaryCompact} disabled={busy}><Text style={styles.secondaryCompactText}>Cancel</Text></Pressable>
                <Pressable testID="catalog-delete-confirm-action" onPress={() => { void deleteOrArchiveCard(); }} style={styles.dangerCompact} disabled={busy}><Text style={styles.dangerCompactText}>Confirm</Text></Pressable>
              </View>
            </View>}
          </Panel>
        </View>
      </View> : <View style={[styles.workspace, !desktop && styles.workspaceMobile]} testID="admin-popular-workspace">
        <View style={styles.mainColumn}>
          <View style={styles.sectionHeadingRow}>
            <View>
              <Text style={styles.sectionTitle}>Popular Gift Cards</Text>
              <Text style={styles.sectionSubtitle}>Curate up to 8 Home cards. Position and bonus are independent from the card's headline rate.</Text>
            </View>
            <Pressable testID="popular-add-card" onPress={() => setPopularAddOpen(true)} style={styles.primaryCompact} disabled={busy || popularRows.length >= 8}>
              <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.primaryCompactText}>Add Card</Text>
            </Pressable>
          </View>
          <Text style={styles.popularCount}>{popularRows.length} / 8 cards</Text>
          {popularCards.isLoading && <Panel><Note>Loading Popular Gift Cards…</Note></Panel>}
          {popularCards.error && <Panel><Note>Popular Gift Cards unavailable: {popularCards.error.message}</Note><Action title="Retry" onPress={() => { void popularCards.refetch(); }} /></Panel>}
          {!popularCards.isLoading && !popularCards.isError && popularRows.length === 0 && <Panel><Note>No Popular Gift Cards yet. Add an active catalog card that already has an active headline/display rate.</Note></Panel>}

          {desktop && popularRows.length > 0 ? <View style={styles.table} testID="popular-desktop-table">
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeading, { width: 56 }]}>Pos.</Text>
              <Text style={[styles.tableHeading, { flex: 1.7 }]}>Card</Text>
              <Text style={[styles.tableHeading, { flex: 1.35 }]}>Main rate</Text>
              <Text style={[styles.tableHeading, { flex: 1.35 }]}>Bonus</Text>
              <Text style={[styles.tableHeading, { width: 150 }]}>Order / Edit</Text>
            </View>
            {popularRows.map((item, index) => <View key={item.brand_id} style={[styles.tableRow, popularDraft.brandId === item.brand_id && styles.tableRowSelected]}>
              <Text style={[styles.tablePrimary, { width: 56 }]}>#{item.position}</Text>
              <Pressable style={{ flex: 1.7, flexDirection: "row", alignItems: "center", gap: spacing.sm }} onPress={() => selectPopular(item)}>
                {item.brand && <BrandIcon brand={item.brand} size={38} borderRadius={10} />}
                <View style={{ flex: 1 }}><Text style={styles.tablePrimary}>{item.brand?.name || "Missing catalog card"}</Text><Text style={styles.tableSecondary}>{item.brand?.category || ""}</Text></View>
              </Pressable>
              <View style={{ flex: 1.35 }}><Text style={styles.tablePrimary}>{item.headline_rates.length ? "Linked" : "Missing"}</Text><Text style={styles.tableSecondary}>{item.headline_rates.length ? `${item.headline_rates.length} active headline rate${item.headline_rates.length === 1 ? "" : "s"}` : "Set a display rate first"}</Text></View>
              <View style={{ flex: 1.35 }}><Text style={styles.tablePrimary}>{item.bonus_enabled && item.bonus_market && item.bonus_amount_minor ? formatMoney(item.bonus_amount_minor, item.bonus_market.currency, item.bonus_market.minor_digits) : "Off"}</Text><Text style={styles.tableSecondary}>{item.bonus_enabled && item.min_card_value_usd ? `$${item.min_card_value_usd} card upward` : ""}</Text></View>
              <View style={styles.popularRowActions}>
                <Pressable accessibilityLabel="Move up" disabled={index === 0 || busy} onPress={() => movePopularCard(index, -1)} style={[styles.iconButton, index === 0 && styles.disabledAction]}><Ionicons name="arrow-up" size={17} color={colors.onSurface} /></Pressable>
                <Pressable accessibilityLabel="Move down" disabled={index === popularRows.length - 1 || busy} onPress={() => movePopularCard(index, 1)} style={[styles.iconButton, index === popularRows.length - 1 && styles.disabledAction]}><Ionicons name="arrow-down" size={17} color={colors.onSurface} /></Pressable>
                <Pressable onPress={() => selectPopular(item)} style={styles.secondaryCompact}><Text style={styles.secondaryCompactText}>Edit</Text></Pressable>
              </View>
            </View>)}
          </View> : !desktop && <View style={{ gap: spacing.sm }}>
            {popularRows.map((item, index) => <View key={item.brand_id} style={[styles.mobileCard, popularDraft.brandId === item.brand_id && styles.tableRowSelected]}>
              <Text style={styles.popularPosition}>#{item.position}</Text>
              {item.brand && <BrandIcon brand={item.brand} size={44} borderRadius={11} />}
              <Pressable style={{ flex: 1 }} onPress={() => selectPopular(item)}>
                <Text style={styles.tablePrimary}>{item.brand?.name || "Missing catalog card"}</Text>
                <Text style={styles.tableSecondary}>{item.headline_rates.length ? "Headline rate linked" : "Headline rate missing"} · Bonus {item.bonus_enabled ? "On" : "Off"}</Text>
              </Pressable>
              <View style={styles.popularMobileOrder}>
                <Pressable disabled={index === 0 || busy} onPress={() => movePopularCard(index, -1)}><Ionicons name="arrow-up" size={18} color={index === 0 ? colors.muted : colors.onSurface} /></Pressable>
                <Pressable disabled={index === popularRows.length - 1 || busy} onPress={() => movePopularCard(index, 1)}><Ionicons name="arrow-down" size={18} color={index === popularRows.length - 1 ? colors.muted : colors.onSurface} /></Pressable>
              </View>
            </View>)}
          </View>}
        </View>

        <View style={styles.editorColumn} testID="popular-card-editor">
          {selectedPopular?.brand ? <Panel>
            <View style={styles.editorTitleRow}>
              <BrandIcon brand={selectedPopular.brand} size={58} borderRadius={14} />
              <View style={{ flex: 1 }}><Text style={styles.editorTitle}>Popular Card Settings</Text><Text style={styles.tableSecondary}>{selectedPopular.brand.name} · Position #{selectedPopular.position}</Text></View>
            </View>
            <View style={styles.linkedRateBlock}>
              <Text style={styles.fieldLabel}>Main rate</Text>
              <Text style={styles.tablePrimary}>Linked to headline/display rate</Text>
              <Text style={styles.tableSecondary}>Popular Gift Cards does not store a second price. The Home price stays tied to the card's admin-selected headline rate for each payout market.</Text>
            </View>
            <Toggle label="Bonus" value={popularDraft.bonusEnabled} onChange={(bonusEnabled) => setPopularDraft((current) => ({ ...current, bonusEnabled }))} />
            <View style={{ gap: 6 }}>
              <Text style={styles.fieldLabel}>Bonus currency</Text>
              <Pressable testID="popular-bonus-currency" disabled={!popularDraft.bonusEnabled} onPress={() => setPopularCurrencyOpen(true)} style={[styles.selectorControl, !popularDraft.bonusEnabled && styles.disabledAction]}>
                <View style={styles.selectorValueRow}>
                  <View style={styles.currencyBadge}><Text style={styles.currencyBadgeText}>{popularBonusMarket ? currencySymbol(popularBonusMarket.currency) : "¤"}</Text></View>
                  <View style={{ flex: 1 }}><Text style={styles.selectorPrimary}>{popularBonusMarket ? `${popularBonusMarket.name} · ${popularBonusMarket.currency}` : "Select active market currency"}</Text><Text style={styles.selectorSecondary}>Currency options come from active Markets.</Text></View>
                  <Ionicons name="chevron-down" size={18} color={colors.onSurfaceSecondary} />
                </View>
              </Pressable>
            </View>
            <Field label="Bonus amount" keyboardType="decimal-pad" editable={popularDraft.bonusEnabled} value={popularDraft.bonusAmount} onChangeText={(bonusAmount) => setPopularDraft((current) => ({ ...current, bonusAmount }))} placeholder={popularBonusMarket ? `e.g. ${currencySymbol(popularBonusMarket.currency)}5000` : "Choose a currency first"} />
            <Field label="Minimum card value (USD, optional)" keyboardType="number-pad" editable={popularDraft.bonusEnabled} value={popularDraft.minCardValue} onChangeText={(minCardValue) => setPopularDraft((current) => ({ ...current, minCardValue }))} placeholder="e.g. 500" />
            {popularDraft.bonusEnabled && popularBonusMarket && popularDraft.bonusAmount && <View style={styles.bonusPreview} testID="popular-bonus-preview">
              <Text style={styles.tableSecondary}>Bonus preview</Text>
              <Text style={styles.bonusPreviewAmount}>+ {formatMoney(toMinor(popularDraft.bonusAmount, popularBonusMarket.minor_digits) || 0, popularBonusMarket.currency, popularBonusMarket.minor_digits)} bonus</Text>
              {!!popularDraft.minCardValue && <Text style={styles.tableSecondary}>${popularDraft.minCardValue} card upward</Text>}
            </View>}
            <Action title="Save Popular Settings" disabled={busy} onPress={() => { void savePopularBonus(); }} />
            <Pressable testID="popular-remove-card" onPress={() => { void removePopularCard(selectedPopular.brand_id); }} disabled={busy} style={styles.dangerAction}><Text style={styles.dangerActionText}>Remove from Popular</Text></Pressable>
          </Panel> : <Panel><Note>Select a Popular card to edit its bonus settings. Main pricing remains linked to that card's headline/display rate.</Note></Panel>}
        </View>
      </View>}

      <SelectorSheet visible={popularAddOpen} title="Add to Popular Gift Cards" onClose={() => setPopularAddOpen(false)}>
        {popularRows.length >= 8 ? <Note>Popular Gift Cards already has the maximum 8 cards.</Note> : addablePopularBrands.length === 0 ? <Note>No eligible active catalog cards are available to add.</Note> : addablePopularBrands.map((brand) => <Pressable key={brand.id} onPress={() => { void addPopularCard(brand.id); }} style={styles.selectorOption} disabled={busy} testID={`popular-add-${brand.id}`}>
          <BrandIcon brand={brand} size={36} borderRadius={9} />
          <View style={{ flex: 1 }}><Text style={styles.tablePrimary}>{brand.name}</Text><Text style={styles.tableSecondary}>{brand.category} · A headline/display rate is required</Text></View>
          <Ionicons name="add-circle-outline" size={20} color={colors.brandPrimary} />
        </Pressable>)}
      </SelectorSheet>

      <SelectorSheet visible={popularCurrencyOpen} title="Bonus currency" onClose={() => setPopularCurrencyOpen(false)}>
        {activeMarkets.map((item) => <Pressable key={item.code} onPress={() => { setPopularDraft((current) => ({ ...current, bonusMarketCode: item.code, bonusAmount: "" })); setPopularCurrencyOpen(false); }} style={[styles.selectorOption, popularDraft.bonusMarketCode === item.code && styles.selectorOptionActive]} testID={`popular-currency-${item.code}`}>
          <View style={styles.currencyBadge}><Text style={styles.currencyBadgeText}>{currencySymbol(item.currency)}</Text></View>
          <View style={{ flex: 1 }}><Text style={styles.tablePrimary}>{item.name}</Text><Text style={styles.tableSecondary}>{item.currency} · {currencySymbol(item.currency)}</Text></View>
          {popularDraft.bonusMarketCode === item.code && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
        </Pressable>)}
      </SelectorSheet>
    </> : <>
      <View style={styles.ratesHeader} testID="admin-rates-workspace">
        <View style={{ flex: 1, minWidth: 220 }}>
          <Text style={styles.sectionTitle}>Rates</Text>
          <Text style={styles.sectionSubtitle}>Manage the simple All Cards display rate and the country-specific Physical / Code rates for each card.</Text>
        </View>
      </View>

      <View style={[styles.rateFilters, !desktop && styles.rateFiltersMobile]}>
        <View style={{ flex: 1, minWidth: desktop ? 260 : 0 }}>
          <Text style={styles.selectorLabel}>Card</Text>
          <Pressable testID="rate-card-selector" style={styles.selectorControl} onPress={() => setBrandPickerOpen(true)} disabled={brands.isLoading || !brands.data?.brands.length}>
            <View style={styles.selectorValueRow}>
              {form.id ? <BrandIcon brand={form} size={34} borderRadius={9} /> : <View style={styles.selectorPlaceholderIcon}><Ionicons name="gift-outline" size={18} color={colors.muted} /></View>}
              <View style={{ flex: 1 }}>
                <Text style={styles.selectorPrimary}>{form.id ? form.name : "Select gift card"}</Text>
                <Text style={styles.selectorSecondary}>{form.id ? readiness(form) : "Choose a catalog card"}</Text>
              </View>
              <Ionicons name="chevron-down" size={18} color={colors.onSurfaceSecondary} />
            </View>
          </Pressable>
        </View>

        <View style={{ flex: 1, minWidth: desktop ? 260 : 0 }}>
          <Text style={styles.selectorLabel}>Payout market</Text>
          <Pressable testID="rate-market-selector" style={styles.selectorControl} onPress={() => setMarketPickerOpen(true)} disabled={markets.isLoading || !markets.data?.markets.length}>
            <View style={styles.selectorValueRow}>
              <View style={styles.selectorPlaceholderIcon}><Ionicons name="globe-outline" size={18} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.selectorPrimary}>{market?.name || "Select payout market"}</Text>
                <Text style={styles.selectorSecondary}>{market ? `${market.currency}${market.is_active ? "" : " · Paused"}` : "Choose a market"}</Text>
              </View>
              <Ionicons name="chevron-down" size={18} color={colors.onSurfaceSecondary} />
            </View>
          </Pressable>
        </View>
      </View>

      {!!form.id && <Panel>
        <View style={styles.headlineTitleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.editorTitle}>{form.name}</Text>
            <Text style={styles.sectionSubtitle}>All Cards Display Rate</Text>
          </View>
        </View>
        {headlineRates.isError ? <Note>Display rate unavailable: {headlineRates.error.message}</Note> : headlineRates.isLoading ? <Note>Loading display rate…</Note> : <>
          <View style={[styles.headlineFields, !desktop && styles.headlineFieldsMobile]}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.fieldLabel}>Base</Text>
              <View style={styles.headlineBaseBox}><Text style={styles.headlineBaseText}>$1</Text></View>
            </View>
            <View style={{ flex: 2, gap: 6 }}>
              <Text style={styles.fieldLabel}>Payout</Text>
              <View style={[styles.headlineInputWrap, !market?.is_active && styles.disabledAction]}>
                <Text style={styles.headlineCurrency}>{market ? currencySymbol(market.currency) : "¤"}</Text>
                <TextInput
                  testID="headline-rate-payout"
                  accessibilityLabel="All Cards display payout"
                  keyboardType="decimal-pad"
                  editable={!!market?.is_active}
                  value={headlineAmount}
                  onChangeText={setHeadlineAmount}
                  placeholder="1,138.41"
                  placeholderTextColor={colors.muted}
                  style={styles.headlineInput}
                />
              </View>
            </View>
          </View>
          <Action title="Save" disabled={busy || !market?.is_active} onPress={() => { void saveHeadlineRate(); }} />
        </>}
      </Panel>}

      {markets.error && <Panel><Note>Markets unavailable: {markets.error.message}</Note></Panel>}
      {detailedRates.error && <Panel><Note>Detailed rates unavailable: {detailedRates.error.message}</Note><Action title="Retry detailed rates" onPress={() => { void detailedRates.refetch(); }} /></Panel>}
      {!form.id && <Panel><Note>Select a gift card to manage its detailed card rates.</Note></Panel>}

      {!!form.id && !detailedRates.isError && <Panel>
        <View style={styles.detailedHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.editorTitle}>{form.name}</Text>
            <Text style={styles.sectionSubtitle}>Detailed Card Rates</Text>
          </View>
        </View>
        {detailedRates.isLoading ? <Note>Loading detailed card rates…</Note> : <View style={[styles.detailedWorkspace, !desktop && styles.detailedWorkspaceMobile]} testID="detailed-rate-workspace">
          <View style={[styles.detailedCountriesColumn, !desktop && styles.detailedCountriesColumnMobile]}>
            <Text style={styles.detailedColumnTitle}>Countries</Text>
            {detailedCountries.length === 0 && !pendingDetailedCountry ? <Text style={styles.tableSecondary}>No countries configured for this card in {market?.name || country}.</Text> : null}
            {detailedCountries.map((item) => <Pressable
              key={item.code}
              testID={`detailed-country-${item.code}`}
              onPress={() => { setPendingDetailedCountry(""); setSelectedDetailedCountry(item.code); }}
              style={[styles.detailedCountryItem, selectedDetailedCountry === item.code && styles.detailedCountryItemActive]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.tablePrimary}>{countryDisplayName(item.code)}</Text>
                <Text style={styles.tableSecondary}>{item.code}</Text>
              </View>
              <BoolPill value={item.isActive} yes="Active" no="Disabled" />
            </Pressable>)}
            {pendingDetailedCountry && !detailedCountries.some((item) => item.code === pendingDetailedCountry) && <Pressable
              testID={`detailed-country-${pendingDetailedCountry}`}
              onPress={() => setSelectedDetailedCountry(pendingDetailedCountry)}
              style={[styles.detailedCountryItem, selectedDetailedCountry === pendingDetailedCountry && styles.detailedCountryItemActive]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.tablePrimary}>{countryDisplayName(pendingDetailedCountry)}</Text>
                <Text style={styles.tableSecondary}>{pendingDetailedCountry} · Unsaved</Text>
              </View>
            </Pressable>}
            <Pressable testID="detailed-country-add" onPress={beginAddDetailedCountry} disabled={busy || !market?.is_active} style={[styles.detailedAddCountry, (!market?.is_active || busy) && styles.disabledAction]}>
              <Ionicons name="add" size={18} color={colors.brandPrimary} />
              <Text style={styles.detailedAddCountryText}>Add Country</Text>
            </Pressable>
          </View>

          <View style={styles.detailedEditorColumn}>
            {!selectedDetailedCountry ? <Note>Select a country, or add one, to set its Physical / Code rates.</Note> : <>
              <View style={styles.detailedCountryHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.editorTitle}>{countryDisplayName(selectedDetailedCountry)}</Text>
                  <Text style={styles.tableSecondary}>{selectedDetailedCountry} · {market?.name || country} payout market</Text>
                </View>
                {selectedDetailed && <BoolPill value={selectedDetailed.isActive} yes="Active" no="Disabled" />}
              </View>
              {!selectedDetailed && <Note>This country is new. Enter at least one supported rate and save to add it to this card.</Note>}

              {form.submission_types.includes("physical") && <View style={styles.detailedRateBlock}>
                <Text style={styles.detailedTypeTitle}>Physical</Text>
                <Text style={styles.fieldLabel}>Rate per unit</Text>
                <View style={[styles.headlineInputWrap, !market?.is_active && styles.disabledAction]}>
                  <Text style={styles.headlineCurrency}>{market ? currencySymbol(market.currency) : "¤"}</Text>
                  <TextInput
                    testID="detailed-physical-rate"
                    accessibilityLabel={`${selectedDetailedCountry} Physical rate per unit`}
                    keyboardType="decimal-pad"
                    editable={!!market?.is_active}
                    value={physicalRateAmount}
                    onChangeText={setPhysicalRateAmount}
                    placeholder="1,138.41"
                    placeholderTextColor={colors.muted}
                    style={styles.headlineInput}
                  />
                </View>
              </View>}

              {form.submission_types.includes("ecode") && <View style={styles.detailedRateBlock}>
                <Text style={styles.detailedTypeTitle}>Code</Text>
                <Text style={styles.fieldLabel}>Rate per unit</Text>
                <View style={[styles.headlineInputWrap, !market?.is_active && styles.disabledAction]}>
                  <Text style={styles.headlineCurrency}>{market ? currencySymbol(market.currency) : "¤"}</Text>
                  <TextInput
                    testID="detailed-code-rate"
                    accessibilityLabel={`${selectedDetailedCountry} Code rate per unit`}
                    keyboardType="decimal-pad"
                    editable={!!market?.is_active}
                    value={codeRateAmount}
                    onChangeText={setCodeRateAmount}
                    placeholder="1,105.00"
                    placeholderTextColor={colors.muted}
                    style={styles.headlineInput}
                  />
                </View>
              </View>}

              <Action title="Save" disabled={busy || !market?.is_active} onPress={() => { void saveDetailedCountryRates(); }} />

              {selectedDetailed && <View style={styles.detailedCountryActions}>
                <Pressable
                  testID="detailed-country-toggle"
                  disabled={busy}
                  onPress={() => { void setDetailedCountryEnabled(!selectedDetailed.isActive); }}
                  style={styles.secondaryCompact}
                ><Text style={styles.secondaryCompactText}>{selectedDetailed.isActive ? "Disable Country" : "Enable Country"}</Text></Pressable>
                {!detailedCountryDeleteConfirm ? <Pressable
                  testID="detailed-country-remove"
                  disabled={busy}
                  onPress={() => setDetailedCountryDeleteConfirm(true)}
                  style={styles.dangerAction}
                ><Text style={styles.dangerActionText}>Remove Country</Text></Pressable> : <View style={styles.deleteConfirm} testID="detailed-country-remove-confirm">
                  <Text style={styles.fieldLabel}>Remove {countryDisplayName(selectedDetailedCountry)}?</Text>
                  <Text style={styles.tableSecondary}>It will disappear from this card's detailed-rate country list. Existing legacy trade history is not changed.</Text>
                  <View style={styles.deleteConfirmActions}>
                    <Pressable onPress={() => setDetailedCountryDeleteConfirm(false)} style={styles.secondaryCompact} disabled={busy}><Text style={styles.secondaryCompactText}>Cancel</Text></Pressable>
                    <Pressable testID="detailed-country-remove-confirm-action" onPress={() => { void removeDetailedCountry(); }} style={styles.dangerCompact} disabled={busy}><Text style={styles.dangerCompactText}>Confirm</Text></Pressable>
                  </View>
                </View>}
              </View>}
            </>}
          </View>
        </View>}
      </Panel>}

      <SelectorSheet visible={brandPickerOpen} title="Select gift card" onClose={() => setBrandPickerOpen(false)}>
        {(brands.data?.brands ?? []).map((brand) => <Pressable key={brand.id} testID={`rate-brand-${brand.id}`} onPress={() => { selectBrand(brand); setBrandPickerOpen(false); }} style={[styles.selectorOption, form.id === brand.id && styles.selectorOptionActive]}>
          <BrandIcon brand={brand} size={36} borderRadius={9} />
          <View style={{ flex: 1 }}><Text style={styles.tablePrimary}>{brand.name}</Text><Text style={styles.tableSecondary}>{brand.category} · {readiness(brand)}</Text></View>
          {form.id === brand.id && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
        </Pressable>)}
      </SelectorSheet>

      <SelectorSheet visible={marketPickerOpen} title="Select payout market" onClose={() => setMarketPickerOpen(false)}>
        {(markets.data?.markets ?? []).map((item) => <Pressable key={item.code} testID={`rate-market-${item.code}`} onPress={() => { setCountry(item.code); setSelectedDetailedCountry(""); setPendingDetailedCountry(""); setMarketPickerOpen(false); }} style={[styles.selectorOption, country === item.code && styles.selectorOptionActive]}>
          <View style={styles.selectorPlaceholderIcon}><Ionicons name="globe-outline" size={18} color={colors.brandPrimary} /></View>
          <View style={{ flex: 1 }}><Text style={styles.tablePrimary}>{item.name}</Text><Text style={styles.tableSecondary}>{item.code} · {item.currency}{item.is_active ? "" : " · Paused"}</Text></View>
          {country === item.code && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
        </Pressable>)}
      </SelectorSheet>

      <SelectorSheet visible={addCountryOpen} title="Add Country" onClose={() => setAddCountryOpen(false)}>
        <Field label="Country / region code" value={newCountryCode} onChangeText={setNewCountryCode} placeholder="e.g. US, UK, CA, AU, JP" autoCapitalize="characters" />
        <Note>Only countries management adds here belong to this card's detailed-rate setup. No country is added automatically.</Note>
        <Action title="Continue" disabled={busy || !newCountryCode.trim()} onPress={chooseNewDetailedCountry} />
      </SelectorSheet>
    </>}
  </AdminPage>;
}

export default function Catalog() { return <CatalogWorkspace initialTab="catalog" />; }

const useStyles = makeStyles((colors) => ({
  tabs: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  catalogSubTabs: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", padding: 4, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  catalogSubTab: { minHeight: 36, paddingHorizontal: 13, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  catalogSubTabActive: { backgroundColor: colors.surface },
  catalogSubTabText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "800" },
  catalogSubTabTextActive: { color: colors.brandPrimary },
  tab: { paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: colors.brandPrimary },
  workspace: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  workspaceMobile: { flexDirection: "column" },
  mainColumn: { flex: 1, width: "100%", minWidth: 0, gap: spacing.md },
  editorColumn: { width: 390, maxWidth: "100%", flexShrink: 0 },
  rateSelectorColumn: { width: 300, maxWidth: "100%", flexShrink: 0 },
  sectionHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" },
  sectionTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  sectionSubtitle: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 3, lineHeight: 18 },
  ratesHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" },
  headlineTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  headlineFields: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md },
  headlineFieldsMobile: { flexDirection: "column", alignItems: "stretch" },
  headlineBaseBox: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 12, justifyContent: "center" },
  headlineBaseText: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  headlineInputWrap: { minHeight: 46, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, overflow: "hidden" },
  headlineCurrency: { color: colors.onSurface, fontSize: 16, fontWeight: "800", paddingLeft: 12, paddingRight: 4 },
  headlineInput: { flex: 1, minHeight: 44, paddingHorizontal: 8, color: colors.onSurface, fontSize: 16 },
  detailedHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  detailedWorkspace: { flexDirection: "row", alignItems: "stretch", gap: spacing.lg },
  detailedWorkspaceMobile: { flexDirection: "column" },
  detailedCountriesColumn: { width: 285, maxWidth: "100%", flexShrink: 0, gap: spacing.xs, paddingRight: spacing.md, borderRightWidth: 1, borderRightColor: colors.divider },
  detailedCountriesColumnMobile: { width: "100%", paddingRight: 0, paddingBottom: spacing.md, borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.divider },
  detailedEditorColumn: { flex: 1, minWidth: 0, gap: spacing.md },
  detailedColumnTitle: { color: colors.onSurface, fontSize: 13, fontWeight: "800", marginBottom: 3 },
  detailedCountryItem: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 8 },
  detailedCountryItemActive: { borderColor: colors.brandPrimary, backgroundColor: colors.screenBgAlt },
  detailedAddCountry: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderStyle: "dashed", borderColor: colors.brandPrimary, borderRadius: radius.md, marginTop: spacing.xs },
  detailedAddCountryText: { color: colors.brandPrimary, fontSize: 13, fontWeight: "800" },
  detailedCountryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  detailedRateBlock: { gap: 6, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  detailedTypeTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  detailedCountryActions: { gap: spacing.sm, paddingTop: spacing.xs },
  rateFilters: { flexDirection: "row", gap: spacing.md, alignItems: "flex-end" },
  rateFiltersMobile: { flexDirection: "column", alignItems: "stretch" },
  selectorLabel: { color: colors.onSurface, fontSize: 12, fontWeight: "800", marginBottom: 6 },
  selectorControl: { minHeight: 62, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, justifyContent: "center" },
  selectorValueRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  selectorPrimary: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  selectorSecondary: { color: colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  selectorPlaceholderIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  selectorSheet: { width: 520, maxWidth: "100%", maxHeight: "80%", backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  selectorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  iconButton: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  selectorOption: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, backgroundColor: colors.surface },
  selectorOptionActive: { borderColor: colors.brandPrimary, backgroundColor: colors.screenBgAlt },
  rateEditorModal: { width: 620, maxWidth: "100%", maxHeight: "88%", backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  rateEditorModalMobile: { width: "100%", maxHeight: "92%", borderRadius: radius.lg },
  rateContextRow: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  rateContextRowMobile: { flexDirection: "column" },
  contextValue: { color: colors.onSurface, fontSize: 14, fontWeight: "800", marginTop: 3 },
  rateTypeChoice: { minHeight: 36, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  rateTypeChoiceActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandSecondary },
  rateTypeChoiceText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "800" },
  rateTypeChoiceTextActive: { color: colors.brandPrimary },
  rateMobileCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  rateMobileValue: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  rateMobileMeta: { gap: 7 },
  rateMobileMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  mobileEditRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm },
  primaryCompact: { minHeight: 38, paddingHorizontal: 13, borderRadius: radius.md, backgroundColor: colors.brandPrimary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  primaryCompactText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "800" },
  secondaryCompact: { minHeight: 34, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  secondaryCompactText: { color: colors.brandPrimary, fontSize: 12, fontWeight: "800" },
  table: { width: "100%", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surface },
  tableHeader: { flexDirection: "row", gap: spacing.md, alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  tableHeading: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  tableRow: { minHeight: 62, flexDirection: "row", gap: spacing.md, alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surface },
  tableRowSelected: { backgroundColor: colors.screenBgAlt },
  tablePrimary: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  tableSecondary: { color: colors.onSurfaceSecondary, fontSize: 11, marginTop: 2, lineHeight: 16 },
  editLink: { color: colors.brandPrimary, fontSize: 12, fontWeight: "800" },
  dangerLink: { color: colors.error, fontSize: 12, fontWeight: "800" },
  dangerAction: { minHeight: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  dangerActionText: { color: colors.error, fontSize: 13, fontWeight: "800" },
  deleteConfirm: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.error, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  deleteConfirmActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: spacing.sm },
  dangerCompact: { minHeight: 34, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: colors.error, alignItems: "center", justifyContent: "center" },
  dangerCompactText: { color: colors.surface, fontSize: 12, fontWeight: "800" },
  pill: { minHeight: 24, borderRadius: radius.pill, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  pillPositive: { backgroundColor: colors.successBg },
  pillNeutral: { backgroundColor: colors.surfaceTertiary },
  pillText: { fontSize: 10, fontWeight: "800" },
  pillTextPositive: { color: colors.success },
  pillTextNeutral: { color: colors.onSurfaceSecondary },
  mobileCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  mobilePills: { flexDirection: "row", gap: spacing.xs, marginTop: 7, flexWrap: "wrap" },
  editorTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  editorTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "800" },
  logoBlock: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider },
  logoActions: { flexDirection: "row", gap: spacing.xs },
  fieldLabel: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  brandChoice: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, padding: 10 },
  brandChoiceActive: { borderColor: colors.brandPrimary, backgroundColor: colors.screenBgAlt },
  stepLabel: { color: colors.onSurface, fontSize: 13, fontWeight: "800", marginTop: spacing.xs },
  marketChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  marketChip: { minHeight: 34, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  marketChipActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandSecondary },
  marketChipText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "700" },
  marketChipTextActive: { color: colors.brandPrimary },
  typeRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  typePill: { minHeight: 28, borderRadius: radius.pill, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  typePillText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "700" },
  rowActions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  popularCount: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  popularRowActions: { width: 150, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  popularMobileOrder: { alignItems: "center", justifyContent: "center", gap: 8 },
  popularPosition: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "800", width: 26 },
  linkedRateBlock: { gap: 4, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  bonusPreview: { gap: 3, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  bonusPreviewAmount: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  currencyBadge: { minWidth: 42, height: 36, paddingHorizontal: 8, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  currencyBadgeText: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  disabledAction: { opacity: 0.4 },
  mobileRateHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  rateAmount: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
}));

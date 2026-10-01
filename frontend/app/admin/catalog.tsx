import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as ImagePicker from "expo-image-picker";
import { api, uploadBrandLogo } from "@/src/api/client";
import { BrandIcon } from "@/src/components/brand-icon";
import { useToast } from "@/src/components/toast";
import { AdminPage, Panel, Field, Action, Toggle, Note } from "@/src/components/admin-form";
import { CardRate, Market } from "@/src/lib/market";
import { formatMoney, toMinor } from "@/src/lib/format";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Brand = {
  id: string; name: string; category: string; color: string;
  is_active: boolean; is_popular: boolean; is_tradable?: boolean;
  has_logo?: boolean; logo_version?: string; archived_at?: string;
  submission_types: ("physical" | "ecode")[]; subcategories: string[]; countries: string[];
};

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

type RateEditorState = {
  id: string;
  cardCountry: string;
  face: string;
  rangeMin: string;
  rangeMax: string;
  submissionType: "any" | "physical" | "ecode";
  ratePerUsd: string;
  isActive: boolean;
  isHeadline: boolean;
};

const blankRate: RateEditorState = {
  id: "", cardCountry: "", face: "", rangeMin: "", rangeMax: "", submissionType: "physical", ratePerUsd: "", isActive: true, isHeadline: false,
};

function submissionTypeLabel(type: CardRate["submission_type"]) {
  if (type === "ecode") return "Code";
  if (type === "physical") return "Physical";
  return "Any (legacy)";
}

function rangeLabel(rate: CardRate) {
  return rate.range_min == null || rate.range_max == null ? "Fixed" : `${rate.range_min}–${rate.range_max}`;
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
  const [rateEditorOpen, setRateEditorOpen] = useState(false);
  const [rateDraft, setRateDraft] = useState<RateEditorState>({ ...blankRate });
  const [rateDeleteConfirm, setRateDeleteConfirm] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast(), qc = useQueryClient(), router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const brands = useQuery({ queryKey: ["admin-brands"], queryFn: () => api.get<{ brands: Brand[] }>("/admin/brands") });
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
  const rates = useQuery({ queryKey: ["admin-card-rates", form.id],
    queryFn: () => api.get<{ rates: CardRate[] }>(`/admin/card-rates?brand_id=${encodeURIComponent(form.id)}`), enabled: !!form.id });
  const market = markets.data?.markets.find((item) => item.code === country);

  const visibleBrands = useMemo(() => {
    const term = catalogSearch.trim().toLowerCase();
    return (brands.data?.brands ?? []).filter((brand) => !term || [brand.name, brand.category, ...(brand.countries ?? [])]
      .some((value) => value.toLowerCase().includes(term)));
  }, [brands.data?.brands, catalogSearch]);
  const marketRates = useMemo(() => (rates.data?.rates ?? []).filter((rate) => rate.market_code === country), [rates.data?.rates, country]);

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    try { await work(); await qc.invalidateQueries(); toast.show(success, "success"); }
    catch (error) { toast.show((error as Error).message || "Could not save this change", "error"); }
    finally { setBusy(false); }
  };
  const selectBrand = (brand: Brand) => { setForm(normalizeBrand(brand)); setDeleteConfirm(false); setRateEditorOpen(false); setRateDeleteConfirm(false); };
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
  const openNewRate = () => {
    const allowed = form.submission_types.includes("physical") ? "physical" : "ecode";
    setRateDraft({ ...blankRate, submissionType: allowed });
    setRateDeleteConfirm(false);
    setRateEditorOpen(true);
  };
  const openRate = (rate: CardRate) => {
    const rateMarket = markets.data?.markets.find((item) => item.code === rate.market_code);
    const digits = rateMarket?.minor_digits ?? 2;
    const perUsdMinor = rate.rate_minor_per_usd ?? (rate.payout_minor % rate.face_value === 0 ? rate.payout_minor / rate.face_value : null);
    setCountry(rate.market_code);
    setRateDraft({
      id: rate.id,
      cardCountry: rate.card_country || "",
      face: String(rate.face_value),
      rangeMin: rate.range_min == null ? "" : String(rate.range_min),
      rangeMax: rate.range_max == null ? "" : String(rate.range_max),
      submissionType: rate.submission_type ?? "any",
      ratePerUsd: perUsdMinor == null ? "" : String(perUsdMinor / 10 ** digits),
      isActive: rate.is_active,
      isHeadline: !!rate.is_headline,
    });
    setRateDeleteConfirm(false);
    setRateEditorOpen(true);
  };
  const saveRateRule = () => run(async () => {
    const faceValue = Number(rateDraft.face);
    const rangeMin = rateDraft.rangeMin.trim() === "" ? null : Number(rateDraft.rangeMin);
    const rangeMax = rateDraft.rangeMax.trim() === "" ? null : Number(rateDraft.rangeMax);
    const rateMinorPerUsd = toMinor(rateDraft.ratePerUsd.trim(), market?.minor_digits ?? 2);
    if (!form.id || !market || !market.is_active) throw new Error("Choose a gift card and an active country");
    if (!Number.isSafeInteger(faceValue) || faceValue <= 0) throw new Error("Enter a valid card value");
    if ((rangeMin == null) !== (rangeMax == null)) throw new Error("Enter both range values or leave both blank for Fixed");
    if (rangeMin != null && rangeMax != null && (!Number.isSafeInteger(rangeMin) || !Number.isSafeInteger(rangeMax) || rangeMin < 0 || rangeMax < rangeMin))
      throw new Error("Enter a valid value range");
    if (!rateMinorPerUsd) throw new Error("Enter a positive rate per $1");
    const payload = {
      brand_id: form.id,
      market_code: country,
      card_country: rateDraft.cardCountry.trim().toUpperCase(),
      face_value: faceValue,
      submission_type: rateDraft.submissionType,
      range_min: rangeMin,
      range_max: rangeMax,
      rate_minor_per_usd: rateMinorPerUsd,
      is_active: rateDraft.isActive,
      is_headline: rateDraft.isHeadline,
    };
    if (rateDraft.id) await api.patch(`/admin/card-rates/${encodeURIComponent(rateDraft.id)}`, payload);
    else await api.post("/admin/card-rates", payload);
    setRateEditorOpen(false);
    setRateDeleteConfirm(false);
  }, rateDraft.id ? "Rate changes saved" : "Rate added");
  const safeDeleteRate = () => run(async () => {
    await api.del<{ ok: boolean; deleted: boolean; archived: boolean }>(`/admin/card-rates/${encodeURIComponent(rateDraft.id)}/safe`);
    setRateEditorOpen(false);
    setRateDeleteConfirm(false);
  }, "Rate removed safely");

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

    {tab === "catalog" ? <View style={[styles.workspace, !desktop && styles.workspaceMobile]} testID="admin-catalog-workspace">
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
          <Toggle label="Popular" value={form.is_popular} onChange={(is_popular) => setForm({ ...form, is_popular })} />
          <Note>Active cards are only tradable when an active market has a positive denomination rate. Popular only affects Home once the card is tradable.</Note>
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
    </View> : <>
      <View style={styles.ratesHeader} testID="admin-rates-workspace">
        <View style={{ flex: 1, minWidth: 220 }}>
          <Text style={styles.sectionTitle}>Rate rules</Text>
          <Text style={styles.sectionSubtitle}>Manage the card country/region, value, range, type and rate per $1 for each payout market.</Text>
        </View>
        <Pressable testID="rate-add" style={styles.primaryCompact} onPress={openNewRate} disabled={!form.id || !market?.is_active}>
          <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.primaryCompactText}>Add Rate</Text>
        </Pressable>
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

      {markets.error && <Panel><Note>Markets unavailable: {markets.error.message}</Note></Panel>}
      {rates.error && <Panel><Note>Rates unavailable: {rates.error.message}</Note><Action title="Retry rates" onPress={() => { void rates.refetch(); }} /></Panel>}
      {!form.id && <Panel><Note>Select a gift card to manage its rate rules.</Note></Panel>}
      {!!form.id && !rates.isError && rates.isLoading && <Panel><Note>Loading rates…</Note></Panel>}
      {!!form.id && !rates.isError && !rates.isLoading && marketRates.length === 0 && <Panel>
        <Note>No rate rules exist for {form.name} in {market?.name || country} yet.</Note>
        <Action title="Add First Rate" disabled={!market?.is_active} onPress={openNewRate} />
      </Panel>}

      {!!form.id && marketRates.length > 0 && (desktop ? <View style={styles.table} testID="rates-desktop-table">
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeading, { flex: 0.9 }]}>Card country</Text>
          <Text style={[styles.tableHeading, { flex: 0.75 }]}>Value</Text>
          <Text style={[styles.tableHeading, { flex: 1.05 }]}>Range</Text>
          <Text style={[styles.tableHeading, { flex: 1 }]}>Type</Text>
          <Text style={[styles.tableHeading, { flex: 1.35 }]}>Rate / $1</Text>
          <Text style={[styles.tableHeading, { flex: 0.9 }]}>Status</Text>
          <Text style={[styles.tableHeading, { width: 82 }]}>Action</Text>
        </View>
        {marketRates.map((rate) => {
          const rateMarket = markets.data?.markets.find((item) => item.code === rate.market_code);
          const digits = rateMarket?.minor_digits ?? 2;
          const perUsdMinor = rate.rate_minor_per_usd ?? (rate.payout_minor % rate.face_value === 0 ? rate.payout_minor / rate.face_value : null);
          return <Pressable key={rate.id} onPress={() => openRate(rate)} style={styles.tableRow} accessibilityRole="button" accessibilityLabel={`Edit ${form.name} ${rate.face_value} rate`}>
            <Text style={[styles.tablePrimary, { flex: 0.9 }]}>{rate.card_country || "General"}</Text>
            <Text style={[styles.tablePrimary, { flex: 0.75 }]}>${rate.face_value}</Text>
            <View style={{ flex: 1.05 }}><Text style={styles.tablePrimary}>{rangeLabel(rate)}</Text>{rate.range_min != null && <Text style={styles.tableSecondary}>Condition range</Text>}</View>
            <Text style={[styles.tablePrimary, { flex: 1 }]}>{submissionTypeLabel(rate.submission_type)}</Text>
            <View style={{ flex: 1.35 }}>
              <Text style={styles.tablePrimary}>{perUsdMinor != null ? `${formatMoney(perUsdMinor, rateMarket?.currency || "NGN", digits)} / $1` : "Legacy total"}</Text>
              {rate.is_headline && <Text style={[styles.tableSecondary, { color: colors.brandPrimary }]}>All Cards display rate</Text>}
              {perUsdMinor == null && <Text style={styles.tableSecondary}>{formatMoney(rate.payout_minor, rateMarket?.currency || "NGN", digits)} per card</Text>}
            </View>
            <View style={{ flex: 0.9, alignItems: "flex-start" }}><BoolPill value={rate.is_active} yes="Active" no="Paused" /></View>
            <Text style={[styles.editLink, { width: 82 }]}>Edit</Text>
          </Pressable>;
        })}
      </View> : <View style={{ gap: spacing.sm }} testID="rates-mobile-list">
        {marketRates.map((rate) => {
          const rateMarket = markets.data?.markets.find((item) => item.code === rate.market_code);
          const digits = rateMarket?.minor_digits ?? 2;
          const perUsdMinor = rate.rate_minor_per_usd ?? (rate.payout_minor % rate.face_value === 0 ? rate.payout_minor / rate.face_value : null);
          return <Pressable key={rate.id} style={styles.rateMobileCard} onPress={() => openRate(rate)}>
            <View style={styles.mobileRateHead}><Text style={styles.rateMobileValue}>${rate.face_value}</Text><BoolPill value={rate.is_active} yes="Active" no="Paused" /></View>
            <View style={styles.rateMobileMeta}>
              <View style={styles.rateMobileMetaRow}><Text style={styles.tableSecondary}>Card country</Text><Text style={styles.tablePrimary}>{rate.card_country || "General"}</Text></View>
              <View style={styles.rateMobileMetaRow}><Text style={styles.tableSecondary}>Range</Text><Text style={styles.tablePrimary}>{rangeLabel(rate)}</Text></View>
              <View style={styles.rateMobileMetaRow}><Text style={styles.tableSecondary}>Type</Text><Text style={styles.tablePrimary}>{submissionTypeLabel(rate.submission_type)}</Text></View>
              <View style={styles.rateMobileMetaRow}><Text style={styles.tableSecondary}>Rate / $1</Text><Text style={styles.tablePrimary}>{perUsdMinor != null ? formatMoney(perUsdMinor, rateMarket?.currency || "NGN", digits) : "Legacy total"}</Text></View>
              {rate.is_headline && <View style={styles.rateMobileMetaRow}><Text style={styles.tableSecondary}>All Cards</Text><Text style={[styles.tablePrimary, { color: colors.brandPrimary }]}>Display rate</Text></View>}
            </View>
            <View style={styles.mobileEditRow}><Text style={styles.editLink}>Edit Rate</Text><Ionicons name="chevron-forward" size={18} color={colors.muted} /></View>
          </Pressable>;
        })}
      </View>)}

      <SelectorSheet visible={brandPickerOpen} title="Select gift card" onClose={() => setBrandPickerOpen(false)}>
        {(brands.data?.brands ?? []).map((brand) => <Pressable key={brand.id} testID={`rate-brand-${brand.id}`} onPress={() => { selectBrand(brand); setBrandPickerOpen(false); }} style={[styles.selectorOption, form.id === brand.id && styles.selectorOptionActive]}>
          <BrandIcon brand={brand} size={36} borderRadius={9} />
          <View style={{ flex: 1 }}><Text style={styles.tablePrimary}>{brand.name}</Text><Text style={styles.tableSecondary}>{brand.category} · {readiness(brand)}</Text></View>
          {form.id === brand.id && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
        </Pressable>)}
      </SelectorSheet>

      <SelectorSheet visible={marketPickerOpen} title="Select payout market" onClose={() => setMarketPickerOpen(false)}>
        {(markets.data?.markets ?? []).map((item) => <Pressable key={item.code} testID={`rate-market-${item.code}`} onPress={() => { setCountry(item.code); setMarketPickerOpen(false); setRateEditorOpen(false); }} style={[styles.selectorOption, country === item.code && styles.selectorOptionActive]}>
          <View style={styles.selectorPlaceholderIcon}><Ionicons name="globe-outline" size={18} color={colors.brandPrimary} /></View>
          <View style={{ flex: 1 }}><Text style={styles.tablePrimary}>{item.name}</Text><Text style={styles.tableSecondary}>{item.code} · {item.currency}{item.is_active ? "" : " · Paused"}</Text></View>
          {country === item.code && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
        </Pressable>)}
      </SelectorSheet>

      <Modal visible={rateEditorOpen} transparent animationType="fade" onRequestClose={() => setRateEditorOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setRateEditorOpen(false)}>
          <Pressable style={[styles.rateEditorModal, !desktop && styles.rateEditorModalMobile]} onPress={(event) => event.stopPropagation()}>
            <ScrollView contentContainerStyle={{ gap: spacing.md }} keyboardShouldPersistTaps="handled">
              <View style={styles.selectorHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.editorTitle}>{rateDraft.id ? "Edit Rate" : "Add Rate"}</Text>
                  <Text style={styles.tableSecondary}>{form.name || "Gift card"} · {market?.name || country}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Close rate editor" onPress={() => setRateEditorOpen(false)} style={styles.iconButton}>
                  <Ionicons name="close" size={21} color={colors.onSurface} />
                </Pressable>
              </View>

              <View style={styles.rateContextRow}>
                <View style={{ flex: 1 }}><Text style={styles.selectorLabel}>Card</Text><Text style={styles.contextValue}>{form.name}</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.selectorLabel}>Payout market</Text><Text style={styles.contextValue}>{market?.name || country}</Text></View>
              </View>

              <Field label="Card country / region" value={rateDraft.cardCountry} onChangeText={(cardCountry) => setRateDraft((current) => ({ ...current, cardCountry }))} placeholder="e.g. US, UK, CAD" />
              <Field label="Card value (USD)" keyboardType="number-pad" value={rateDraft.face} onChangeText={(face) => setRateDraft((current) => ({ ...current, face }))} placeholder="e.g. 50" />
              <View style={[styles.rateContextRow, !desktop && styles.rateContextRowMobile]}>
                <View style={{ flex: 1 }}><Field label="Total trade range from (optional)" keyboardType="number-pad" value={rateDraft.rangeMin} onChangeText={(rangeMin) => setRateDraft((current) => ({ ...current, rangeMin }))} placeholder="Fixed if blank" /></View>
                <View style={{ flex: 1 }}><Field label="Total trade range to (optional)" keyboardType="number-pad" value={rateDraft.rangeMax} onChangeText={(rangeMax) => setRateDraft((current) => ({ ...current, rangeMax }))} placeholder="Fixed if blank" /></View>
              </View>

              <View style={{ gap: spacing.xs }}>
                <Text style={styles.fieldLabel}>Type</Text>
                <View style={styles.typeRow}>
                  {([...(form.submission_types.includes("physical") ? ["physical" as const] : []), ...(form.submission_types.includes("ecode") ? ["ecode" as const] : []), ...(rateDraft.submissionType === "any" ? ["any" as const] : [])]).map((type) => <Pressable key={type} testID={`rate-type-${type}`} onPress={() => setRateDraft((current) => ({ ...current, submissionType: type }))} style={[styles.rateTypeChoice, rateDraft.submissionType === type && styles.rateTypeChoiceActive]}>
                    <Text style={[styles.rateTypeChoiceText, rateDraft.submissionType === type && styles.rateTypeChoiceTextActive]}>{submissionTypeLabel(type)}</Text>
                  </Pressable>)}
                </View>
              </View>

              <Field label={`Rate per $1 (${market?.currency || "currency"})`} keyboardType="decimal-pad" value={rateDraft.ratePerUsd} onChangeText={(ratePerUsd) => setRateDraft((current) => ({ ...current, ratePerUsd }))} placeholder="e.g. 1151.76" />
              <Toggle label="Active" value={rateDraft.isActive} onChange={(isActive) => setRateDraft((current) => ({ ...current, isActive, isHeadline: isActive ? current.isHeadline : false }))} />
              <Toggle label="Use as All Cards display rate" value={rateDraft.isHeadline} onChange={(isHeadline) => setRateDraft((current) => ({ ...current, isHeadline, isActive: isHeadline ? true : current.isActive }))} />
              <Note>Leave both range fields blank for a fixed rule. If a range is used, both values are required and apply to the trade's total face value (card value × quantity). The backend calculates payout from the configured rate per $1. Only one display rate can be selected per card and payout market; choosing another one replaces the previous display rate.</Note>
              <Action title={rateDraft.id ? "Save Changes" : "Save Rate"} disabled={busy || !market?.is_active} onPress={() => { void saveRateRule(); }} />

              {!!rateDraft.id && !rateDeleteConfirm && <Pressable testID="rate-safe-delete" onPress={() => setRateDeleteConfirm(true)} disabled={busy} style={styles.dangerAction}>
                <Text style={styles.dangerActionText}>Delete Rate</Text>
              </Pressable>}
              {!!rateDraft.id && rateDeleteConfirm && <View style={styles.deleteConfirm} testID="rate-delete-confirm">
                <Text style={styles.fieldLabel}>Remove this rate?</Text>
                <Text style={styles.tableSecondary}>Unused rates are deleted. A rate already referenced by trade history is archived instead so past transactions remain intact.</Text>
                <View style={styles.deleteConfirmActions}>
                  <Pressable onPress={() => setRateDeleteConfirm(false)} style={styles.secondaryCompact} disabled={busy}><Text style={styles.secondaryCompactText}>Cancel</Text></Pressable>
                  <Pressable testID="rate-delete-confirm-action" onPress={() => { void safeDeleteRate(); }} style={styles.dangerCompact} disabled={busy}><Text style={styles.dangerCompactText}>Confirm</Text></Pressable>
                </View>
              </View>}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>}
  </AdminPage>;
}

export default function Catalog() { return <CatalogWorkspace initialTab="catalog" />; }

const useStyles = makeStyles((colors) => ({
  tabs: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
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
  mobileRateHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  rateAmount: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
}));

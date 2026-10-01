import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
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
  has_logo?: boolean; logo_version?: string;
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
  if (!brand.is_active) return "Paused";
  return brand.is_tradable ? "Tradable" : "Needs market + rate";
}

function BoolPill({ value, yes = "Yes", no = "No" }: { value: boolean; yes?: string; no?: string }) {
  const styles = useStyles();
  return <View style={[styles.pill, value ? styles.pillPositive : styles.pillNeutral]}>
    <Text style={[styles.pillText, value ? styles.pillTextPositive : styles.pillTextNeutral]}>{value ? yes : no}</Text>
  </View>;
}

export function CatalogWorkspace({ initialTab = "catalog" }: { initialTab?: "catalog" | "rates" }) {
  const { width } = useWindowDimensions();
  const desktop = width >= 1024;
  const tab = initialTab;
  const { brand_id } = useLocalSearchParams<{ brand_id?: string }>();
  const [form, setForm] = useState<Brand>({ ...blank });
  const [country, setCountry] = useState("NG");
  const [face, setFace] = useState("");
  const [amount, setAmount] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
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
  const markets = useQuery({ queryKey: ["admin-markets"], queryFn: () => api.get<{ markets: Market[] }>("/admin/markets") });
  const rates = useQuery({ queryKey: ["admin-card-rates", form.id],
    queryFn: () => api.get<{ rates: CardRate[] }>(`/admin/card-rates?brand_id=${encodeURIComponent(form.id)}`), enabled: !!form.id });
  const market = markets.data?.markets.find((item) => item.code === country);

  const visibleBrands = useMemo(() => {
    const term = catalogSearch.trim().toLowerCase();
    return (brands.data?.brands ?? []).filter((brand) => !term || [brand.name, brand.category, ...(brand.countries ?? [])]
      .some((value) => value.toLowerCase().includes(term)));
  }, [brands.data?.brands, catalogSearch]);

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    try { await work(); await qc.invalidateQueries(); toast.show(success, "success"); }
    catch (error) { toast.show((error as Error).message || "Could not save this change", "error"); }
    finally { setBusy(false); }
  };
  const selectBrand = (brand: Brand) => { setForm(normalizeBrand(brand)); setFace(""); setAmount(""); };
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
  const saveRate = () => run(async () => {
    const payout_minor = toMinor(amount, market?.minor_digits ?? 2), face_value = Number(face);
    if (!market || !market.is_active || !payout_minor || !Number.isSafeInteger(face_value) || face_value <= 0)
      throw new Error("Choose an active market, a card value and a positive payout");
    await api.post("/admin/card-rates", { brand_id: form.id, market_code: country,
      face_value, payout_minor, is_active: true });
    setFace(""); setAmount("");
  }, "Denomination rate saved");

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
          <Action title={form.id ? "Save Changes" : "Save Card"} disabled={busy || !form.name.trim() || !form.submission_types.length} onPress={saveBrand} />
          {!!form.id && <Action title="Manage Rates" onPress={() => router.push({ pathname: "/admin/rates", params: { brand_id: form.id } })} />}
        </Panel>
      </View>
    </View> : <View style={[styles.workspace, !desktop && styles.workspaceMobile]} testID="admin-rates-workspace">
      <View style={styles.rateSelectorColumn}>
        <Text style={styles.sectionTitle}>1. Brand</Text>
        <Text style={styles.sectionSubtitle}>Choose the gift card whose payout denominations you want to manage.</Text>
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          {!brands.isError && brands.data?.brands.map((brand) => <Pressable key={brand.id} onPress={() => selectBrand(brand)} style={[styles.brandChoice, form.id === brand.id && styles.brandChoiceActive]} testID={`rate-brand-${brand.id}`}>
            <BrandIcon brand={brand} size={36} borderRadius={9} />
            <View style={{ flex: 1 }}>
              <Text style={styles.tablePrimary}>{brand.name}</Text>
              <Text style={styles.tableSecondary}>{readiness(brand)}</Text>
            </View>
            {form.id === brand.id && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
          </Pressable>)}
        </View>
        {!brands.isError && brands.data?.brands.length === 0 && <Panel><Note>No gift cards exist yet.</Note><Action title="Open Catalog" onPress={() => router.push("/admin/catalog")} /></Panel>}
      </View>

      <View style={styles.mainColumn}>
        {!form.id ? <Panel><Note>Select a gift card to manage its rates.</Note></Panel> : <>
          <Panel>
            <View style={styles.editorTitleRow}>
              <BrandIcon brand={form} size={48} borderRadius={12} />
              <View style={{ flex: 1 }}>
                <Text style={styles.editorTitle}>{form.name}</Text>
                <Text style={styles.tableSecondary}>Rate setup · Brand → Market → Card type/value → Payout</Text>
              </View>
            </View>
            <Text style={styles.stepLabel}>2. Market</Text>
            {markets.error && <Note>Markets unavailable: {markets.error.message}</Note>}
            <View style={styles.marketChips}>
              {markets.data?.markets.map((item) => <Pressable key={item.code} onPress={() => setCountry(item.code)} style={[styles.marketChip, country === item.code && styles.marketChipActive]} testID={`rate-market-${item.code}`}>
                <Text style={[styles.marketChipText, country === item.code && styles.marketChipTextActive]}>{item.name} · {item.currency}{item.is_active ? "" : " · Paused"}</Text>
              </Pressable>)}
            </View>

            <Text style={styles.stepLabel}>3. Card type / value</Text>
            <View style={styles.typeRow}>
              {form.submission_types.map((type) => <View key={type} style={styles.typePill}><Text style={styles.typePillText}>{type === "ecode" ? "E-code" : "Physical"}</Text></View>)}
            </View>
            {!!form.subcategories.length && <Text style={styles.tableSecondary}>Configured types: {form.subcategories.join(", ")}</Text>}
            <Field label="Card face value (USD)" keyboardType="number-pad" value={face} onChangeText={setFace} />

            <Text style={styles.stepLabel}>4. Payout</Text>
            <Field label={`Total payout (${market?.currency || "select market"})`} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
            <Note>The existing rate model is preserved: payout is saved for this brand + market + face value and applies to the card types enabled above.</Note>
            <Action title="Save Denomination Rate" disabled={busy || !market?.is_active} onPress={saveRate} />
          </Panel>

          <View>
            <Text style={styles.sectionTitle}>Current denomination rates</Text>
            <Text style={styles.sectionSubtitle}>Edit or pause existing values without changing the underlying rate logic.</Text>
          </View>
          {rates.error && <Panel><Note>Rates unavailable: {rates.error.message}</Note></Panel>}
          {!rates.isError && !rates.isLoading && !rates.data?.rates.length && <Panel><Note>No denomination rates exist for {form.name} yet.</Note></Panel>}
          {desktop && !!rates.data?.rates.length ? <View style={styles.table} testID="rates-desktop-table">
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeading, { flex: 1.2 }]}>Market</Text>
              <Text style={[styles.tableHeading, { flex: 0.8 }]}>Value</Text>
              <Text style={[styles.tableHeading, { flex: 1.25 }]}>Payout</Text>
              <Text style={[styles.tableHeading, { flex: 0.7 }]}>Version</Text>
              <Text style={[styles.tableHeading, { flex: 0.9 }]}>Status</Text>
              <Text style={[styles.tableHeading, { width: 128 }]}>Action</Text>
            </View>
            {rates.data?.rates.map((rate) => {
              const rateMarket = markets.data?.markets.find((item) => item.code === rate.market_code);
              return <View key={rate.id} style={styles.tableRow}>
                <View style={{ flex: 1.2 }}><Text style={styles.tablePrimary}>{rateMarket?.name || rate.market_code}</Text><Text style={styles.tableSecondary}>{rateMarket?.currency || ""}</Text></View>
                <Text style={[styles.tablePrimary, { flex: 0.8 }]}>${rate.face_value}</Text>
                <Text style={[styles.tablePrimary, { flex: 1.25 }]}>{formatMoney(rate.payout_minor, rateMarket?.currency || "NGN", rateMarket?.minor_digits ?? 2)}</Text>
                <Text style={[styles.tablePrimary, { flex: 0.7 }]}>v{rate.version}</Text>
                <View style={{ flex: 0.9, alignItems: "flex-start" }}><BoolPill value={rate.is_active} yes="Active" no="Paused" /></View>
                <View style={[styles.rowActions, { width: 128 }]}>
                  <Pressable onPress={() => { setCountry(rate.market_code); setFace(String(rate.face_value)); setAmount(String(rate.payout_minor / 10 ** (rateMarket?.minor_digits ?? 2))); }}><Text style={styles.editLink}>Edit</Text></Pressable>
                  <Pressable disabled={busy || !rate.is_active} onPress={() => { void run(async () => { await api.del(`/admin/card-rates/${rate.id}`); }, "Rate disabled"); }}><Text style={[styles.dangerLink, (!rate.is_active || busy) && { opacity: 0.4 }]}>Disable</Text></Pressable>
                </View>
              </View>;
            })}
          </View> : !desktop && <View style={{ gap: spacing.sm }}>
            {rates.data?.rates.map((rate) => {
              const rateMarket = markets.data?.markets.find((item) => item.code === rate.market_code);
              return <Panel key={rate.id}>
                <View style={styles.mobileRateHead}><Text style={styles.tablePrimary}>{rateMarket?.name || rate.market_code} · ${rate.face_value}</Text><BoolPill value={rate.is_active} yes="Active" no="Paused" /></View>
                <Text style={styles.rateAmount}>{formatMoney(rate.payout_minor, rateMarket?.currency || "NGN", rateMarket?.minor_digits ?? 2)}</Text>
                <Action title="Edit Rate" onPress={() => { setCountry(rate.market_code); setFace(String(rate.face_value)); setAmount(String(rate.payout_minor / 10 ** (rateMarket?.minor_digits ?? 2))); }} />
                <Action title="Disable Rate" disabled={busy || !rate.is_active} onPress={() => { void run(async () => { await api.del(`/admin/card-rates/${rate.id}`); }, "Rate disabled"); }} />
              </Panel>;
            })}
          </View>}
        </>}
      </View>
    </View>}
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

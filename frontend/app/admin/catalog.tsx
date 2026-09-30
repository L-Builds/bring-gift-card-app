import React, { useEffect, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { api, uploadBrandLogo } from "@/src/api/client";
import { BrandIcon } from "@/src/components/brand-icon";
import { useToast } from "@/src/components/toast";
import { AdminPage, Panel, Field, Action, Toggle, Note } from "@/src/components/admin-form";
import { CardRate, Market } from "@/src/lib/market";
import { formatMoney, toMinor } from "@/src/lib/format";
import { useTheme } from "@/src/theme";

type Brand = {
  id: string; name: string; category: string; color: string;
  is_active: boolean; is_popular: boolean; is_tradable?: boolean;
  has_logo?: boolean; logo_version?: string;
  submission_types: ("physical" | "ecode")[]; subcategories: string[]; countries: string[];
};
const blank: Brand = { id: "", name: "", category: "Other", color: "#1F5AF6", is_active: false,
  is_popular: false, submission_types: ["physical", "ecode"], subcategories: [], countries: [] };

function readiness(brand: Brand) {
  if (!brand.is_active) return "Paused by management";
  return brand.is_tradable ? "Tradable now" : "Not tradable yet — active market and rate needed";
}

export function CatalogWorkspace({ initialTab = "catalog" }: { initialTab?: "catalog" | "rates" }) {
  const { width } = useWindowDimensions();
  const desktop = width >= 1180;
  const tab = initialTab;
  const { brand_id } = useLocalSearchParams<{ brand_id?: string }>();
  const [form, setForm] = useState<Brand>({ ...blank });
  const [country, setCountry] = useState("NG");
  const [face, setFace] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast(), qc = useQueryClient(), router = useRouter();
  const { colors } = useTheme();
  const brands = useQuery({ queryKey: ["admin-brands"], queryFn: () => api.get<{ brands: Brand[] }>("/admin/brands") });
  useEffect(() => {
    const selected = brands.data?.brands.find((brand) => brand.id === brand_id);
    if (!selected) return;
    const id = setTimeout(() => setForm((current) => current.id === selected.id ? current : selected), 0);
    return () => clearTimeout(id);
  }, [brand_id, brands.data?.brands]);
  const markets = useQuery({ queryKey: ["admin-markets"], queryFn: () => api.get<{ markets: Market[] }>("/admin/markets") });
  const rates = useQuery({ queryKey: ["admin-card-rates", form.id],
    queryFn: () => api.get<{ rates: CardRate[] }>(`/admin/card-rates?brand_id=${encodeURIComponent(form.id)}`), enabled: !!form.id });
  const market = markets.data?.markets.find((item) => item.code === country);

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    try { await work(); await qc.invalidateQueries(); toast.show(success, "success"); }
    catch (error) { toast.show((error as Error).message || "Could not save this change", "error"); }
    finally { setBusy(false); }
  };
  const selectBrand = (brand: Brand) => { setForm(brand); setFace(""); setAmount(""); };
  const saveBrand = () => run(async () => {
    const payload = { ...form, name: form.name.trim(), category: form.category.trim() || "Other",
      countries: form.countries.map((value) => value.trim()).filter(Boolean),
      subcategories: form.subcategories.map((value) => value.trim()).filter(Boolean),
      submission_types: [...new Set(form.submission_types)] };
    const saved = form.id ? await api.patch<Brand>(`/admin/brands/${encodeURIComponent(form.id)}`, payload)
      : await api.post<Brand>("/admin/brands", payload);
    setForm(saved);
  }, "Card settings saved");
  const uploadLogo = async () => {
    if (!form.id) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (picked.canceled || !picked.assets[0]) return;
    await run(async () => {
      await uploadBrandLogo(picked.assets[0].uri, form.id);
      const latest = await api.get<{ brands: Brand[] }>("/admin/brands");
      const updated = latest.brands.find((brand) => brand.id === form.id);
      if (updated) setForm(updated);
    }, "Card logo updated");
  };
  const removeLogo = () => run(async () => {
    setForm(await api.del<Brand>(`/admin/brands/${encodeURIComponent(form.id)}/logo`));
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
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
      <Action title={tab === "catalog" ? "Catalog ✓" : "Catalog"} onPress={() => router.push("/admin/catalog")} />
      <Action title={tab === "rates" ? "Rates ✓" : "Rates"} onPress={() => router.push("/admin/rates")} />
      <Action title="Rate history" onPress={() => router.push("/admin/rate-history")} />
    </View>
    {brands.isLoading && <Note>Loading catalog…</Note>}
    {brands.error && <Panel><Note>Catalog unavailable: {brands.error.message}</Note>
      <Action title="Retry catalog" onPress={() => { void brands.refetch(); }} /></Panel>}
    {tab === "catalog" ? <View style={{ flexDirection: desktop ? "row-reverse" : "column", alignItems: "flex-start", gap: 16 }}>
      <View style={desktop ? { flex: 1, minWidth: 0, gap: 16 } : { width: "100%", gap: 16 }}>
      <Panel>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <BrandIcon brand={form.id ? form : { ...form, id: "new-card" }} size={64} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.onSurface, fontSize: 18, fontWeight: "800" }}>
              {form.id ? `Editing ${form.name}` : "Create a gift card"}</Text>
            {form.id && <Text style={{ color: form.is_tradable ? colors.success : colors.warning, marginTop: 4 }}>
              {readiness(form)}</Text>}
          </View>
        </View>
        <Field label="Card name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
        <Field label="Category" value={form.category} onChangeText={(category) => setForm({ ...form, category })} />
        <Field label="Brand color" value={form.color} onChangeText={(color) => setForm({ ...form, color })} />
        <Field label="Card-origin countries (comma separated)" value={form.countries.join(",")}
          onChangeText={(value) => setForm({ ...form, countries: value.split(",") })} />
        <Field label="Card types / subcategories (comma separated)" value={form.subcategories.join(",")}
          onChangeText={(value) => setForm({ ...form, subcategories: value.split(",") })} />
        <Toggle label="Physical cards" value={form.submission_types.includes("physical")}
          onChange={(on) => setForm({ ...form, submission_types: on ? [...new Set([...form.submission_types, "physical" as const])] : form.submission_types.filter((type) => type !== "physical") })} />
        <Toggle label="E-codes" value={form.submission_types.includes("ecode")}
          onChange={(on) => setForm({ ...form, submission_types: on ? [...new Set([...form.submission_types, "ecode" as const])] : form.submission_types.filter((type) => type !== "ecode") })} />
        <Toggle label="Enabled by manager" value={form.is_active} onChange={(is_active) => setForm({ ...form, is_active })} />
        <Toggle label="Feature on Home when tradable" value={form.is_popular}
          onChange={(is_popular) => setForm({ ...form, is_popular })} />
        <Note>Enabling a card publishes it only after an active market has a positive denomination rate and a card type is selected.</Note>
        <Action title="Save card" disabled={busy || !form.name.trim() || !form.submission_types.length} onPress={saveBrand} />
        {!!form.id && <Action title="Manage this card’s rates" onPress={() => router.push({ pathname: "/admin/rates", params: { brand_id: form.id } })} />}
      </Panel>
      {!!form.id && <Panel>
        <Note>Card logo · JPEG, PNG or WebP. Uploads are limited to 12 MB and displayed as a normalized square image.</Note>
        <Action title={form.has_logo ? "Replace logo" : "Upload logo"} disabled={busy} onPress={() => { void uploadLogo(); }} />
        {form.has_logo && <Action title="Remove logo" disabled={busy} onPress={removeLogo} />}
      </Panel>}
      </View>
      <View style={desktop ? { width: 300, flexShrink: 0, gap: 10 } : { width: "100%", gap: 10 }}>
      <Action title="New gift card" onPress={() => selectBrand({ ...blank })} />
      {!brands.isError && brands.data?.brands.length === 0 && <Panel><Note>No gift cards yet. Create one to begin.</Note></Panel>}
      {!brands.isError && brands.data?.brands.map((brand) => <Pressable key={brand.id}
        onPress={() => selectBrand(brand)} accessibilityRole="button" accessibilityLabel={`Edit ${brand.name}`}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12,
          borderWidth: 1, borderColor: form.id === brand.id ? colors.brandPrimary : colors.border,
          backgroundColor: colors.surface }}>
          <BrandIcon brand={brand} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.onSurface, fontWeight: "800" }}>{brand.name} · {brand.category}</Text>
            <Text numberOfLines={2} style={{ color: brand.is_tradable ? colors.success : colors.onSurfaceSecondary, marginTop: 3, fontSize: 12 }}>
              {readiness(brand)}{brand.is_popular ? " · Featured" : ""}</Text>
          </View>
      </Pressable>)}
      </View>
    </View> : <View style={{ flexDirection: desktop ? "row" : "column", alignItems: "flex-start", gap: 16 }}>
      <View style={desktop ? { width: 300, flexShrink: 0 } : { width: "100%" }}>
      <Panel>
        <Note>Select a card to manage its payout denominations. Only positive rates in active markets make an enabled card tradable.</Note>
        {!brands.isError && brands.data?.brands.length === 0 && <>
          <Note>No gift cards exist yet. Add one in Catalog before setting a rate.</Note>
          <Action title="Open Catalog" onPress={() => router.push("/admin/catalog")} />
        </>}
        {!brands.isError && brands.data?.brands.map((brand) =>
          <Action key={brand.id} title={`${form.id === brand.id ? "✓ " : ""}${brand.name} · ${readiness(brand)}`}
            onPress={() => selectBrand(brand)} />)}
      </Panel>
      </View>
      <View style={desktop ? { flex: 1, minWidth: 0 } : { width: "100%" }}>
      {!!form.id && <Panel>
        <Text style={{ color: colors.onSurface, fontSize: 18, fontWeight: "800" }}>{form.name} rates</Text>
        <Note>Enter the total payout for one card at this face value. Quantity is applied by the backend.</Note>
        {markets.error && <Note>Markets unavailable: {markets.error.message}</Note>}
        {markets.data?.markets.map((item) => <Action key={item.code}
          title={`${country === item.code ? "✓ " : ""}${item.name} · ${item.currency}${item.is_active ? "" : " (paused)"}`}
          onPress={() => setCountry(item.code)} />)}
        <Field label="Card face value (USD)" keyboardType="number-pad" value={face} onChangeText={setFace} />
        <Field label={`Total payout (${market?.currency || "select market"})`} keyboardType="decimal-pad"
          value={amount} onChangeText={setAmount} />
        <Action title="Save denomination rate" disabled={busy || !market?.is_active} onPress={saveRate} />
        {rates.error && <Note>Rates unavailable: {rates.error.message}</Note>}
        {!rates.isError && rates.data?.rates.map((rate) => {
          const rateMarket = markets.data?.markets.find((item) => item.code === rate.market_code);
          return <Panel key={rate.id}>
            <Note>{rateMarket?.name || rate.market_code} · ${rate.face_value} → {formatMoney(rate.payout_minor,
              rateMarket?.currency || "NGN", rateMarket?.minor_digits ?? 2)} · {rate.is_active ? "Active rate" : "Disabled rate"}</Note>
            <Action title="Edit rate" onPress={() => { setCountry(rate.market_code); setFace(String(rate.face_value));
              setAmount(String(rate.payout_minor / 10 ** (rateMarket?.minor_digits ?? 2))); }} />
            <Action title="Disable rate" disabled={busy || !rate.is_active}
              onPress={() => { void run(async () => { await api.del(`/admin/card-rates/${rate.id}`); }, "Rate disabled"); }} />
          </Panel>;
        })}
      </Panel>}
      </View>
    </View>}
  </AdminPage>;
}

export default function Catalog() { return <CatalogWorkspace initialTab="catalog" />; }

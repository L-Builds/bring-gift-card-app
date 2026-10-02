import { useDetailedRates } from "@/src/lib/market";
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, TextInput, Modal, ScrollView } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { AppHeader } from "@/src/components/app-header";
import { ScreenBackground, PrimaryButton, LoadingView, QueryErrorView } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/context/auth";
import { api, uploadImage, ApiError } from "@/src/api/client";
import { BrandIcon } from "@/src/components/brand-icon";
import { formatNaira } from "@/src/lib/format";
import { normalizeTradeIntent } from "@/src/lib/trade-intent";

type SubmissionType = "physical" | "ecode";
type Brand = {
  id: string;
  name: string;
  color: string;
  rate_kobo_per_usd: number;
  category: string;
  subcategories: string[];
  countries: string[];
  submission_types?: SubmissionType[];
  has_logo?: boolean;
  logo_version?: string;
};

type QuoteData = {
  payout_minor: number;
  unit_payout_minor: number;
  rate_version: number;
  rate_minor_per_unit: number;
  card_country: string;
  submission_type: SubmissionType;
};

export default function Trade() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { isGuest, user } = useAuth();
  const marketCode = user?.market_code || "NG";
  const { brand_id, card_value_usd, quantity } = useLocalSearchParams<{ brand_id?: string; card_value_usd?: string; quantity?: string }>();
  const lastAppliedBrandId = useRef<string | null>(null);
  const lastAppliedIntent = useRef<string | null>(null);

  const [type, setType] = useState<SubmissionType>("physical");
  const [brand, setBrand] = useState<Brand | null>(null);
  const [subcategory, setSubcategory] = useState("");
  const [country, setCountry] = useState("");
  const [value, setValue] = useState("");
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [ecode, setEcode] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [picker, setPicker] = useState<null | "brand" | "sub" | "country">(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const { data, isLoading: brandsLoading, isError: brandsError, isRefetching: brandsRefetching, refetch: refetchBrands } = useQuery({
    queryKey: ["brands", "all", marketCode],
    queryFn: () => api.get<{ brands: Brand[] }>(`/brands?market_code=${encodeURIComponent(marketCode)}`),
    enabled: !isGuest,
  });

  useEffect(() => {
    const intent = normalizeTradeIntent({ brand_id, card_value_usd, quantity });
    if (!intent) return;
    const key = JSON.stringify(intent);
    if (lastAppliedIntent.current === key) return;
    if (lastAppliedIntent.current !== null) {
      setNotes("");
      setEcode("");
      setImages([]);
    }
    lastAppliedIntent.current = key;
    // A new navigation link must replace the prefilled form values.
    setValue(intent.card_value_usd ?? "");
    setQty(Number(intent.quantity ?? "1"));
  }, [brand_id, card_value_usd, quantity]);

  useEffect(() => {
    if (!brand_id || !data?.brands.length || lastAppliedBrandId.current === brand_id) return;
    const selected = data.brands.find((b) => b.id === brand_id);
    if (!selected) return;
    if (lastAppliedBrandId.current !== null) {
      setNotes("");
      setEcode("");
      setImages([]);
    }
    lastAppliedBrandId.current = brand_id;
    setBrand(selected);
    setSubcategory("");
    setCountry("");
    const selectedTypes: SubmissionType[] = selected.submission_types?.length ? selected.submission_types : ["physical", "ecode"];
    setType((current) => selectedTypes.includes(current) ? current : selectedTypes[0] ?? "physical");
  }, [brand_id, data]);

  const detailedRates = useDetailedRates(brand?.id ?? "");
  const activeDetailedRates = (detailedRates.data?.detailed_rates ?? []).filter((rate) => rate.is_active);
  const configuredRateTypes = [...new Set(activeDetailedRates.map((rate) => rate.submission_type))];
  const configuredRateTypeKey = configuredRateTypes.sort().join("|");
  const typeRateRows = activeDetailedRates.filter((rate) => rate.submission_type === type);
  const availableCountries = [...new Set(typeRateRows
    .map((rate) => rate.card_country?.trim().toUpperCase())
    .filter((item): item is string => !!item))];
  const rateCountryKey = availableCountries.join("|");
  const quoteCountryReady = !!country && availableCountries.includes(country.trim().toUpperCase());
  const quote = useQuery({
    queryKey: ["quote", brand?.id, value, qty, country, type],
    queryFn: () => api.post<QuoteData>("/quotes", {
      brand_id: brand!.id,
      face_value: Number(value),
      quantity: qty,
      card_country: country.trim().toUpperCase(),
      submission_type: type,
    }),
    enabled: !!brand && Number(value) > 0 && quoteCountryReady,
    refetchInterval: 15000,
  });
  const payout = quote.data?.payout_minor ?? 0;
  useEffect(() => {
    if (!brand || detailedRates.isLoading || detailedRates.isError || configuredRateTypes.includes(type)) return;
    const allowedByBrand: SubmissionType[] = brand.submission_types?.length ? brand.submission_types : ["physical", "ecode"];
    const replacement = allowedByBrand.find((candidate) => configuredRateTypes.includes(candidate));
    if (replacement) {
      setType(replacement);
      setCountry("");
    }
  }, [brand?.id, configuredRateTypeKey, detailedRates.isLoading, detailedRates.isError, type]);
  useEffect(() => {
    if (country && !availableCountries.includes(country.toUpperCase())) setCountry("");
  }, [country, rateCountryKey]);
  useEffect(()=>{setReviewOpen(false);},[quote.data?.rate_version]);

  if (isGuest) return <Redirect href="/(auth)/login" />;
  if (brandsLoading) return <ScreenBackground><AppHeader title="Trade" showBell /><LoadingView label="Loading gift cards…" /></ScreenBackground>;
  if (brandsError || !data) return <ScreenBackground><AppHeader title="Trade" showBell /><QueryErrorView title="Gift cards unavailable" subtitle="We could not load the current card catalog. Please try again before trading." onRetry={() => { void refetchBrands(); }} retrying={brandsRefetching} /></ScreenBackground>;

  const supportedTypes = (b: Brand | null): SubmissionType[] => b?.submission_types?.length ? b.submission_types : ["physical", "ecode"];
  const typeAvailable = (t: SubmissionType) => !brand || (
    supportedTypes(brand).includes(t)
    && (detailedRates.isLoading || configuredRateTypes.includes(t))
  );

  const chooseType = (next: SubmissionType) => {
    if (!typeAvailable(next)) {
      toast.show(`${brand?.name ?? "This card"} is not available as ${next === "ecode" ? "E-code" : "Physical"}`, "info");
      return;
    }
    setType(next);
    if (next === "physical") setEcode("");
  };

  const pickImage = async () => {
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    let status = perm.status;
    if (status !== "granted" && perm.canAskAgain) {
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") {
      toast.show("Photo access is needed to upload card images", "error");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, allowsMultipleSelection: true });
    if (res.canceled) return;
    try {
      toast.show("Uploading image…", "info");
      const uploaded: string[] = [];
      for (const asset of res.assets) uploaded.push(await uploadImage(asset.uri));
      setImages((prev) => [...prev, ...uploaded]);
      toast.show(uploaded.length > 1 ? "Images uploaded" : "Image uploaded", "success");
    } catch {
      toast.show("Upload failed, please retry", "error");
    }
  };

  const validateForReview = () => {
    if (!brand) {
      toast.show("Select a gift card category", "error");
      return false;
    }
    if (!supportedTypes(brand).includes(type)) {
      toast.show("That submission type is not available for this card", "error");
      return false;
    }
    if (brand.subcategories.length > 0 && !subcategory) {
      toast.show("Select the card type / sub-category", "error");
      return false;
    }
    if (availableCountries.length > 0 && !country) {
      toast.show("Select the card country / region", "error");
      return false;
    }
    const v = parseInt(value || "0", 10);
    if (!v) {
      toast.show("Enter the card value", "error");
      return false;
    }
    if (type === "physical" && images.length === 0) {
      toast.show("Upload at least one clear card image", "error");
      return false;
    }
    if (type === "ecode" && !ecode.trim()) {
      toast.show("Enter the e-code / card details", "error");
      return false;
    }
    if (!quote.data || quote.error || quote.isFetching) { toast.show("Wait for a current payout quote", "error"); return false; }
    return true;
  };

  const onContinue = () => {
    if (!validateForReview()) return;
    setReviewOpen(true);
  };

  const submitTrade = async () => {
    if (!validateForReview() || !brand) return;
    const v = parseInt(value, 10);
    setSubmitting(true);
    try {
      const trade = await api.post<{ id: string; order_id: string }>("/trades", {
        brand_id: brand.id,
        rate_version: quote.data!.rate_version,
        submission_type: type,
        subcategory,
        country,
        card_value_usd: v,
        quantity: qty,
        notes,
        ecode: type === "ecode" ? ecode.trim() : "",
        image_paths: images,
      });
      setReviewOpen(false);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["my-trades"] });
      toast.show("Trade submitted for review", "success");
      router.push(`/trade/${trade.id}`);
    } catch (e) {
      setReviewOpen(false);
      quote.refetch();
      toast.show(e instanceof ApiError ? e.message : "Could not submit trade", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const options = picker === "brand" ? (data?.brands ?? []).map((b) => b.name)
    : picker === "sub" ? (brand?.subcategories ?? [])
    : picker === "country" ? availableCountries : [];

  const onSelect = (val: string) => {
    if (picker === "brand") {
      const b = data?.brands.find((x) => x.name === val) || null;
      if (b?.id !== brand?.id) {
        setValue("");
        setQty(1);
        setNotes("");
        setEcode("");
        setImages([]);
      }
      setBrand(b);
      setSubcategory("");
      setCountry("");
      if (b) {
        const selectedTypes = supportedTypes(b);
        if (!selectedTypes.includes(type)) setType(selectedTypes[0] ?? "physical");
      }
    } else if (picker === "sub") setSubcategory(val);
    else if (picker === "country") setCountry(val);
    setPicker(null);
  };

  const SelectField = ({ icon, label, placeholder, valueText, onPress, testID }: any) => (
    <Pressable style={styles.field} onPress={onPress} testID={testID}>
      <View style={styles.fieldIcon}><Ionicons name={icon} size={20} color={colors.onSurface} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={[styles.fieldValue, !valueText && { color: colors.muted, fontWeight: "400" }]}>
          {valueText || placeholder || `Select ${label.toLowerCase()}`}
        </Text>
      </View>
      <Ionicons name="chevron-down" size={18} color={colors.onSurface} />
    </Pressable>
  );

  const ReviewRow = ({ label, valueText }: { label: string; valueText: string }) => (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewKey}>{label}</Text>
      <Text style={styles.reviewValue}>{valueText}</Text>
    </View>
  );

  return (
    <ScreenBackground>
      <AppHeader title="Trade" showBell />
      <KeyboardAwareScrollView
        showsVerticalScrollIndicator={false}
        bottomOffset={20}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md }}
      >
        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Sell your gift card</Text>
            <Text style={styles.heroSub}>Choose your card details and review your expected payout before submitting.</Text>
            <View style={styles.heroChecks}>
              <View style={styles.check}><Ionicons name="checkmark-circle" size={17} color={colors.success} /><Text style={styles.checkText}>Fast & secure</Text></View>
              <View style={styles.check}><Ionicons name="checkmark-circle" size={17} color={colors.success} /><Text style={styles.checkText}>Clear rates</Text></View>
            </View>
          </View>
          <Image source={require("../../assets/trade/trade-hero-art.jpg")} style={styles.heroArt} contentFit="cover" />
        </View>

        <View style={styles.typeToggle}>
          {(["physical", "ecode"] as const).map((t) => {
            const active = type === t;
            const available = typeAvailable(t);
            return (
              <Pressable
                key={t}
                disabled={!available}
                onPress={() => chooseType(t)}
                style={[styles.typeBtn, active && styles.typeBtnActive, !available && styles.typeBtnDisabled]}
                testID={`trade-type-${t}`}
              >
                <Ionicons name={t === "physical" ? "cube-outline" : "mail-outline"} size={20} color={active ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                <Text style={[styles.typeText, { color: active ? colors.onBrandPrimary : colors.onSurfaceSecondary }]}>{t === "physical" ? "Physical" : "E-code"}</Text>
              </Pressable>
            );
          })}
        </View>

        <SelectField icon="card-outline" label="Gift Card Category" placeholder="Select card category" valueText={brand?.name} onPress={() => setPicker("brand")} testID="trade-brand" />
        <SelectField icon="grid-outline" label="Sub-category" placeholder="Select sub-category" valueText={subcategory} onPress={() => brand ? setPicker("sub") : toast.show("Select a card first", "info")} testID="trade-sub" />
        <SelectField icon="globe-outline" label="Country" placeholder="Select country" valueText={country} onPress={() => brand ? setPicker("country") : toast.show("Select a card first", "info")} testID="trade-country" />

        <View style={styles.amountCard}>
          <View style={styles.amountTop}>
            <View style={styles.fieldIcon}><Ionicons name="card-outline" size={20} color={colors.onSurface} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Amount (Card Value)</Text>
              <TextInput
                style={styles.amountInput}
                placeholder="Enter amount"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                value={value}
                onChangeText={(t) => setValue(t.replace(/[^0-9]/g, ""))}
                testID="trade-amount"
              />
            </View>
          </View>
        </View>

        <View style={styles.field}>
          <View style={styles.fieldIcon}><Ionicons name="cube-outline" size={20} color={colors.onSurface} /></View>
          <Text style={[styles.fieldValue, { flex: 1 }]}>Quantity</Text>
          <View style={styles.stepper}>
            <Pressable onPress={() => setQty((q) => Math.max(1, q - 1))} style={styles.stepBtn} testID="trade-qty-minus"><Ionicons name="remove" size={18} color={colors.brandPrimary} /></Pressable>
            <Text style={styles.qtyText}>{qty}</Text>
            <Pressable onPress={() => setQty((q) => Math.min(100, q + 1))} style={styles.stepBtn} testID="trade-qty-plus"><Ionicons name="add" size={18} color={colors.brandPrimary} /></Pressable>
          </View>
        </View>

        <View style={styles.payoutCard}>
          <View style={styles.payoutMain}>
            <View style={styles.payoutIcon}><Ionicons name="wallet" size={24} color={colors.success} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.payoutLabel}>Estimated payout</Text>
              <Text style={styles.payoutValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{quote.isError ? "Quote unavailable" : quote.isFetching ? "Checking quote…" : quote.data ? formatNaira(payout) : "—"}</Text>
            </View>
          </View>
          <View style={styles.rateBox}>
            <Text style={styles.rateLabel}>Rate per unit</Text>
            <Text style={styles.rateValue}>{quote.isError ? "Could not load a matching rate" : quote.data ? formatNaira(quote.data.rate_minor_per_unit) : "Select the card details and value"}</Text>
          </View>
        </View>
        {quote.isError && <PrimaryButton title="Retry quote" variant="secondary" onPress={() => { void quote.refetch(); }} loading={quote.isRefetching} testID="trade-quote-retry" />}

        {type === "ecode" && (
          <View style={styles.field}>
            <View style={styles.fieldIcon}><Ionicons name="key-outline" size={20} color={colors.onSurface} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>E-code / Card details</Text>
              <TextInput
                style={styles.amountInput}
                placeholder="Enter code (kept private & secure)"
                placeholderTextColor={colors.muted}
                value={ecode}
                onChangeText={setEcode}
                autoCapitalize="characters"
                testID="trade-ecode"
              />
            </View>
          </View>
        )}

        <View style={styles.field}>
          <View style={styles.fieldIcon}><Ionicons name="chatbubble-outline" size={20} color={colors.onSurface} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Additional notes (optional)</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="E.g. card condition, receipt, etc."
              placeholderTextColor={colors.muted}
              value={notes}
              onChangeText={setNotes}
              testID="trade-notes"
            />
          </View>
        </View>

        <View style={styles.uploadCard}>
          <View style={styles.uploadHead}>
            <View style={styles.fieldIcon}><Ionicons name="image-outline" size={20} color={colors.onSurface} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>{type === "physical" ? "Upload Gift Card Image(s)" : "Supporting Image(s) (optional)"}</Text>
              <Text style={styles.fieldHint}>{type === "physical" ? "Clear photos help verify your card faster." : "Add screenshots or supporting proof only when useful."}</Text>
            </View>
            <Pressable style={styles.uploadBtn} onPress={pickImage} testID="trade-upload">
              <Ionicons name="cloud-upload-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.uploadBtnText}>Tap to upload</Text>
            </Pressable>
          </View>
          {images.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, marginTop: spacing.md }}>
              {images.map((p, i) => (
                <View key={`${p}-${i}`} style={styles.thumb}>
                  <Ionicons name="image" size={22} color={colors.brandPrimary} />
                  <Text style={styles.thumbText}>Image {i + 1}</Text>
                  <Pressable onPress={() => setImages((prev) => prev.filter((x) => x !== p))} style={styles.thumbX} accessibilityLabel={`Remove image ${i + 1}`}>
                    <Ionicons name="close-circle" size={18} color={colors.error} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        <PrimaryButton title="Continue" icon="arrow-forward" onPress={onContinue} testID="trade-continue" style={{ marginTop: spacing.sm }} />
      </KeyboardAwareScrollView>

      <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setPicker(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{picker === "brand" ? "Select Card" : picker === "sub" ? "Select Sub-category" : "Select Country"}</Text>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {options.length === 0 ? (
                <Text style={styles.noOptions}>No options available</Text>
              ) : options.map((opt) => (
                <Pressable key={opt} style={styles.optionRow} onPress={() => onSelect(opt)} testID={`option-${opt}`}>
                  {picker === "brand" && data?.brands.find((b) => b.name === opt) &&
                    <BrandIcon brand={data.brands.find((b) => b.name === opt)!} size={32} />}
                  <Text style={styles.optionText}>{opt}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {quote.error && <Text style={{padding:16,color:colors.error}}>{quote.error.message}</Text>}
      <Modal visible={reviewOpen} transparent animationType="slide" onRequestClose={() => !submitting && setReviewOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.reviewSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.reviewTitleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Review your trade</Text>
                <Text style={styles.reviewSub}>Confirm the details below before submitting for company review.</Text>
              </View>
              <Pressable disabled={submitting} onPress={() => setReviewOpen(false)} style={styles.closeBtn} testID="trade-review-close">
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 450 }} contentContainerStyle={{ paddingBottom: spacing.sm }}>
              <View style={styles.reviewBlock}>
                <ReviewRow label="Gift card" valueText={brand?.name ?? ""} />
                <ReviewRow label="Submission" valueText={type === "physical" ? "Physical" : "E-code"} />
                {!!subcategory && <ReviewRow label="Card type" valueText={subcategory} />}
                {!!country && <ReviewRow label="Country" valueText={country} />}
                <ReviewRow label="Card value" valueText={`$${value}`} />
                <ReviewRow label="Quantity" valueText={String(qty)} />
                <ReviewRow label="Rate per unit" valueText={quote.data ? formatNaira(quote.data.rate_minor_per_unit) : ""} />
                <ReviewRow label="Expected payout" valueText={formatNaira(payout)} />
                <ReviewRow label={type === "physical" ? "Card images" : "E-code"} valueText={type === "physical" ? `${images.length} uploaded` : "Entered securely"} />
                {type === "ecode" && images.length > 0 && <ReviewRow label="Supporting images" valueText={`${images.length} uploaded`} />}
              </View>
              <Text style={styles.reviewNotice}>Submitting sends this trade to Bring Gift Card for review. Your wallet is not credited until the trade is approved and credited.</Text>
            </ScrollView>

            <View style={styles.reviewActions}>
              <PrimaryButton title="Edit Details" variant="outline" onPress={() => setReviewOpen(false)} disabled={submitting} style={{ flex: 1 }} testID="trade-review-edit" />
              <PrimaryButton title="Submit Trade" onPress={submitTrade} loading={submitting} style={{ flex: 1 }} testID="trade-submit" />
            </View>
          </View>
        </View>
      </Modal>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  hero: { flexDirection: "row", alignItems: "center", backgroundColor: "#DCEBFF", borderRadius: radius.xl, minHeight: 160, paddingLeft: spacing.xl, overflow: "hidden", marginTop: spacing.xs },
  heroCopy: { flex: 1, zIndex: 2, paddingVertical: spacing.lg },
  heroArt: { width: 150, height: 112, marginRight: -2, alignSelf: "center" },
  heroTitle: { fontSize: 24, fontWeight: "800", color: colors.onSurface },
  heroSub: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 6, lineHeight: 19 },
  heroChecks: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.md, flexWrap: "wrap" },
  check: { flexDirection: "row", alignItems: "center", gap: 5 },
  checkText: { fontSize: 12, color: colors.onSurfaceSecondary, fontWeight: "600" },
  typeToggle: { flexDirection: "row", gap: spacing.sm },
  typeBtn: { flex: 1, minHeight: 58, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "center" },
  typeBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  typeBtnDisabled: { opacity: 0.4 },
  typeText: { fontWeight: "700", fontSize: 15 },
  field: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, minHeight: 76, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  fieldIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  fieldLabel: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  fieldValue: { fontSize: 14, fontWeight: "600", color: colors.onSurface, marginTop: 4 },
  fieldHint: { color: colors.muted, fontSize: 12, marginTop: 3, lineHeight: 17 },
  amountCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md, gap: spacing.md },
  amountTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  amountInput: { fontSize: 14, color: colors.onSurface, paddingVertical: 4, marginTop: 1 },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  stepBtn: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  qtyText: { minWidth: 24, textAlign: "center", fontWeight: "800", color: colors.onSurface, fontSize: 16 },
  payoutCard: { gap: spacing.md, backgroundColor: colors.successBg, borderRadius: radius.xl, padding: spacing.lg },
  payoutMain: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  payoutIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(21,163,74,0.12)", alignItems: "center", justifyContent: "center" },
  payoutLabel: { color: colors.onSurfaceSecondary, fontSize: 13 },
  payoutValue: { color: colors.success, fontSize: 26, fontWeight: "800", marginTop: 2 },
  rateBox: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: "rgba(15,31,68,0.12)", alignItems: "flex-start" },
  rateLabel: { color: colors.onSurfaceSecondary, fontSize: 12 },
  rateValue: { color: colors.onSurface, fontWeight: "700", fontSize: 13, marginTop: 3 },
  uploadCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md },
  uploadHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  uploadBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.brandPrimary, borderRadius: radius.lg, paddingHorizontal: spacing.md, height: 46 },
  uploadBtnText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 12 },
  thumb: { width: 90, height: 68, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", gap: 2 },
  thumbText: { fontSize: 11, color: colors.onSurfaceSecondary },
  thumbX: { position: "absolute", top: 2, right: 2 },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xxxl },
  reviewSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xxl, maxHeight: "88%" },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: 19, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.sm },
  noOptions: { color: colors.muted, padding: spacing.lg },
  optionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  optionText: { fontSize: 15, fontWeight: "600", color: colors.onSurface },
  reviewTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  reviewSub: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: -3, marginBottom: spacing.md },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  reviewBlock: { borderRadius: radius.xl, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  reviewRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.lg, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  reviewKey: { color: colors.muted, fontSize: 13 },
  reviewValue: { flex: 1, color: colors.onSurface, fontWeight: "700", fontSize: 13, textAlign: "right" },
  reviewNotice: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  reviewActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
}));

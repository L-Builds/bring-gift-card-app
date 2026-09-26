import React, { useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, ScrollView, Modal, TextInput, Image } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { AppHeader } from "@/src/components/app-header";
import { ScreenBackground, StatusBadge, LoadingView, EmptyState, PrimaryButton } from "@/src/components/ui";
import { useAuth } from "@/src/context/auth";
import { api } from "@/src/api/client";
import { formatNaira, formatDate } from "@/src/lib/format";

type Txn = {
  id: string; kind: string; title: string; subtitle: string; amount_kobo: number;
  signed: number; status: string; ref: string; color: string; date: string; icon: string;
};

const CHIPS = [
  { key: "all", label: "All" },
  { key: "sales", label: "Sales" },
  { key: "withdrawals", label: "Withdrawals" },
];

const ICON: Record<string, any> = { card: "card", bank: "business", gift: "gift", refund: "refresh" };
const BRAND_ART: Record<string, any> = {
  "apple/itunes": require("../../assets/home/brands/apple-itunes.png"),
  "apple itunes": require("../../assets/home/brands/apple-itunes.png"),
  amazon: require("../../assets/home/brands/amazon.png"),
  "google play": require("../../assets/home/brands/google-play.png"),
  steam: require("../../assets/home/brands/steam.png"),
  playstation: require("../../assets/home/brands/playstation.png"),
  xbox: require("../../assets/home/brands/xbox.png"),
  "razer gold": require("../../assets/home/brands/razer-gold.png"),
  nike: require("../../assets/home/brands/nike.png"),
};

function brandArt(title: string) {
  const key = title.trim().toLowerCase();
  return BRAND_ART[key] ?? null;
}

function parseDateStart(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateEnd(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function Transactions() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { isGuest } = useAuth();
  const router = useRouter();
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [tmpStatus, setTmpStatus] = useState("");
  const [tmpType, setTmpType] = useState("all");
  const [tmpStartDate, setTmpStartDate] = useState("");
  const [tmpEndDate, setTmpEndDate] = useState("");
  const [tmpMinAmount, setTmpMinAmount] = useState("");
  const [tmpMaxAmount, setTmpMaxAmount] = useState("");

  const params = new URLSearchParams({ type });
  if (status) params.set("status", status);

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", type, status],
    queryFn: () => api.get<{ transactions: Txn[] }>(`/transactions?${params.toString()}`),
    enabled: !isGuest,
  });

  const filteredTransactions = useMemo(() => {
    const start = startDate ? parseDateStart(startDate) : null;
    const end = endDate ? parseDateEnd(endDate) : null;
    const minKobo = minAmount ? Number(minAmount) * 100 : null;
    const maxKobo = maxAmount ? Number(maxAmount) * 100 : null;

    return (data?.transactions ?? []).filter((item) => {
      const when = new Date(item.date);
      if (start && when < start) return false;
      if (end && when > end) return false;
      if (minKobo !== null && Number.isFinite(minKobo) && item.amount_kobo < minKobo) return false;
      if (maxKobo !== null && Number.isFinite(maxKobo) && item.amount_kobo > maxKobo) return false;
      return true;
    });
  }, [data?.transactions, startDate, endDate, minAmount, maxAmount]);

  if (isGuest) return <Redirect href="/(auth)/login" />;

  const openFilter = () => {
    setTmpStatus(status);
    setTmpType(type);
    setTmpStartDate(startDate);
    setTmpEndDate(endDate);
    setTmpMinAmount(minAmount);
    setTmpMaxAmount(maxAmount);
    setShowFilter(true);
  };

  const applyFilter = () => {
    setType(tmpType);
    setStatus(tmpStatus);
    setStartDate(tmpStartDate.trim());
    setEndDate(tmpEndDate.trim());
    setMinAmount(tmpMinAmount.trim());
    setMaxAmount(tmpMaxAmount.trim());
    setShowFilter(false);
  };

  const resetFilter = () => {
    setTmpType("all");
    setTmpStatus("");
    setTmpStartDate("");
    setTmpEndDate("");
    setTmpMinAmount("");
    setTmpMaxAmount("");
  };

  return (
    <ScreenBackground>
      <AppHeader title="Transactions" showBell />

      <View style={styles.filterBar}>
        <Text style={styles.filterByLabel}>Filter by:</Text>
        <Pressable style={styles.filterPill} onPress={openFilter} testID="txn-filter-summary">
          <Text style={styles.filterPillText}>{type === "all" ? "All Transactions" : CHIPS.find((c) => c.key === type)?.label}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.onSurface} />
        </Pressable>
        <Pressable style={styles.funnel} onPress={openFilter} testID="txn-filter">
          <Ionicons name="funnel-outline" size={22} color={colors.brandPrimary} />
        </Pressable>
      </View>

      <View style={styles.chipRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowContent}>
          {CHIPS.map((c) => {
            const active = c.key === type;
            return (
              <Pressable key={c.key} onPress={() => setType(c.key)} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]} testID={`txn-chip-${c.key}`}>
                <Text style={[styles.chipText, { color: active ? colors.onBrandPrimary : colors.onSurface }]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <LoadingView />
      ) : (
        <FlatList
          data={filteredTransactions}
          keyExtractor={(t) => t.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md, paddingTop: spacing.xs }}
          ListEmptyComponent={<EmptyState icon="receipt-outline" title="No transactions yet" subtitle="Your trades, withdrawals and refunds will show up here." />}
          renderItem={({ item }) => {
            const receipt = (item.kind === "sale" && item.status === "Completed") || (item.kind === "withdrawal" && item.status === "Completed");
            const art = item.kind === "sale" ? brandArt(item.title) : null;
            const open = () => {
              if (item.kind === "sale") router.push(`/trade/${item.id}`);
              else if (item.kind === "withdrawal" && receipt) router.push(`/receipt?kind=withdrawal&id=${item.id}`);
              else if (item.kind === "withdrawal") router.push("/wallet");
            };
            const metaPrefix = item.kind === "sale" ? "Order ID" : "Ref";
            return (
              <Pressable style={styles.txnCard} onPress={item.kind === "refund" ? undefined : open} testID={`txn-${item.id}`}>
                <View style={[styles.txnIcon, { backgroundColor: item.color + "16" }]}>
                  {art ? <Image source={art} style={styles.brandImage} resizeMode="contain" /> : <Ionicons name={ICON[item.icon] || "card"} size={24} color={item.color} />}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.txnTitle}>{item.title}</Text>
                  <Text style={styles.txnSub} numberOfLines={1}>{item.subtitle}</Text>
                  <Text style={styles.txnMeta}>{formatDate(item.date)}  •  {metaPrefix}: {item.ref}</Text>
                </View>
                <View style={styles.amountWrap}>
                  <Text style={[styles.txnAmount, item.signed < 0 && { color: colors.onSurface }]}>
                    {item.signed < 0 ? "-" : ""}{formatNaira(item.amount_kobo)}
                  </Text>
                  <View style={styles.statusRow}>
                    {receipt && <Ionicons name="receipt-outline" size={13} color={colors.success} testID={`txn-receipt-${item.id}`} />}
                    <StatusBadge status={item.status} />
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <Modal visible={showFilter} transparent animationType="slide" onRequestClose={() => setShowFilter(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowFilter(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Filter</Text>
              <Pressable onPress={() => setShowFilter(false)}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
              <Text style={styles.groupLabel}>Transaction type</Text>
              <View style={styles.wrapRow}>
                {CHIPS.map((c) => (
                  <Pressable key={c.key} onPress={() => setTmpType(c.key)} style={[styles.filterChip, tmpType === c.key ? styles.chipActive : styles.chipIdle]}>
                    <Text style={[styles.chipText, { color: tmpType === c.key ? colors.onBrandPrimary : colors.onSurface }]}>{c.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.groupLabel}>Status</Text>
              <View style={styles.wrapRow}>
                {["Completed", "Pending", "Failed"].map((s) => (
                  <Pressable key={s} onPress={() => setTmpStatus(tmpStatus === s ? "" : s)} style={[styles.filterChip, tmpStatus === s ? styles.chipActive : styles.chipIdle]}>
                    <Text style={[styles.chipText, { color: tmpStatus === s ? colors.onBrandPrimary : colors.onSurface }]}>{s}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.groupLabel}>Date range</Text>
              <View style={styles.rangeRow}>
                <View style={styles.inputBox}>
                  <Ionicons name="calendar-outline" size={20} color={colors.muted} />
                  <TextInput style={styles.rangeInput} placeholder="Start date" placeholderTextColor={colors.muted} value={tmpStartDate} onChangeText={setTmpStartDate} autoCapitalize="none" testID="txn-filter-start-date" />
                </View>
                <Text style={styles.rangeDash}>-</Text>
                <View style={styles.inputBox}>
                  <Ionicons name="calendar-outline" size={20} color={colors.muted} />
                  <TextInput style={styles.rangeInput} placeholder="End date" placeholderTextColor={colors.muted} value={tmpEndDate} onChangeText={setTmpEndDate} autoCapitalize="none" testID="txn-filter-end-date" />
                </View>
              </View>
              <Text style={styles.dateHint}>Use YYYY-MM-DD</Text>

              <Text style={styles.groupLabel}>Amount range</Text>
              <View style={styles.rangeRow}>
                <View style={styles.inputBox}>
                  <Text style={styles.currencyMark}>₦</Text>
                  <TextInput style={styles.rangeInput} placeholder="Min amount" placeholderTextColor={colors.muted} value={tmpMinAmount} onChangeText={(v) => setTmpMinAmount(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" testID="txn-filter-min" />
                </View>
                <Text style={styles.rangeDash}>-</Text>
                <View style={styles.inputBox}>
                  <Text style={styles.currencyMark}>₦</Text>
                  <TextInput style={styles.rangeInput} placeholder="Max amount" placeholderTextColor={colors.muted} value={tmpMaxAmount} onChangeText={(v) => setTmpMaxAmount(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" testID="txn-filter-max" />
                </View>
              </View>
            </ScrollView>

            <View style={styles.sheetBtns}>
              <PrimaryButton title="Reset" variant="outline" onPress={resetFilter} style={{ flex: 1 }} testID="txn-filter-reset" />
              <PrimaryButton title="Apply Filter" onPress={applyFilter} style={{ flex: 1 }} testID="txn-filter-apply" />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  filterBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, gap: spacing.sm },
  filterByLabel: { color: colors.muted, fontSize: 14 },
  filterPill: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, height: 44, flex: 1, justifyContent: "space-between" },
  filterPillText: { fontWeight: "700", color: colors.onSurface, fontSize: 14 },
  funnel: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  chipRowWrap: { height: 64, justifyContent: "center" },
  chipRowContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center" },
  chip: { height: 40, minWidth: 92, borderRadius: radius.md, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  filterChip: { height: 44, minWidth: 92, borderRadius: radius.md, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipIdle: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 14, fontWeight: "700" },
  txnCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md, shadowColor: colors.shadow, shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  txnIcon: { width: 54, height: 54, borderRadius: 15, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  brandImage: { width: 42, height: 42 },
  txnTitle: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  txnSub: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 1 },
  txnMeta: { fontSize: 11, color: colors.muted, marginTop: 3 },
  amountWrap: { alignItems: "flex-end", gap: 7, maxWidth: 126 },
  txnAmount: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxxl, maxHeight: "88%" },
  sheetHandle: { width: 48, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.md },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  sheetTitle: { fontSize: 22, fontWeight: "800", color: colors.onSurface },
  sheetScroll: { paddingBottom: spacing.lg },
  groupLabel: { fontSize: 15, fontWeight: "800", color: colors.onSurface, marginTop: spacing.lg, marginBottom: spacing.sm },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  rangeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  inputBox: { flex: 1, height: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface },
  rangeInput: { flex: 1, color: colors.onSurface, fontSize: 14, padding: 0 },
  rangeDash: { color: colors.muted, fontSize: 18 },
  currencyMark: { color: colors.muted, fontSize: 18, fontWeight: "700" },
  dateHint: { color: colors.muted, fontSize: 11, marginTop: 6 },
  sheetBtns: { flexDirection: "row", gap: spacing.md, paddingTop: spacing.md },
}));

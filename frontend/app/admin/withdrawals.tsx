import { Action } from "@/src/components/admin-form";
import React, { useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, ScrollView, Modal, TextInput, KeyboardAvoidingView, Platform, useWindowDimensions } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, LoadingView, EmptyState, PrimaryButton, QueryErrorView } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { api, ApiError } from "@/src/api/client";
import { formatMoney, formatDateTime } from "@/src/lib/format";

type WD = {
  currency?: string; minor_digits?: number; provider_id?: string; provider_status?: string;
  id: string; ref: string; amount_kobo: number; status: string; customer_name: string;
  narration: string; created_at: string;
  destination: { provider_name: string; account_number: string; account_name: string };
};
const FILTERS = [
  { key: "PENDING", label: "Pending" },
  { key: "PROCESSING", label: "Processing" },
  { key: "PAID", label: "Paid" },
  { key: "REJECTED", label: "Rejected" },
  { key: "all", label: "All" },
] as const;
const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "amount", label: "Highest" },
] as const;

export default function AdminWithdrawals() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const desktop = width >= 1180;
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("PENDING");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "amount">("newest");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [paidItem, setPaidItem] = useState<WD | null>(null);
  const [externalRef, setExternalRef] = useState("");
  const [dispatchItem, setDispatchItem] = useState<WD | null>(null);
  const providers = useQuery({ queryKey: ["payout-providers"], queryFn: () => api.get<{ providers: { id: string; label: string; enabled: boolean; available: boolean }[] }>("/admin/payout-providers") });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ["admin-withdrawals", filter],
    queryFn: () => api.get<{ withdrawals: WD[] }>(`/admin/withdrawals?status=${filter}`)
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = (data?.withdrawals ?? []).filter((item) => !term || [
      item.ref, item.customer_name, item.destination.provider_name, item.destination.account_number,
      item.destination.account_name, item.narration,
    ].some((value) => (value || "").toLowerCase().includes(term)));
    return [...filtered].sort((a, b) => {
      if (sort === "amount") return b.amount_kobo - a.amount_kobo;
      const delta = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return sort === "newest" ? delta : -delta;
    });
  }, [data?.withdrawals, q, sort]);

  const act = async (id: string, path: string, msg: string, body?: any) => {
    setBusy(true);
    try {
      await api.post(`/admin/withdrawals/${id}/${path}`, body);
      setDispatchItem(null);
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      toast.show(msg, "success");
      refetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Action failed", "error");
    } finally { setBusy(false); }
  };

  const doReject = async () => {
    if (!reason.trim()) return toast.show("Enter a reason", "error");
    setBusy(true);
    try {
      await api.post(`/admin/withdrawals/${rejectId}/reject`, { reason });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      toast.show("Withdrawal rejected & funds returned", "success");
      setRejectId(null);
      setReason("");
      refetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const confirmPaid = async () => {
    if (!paidItem) return;
    if (externalRef.trim().length < 3) return toast.show("Enter the real payment reference", "error");
    setBusy(true);
    try {
      await api.post(`/admin/withdrawals/${paidItem.id}/paid`, { external_reference: externalRef.trim() });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      toast.show("Withdrawal marked as paid", "success");
      setPaidItem(null);
      refetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const renderActions = (item: WD, compact = false) => {
    if (!["PENDING", "PROCESSING"].includes(item.status)) return <Text style={styles.noAction}>—</Text>;
    return (
      <View style={[styles.actions, compact && styles.actionsCompact]}>
        {item.status === "PENDING" && (
          <Pressable style={[styles.act, styles.actInfo]} disabled={busy} onPress={() => setDispatchItem(item)} testID={`wd-process-${item.id}`}>
            <Text style={[styles.actText, { color: colors.info }]}>Process</Text>
          </Pressable>
        )}
        {(!item.provider_id || item.provider_id === "manual") ? <>
          <Pressable disabled={busy} style={[styles.act, styles.actSuccess]} onPress={() => { setPaidItem(item); setExternalRef(""); }} testID={`wd-paid-${item.id}`}>
            <Text style={[styles.actText, { color: colors.success }]}>Mark Paid</Text>
          </Pressable>
          <Pressable disabled={busy} style={[styles.act, styles.actDanger]} onPress={() => setRejectId(item.id)} testID={`wd-reject-${item.id}`}>
            <Text style={[styles.actText, { color: colors.error }]}>Reject</Text>
          </Pressable>
        </> : (
          <Pressable disabled={busy} style={[styles.act, styles.actNeutral]} onPress={() => act(item.id, "reconcile", "Provider status refreshed")} testID={`wd-reconcile-${item.id}`}>
            <Text style={[styles.actText, { color: colors.onSurfaceSecondary }]}>Reconcile</Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <ScreenBackground>
      <StackHeader title="Withdrawals" />
      <View style={styles.manualNote}>
        <Ionicons name="information-circle" size={18} color={colors.brandPrimary} />
        <Text style={styles.manualNoteText}>Select a payout provider when processing. Company payouts need the real payment reference. Provider transfers require verified settlement.</Text>
      </View>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search" size={19} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search reference, customer or payout account"
            placeholderTextColor={colors.muted}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            testID="admin-withdrawal-search"
          />
          {!!q && <Pressable onPress={() => setQ("")} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable>}
        </View>
        <View style={styles.sortGroup}>
          {SORTS.map((option) => {
            const active = sort === option.key;
            return (
              <Pressable key={option.key} onPress={() => setSort(option.key)} style={[styles.sortButton, active && styles.sortButtonActive]} testID={`admin-wd-sort-${option.key}`}>
                <Text style={[styles.sortText, active && styles.sortTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.chipRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowContent}>
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]} testID={`admin-wd-filter-${f.key}`}>
                <Text style={[styles.chipText, { color: active ? colors.onBrandPrimary : colors.onSurface }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <LoadingView />
      ) : isError || !data ? (
        <QueryErrorView title="Withdrawals unavailable" onRetry={() => { void refetch(); }} retrying={isRefetching} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(w) => w.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, { gap: desktop ? 0 : spacing.md }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="cash-outline" title={q ? "No matching withdrawals" : "No withdrawals"} subtitle={q ? "Try a different reference, customer or payout account." : "No requests in this status."} />}
          ListHeaderComponent={desktop && rows.length > 0 ? <View style={styles.tableHead}>
            <Text style={[styles.tableHeading, { flex: 1.05 }]}>Reference</Text>
            <Text style={[styles.tableHeading, { flex: 1.15 }]}>Customer</Text>
            <Text style={[styles.tableHeading, { flex: 0.95 }]}>Amount</Text>
            <Text style={[styles.tableHeading, { flex: 1.75 }]}>Destination</Text>
            <Text style={[styles.tableHeading, { flex: 1.15 }]}>Submitted</Text>
            <Text style={[styles.tableHeading, { flex: 0.9 }]}>Status</Text>
            <Text style={[styles.tableHeading, { width: 250 }]}>Actions</Text>
          </View> : null}
          renderItem={({ item }) => desktop ? (
            <View style={styles.tableRow} testID={`admin-wd-${item.id}`}>
              <View style={{ flex: 1.05 }}><Text style={styles.tablePrimary} numberOfLines={1}>{item.ref}</Text><Text style={styles.tableSecondary} numberOfLines={1}>{item.provider_status || item.provider_id || "Company payout"}</Text></View>
              <Text style={[styles.tablePrimary, { flex: 1.15 }]} numberOfLines={1}>{item.customer_name || "Customer"}</Text>
              <Text style={[styles.tablePrimary, styles.amountStrong, { flex: 0.95 }]} numberOfLines={1}>{formatMoney(item.amount_kobo, item.currency || "NGN", item.minor_digits ?? 2)}</Text>
              <View style={{ flex: 1.75 }}><Text style={styles.tablePrimary} numberOfLines={1}>{item.destination.account_name}</Text><Text style={styles.tableSecondary} numberOfLines={1}>{item.destination.provider_name} • {item.destination.account_number}</Text></View>
              <Text style={[styles.tablePrimary, { flex: 1.15 }]} numberOfLines={1}>{formatDateTime(item.created_at)}</Text>
              <View style={{ flex: 0.9, alignItems: "flex-start" }}><StatusBadge status={item.status} /></View>
              <View style={{ width: 250 }}>{renderActions(item, true)}</View>
            </View>
          ) : (
            <View style={styles.card} testID={`admin-wd-${item.id}`}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.amount}>{formatMoney(item.amount_kobo, item.currency || "NGN", item.minor_digits ?? 2)}</Text>
                  <Text style={styles.meta}>{item.customer_name} • {item.ref}</Text>
                </View>
                <StatusBadge status={item.status} />
              </View>
              <View style={styles.dest}>
                <Ionicons name="business" size={16} color={colors.brandPrimary} />
                <Text style={styles.destText}>{item.destination.provider_name} • {item.destination.account_number} • {item.destination.account_name}</Text>
              </View>
              <Text style={styles.date}>{formatDateTime(item.created_at)}</Text>
              {renderActions(item)}
            </View>
          )}
        />
      )}

      <Modal visible={dispatchItem !== null} transparent animationType="slide" onRequestClose={() => setDispatchItem(null)}>
        <View style={styles.overlay}><View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Choose payout provider</Text>
          <Text style={styles.sheetSub}>This starts the payout. Review the amount and destination before proceeding.</Text>
          {providers.data?.providers.filter((p) => p.enabled && p.available).map((p) => <Action key={p.id} title={`Process with ${p.label}`} disabled={busy} onPress={() => act(dispatchItem!.id, "dispatch", "Payout processing started", { provider_id: p.id })} />)}
          <Action title="Cancel" onPress={() => setDispatchItem(null)} />
        </View></View>
      </Modal>

      <Modal visible={paidItem !== null} transparent animationType="slide" onRequestClose={() => setPaidItem(null)}>
        <KeyboardAvoidingView
          style={styles.modalKeyboard}
          behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
        >
          <Pressable style={styles.overlay} onPress={() => setPaidItem(null)}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Confirm company payout</Text>
              <Text style={styles.sheetSub}>Only continue if the company has actually sent this payout outside the app.</Text>
              {paidItem && (
                <View style={styles.confirmBox}>
                  <Text style={styles.confirmAmount}>{formatMoney(paidItem.amount_kobo, paidItem.currency || "NGN", paidItem.minor_digits ?? 2)}</Text>
                  <Text style={styles.confirmDest}>{paidItem.destination.provider_name} • {paidItem.destination.account_number} • {paidItem.destination.account_name}</Text>
                </View>
              )}
              <TextInput style={styles.reasonInput} placeholder="Actual company payment reference" placeholderTextColor={colors.muted} value={externalRef} onChangeText={setExternalRef} testID="admin-withdrawal-payment-reference" />
              <PrimaryButton title="Confirm Paid" onPress={confirmPaid} loading={busy} testID="wd-paid-confirm" style={{ marginTop: spacing.md }} />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={rejectId !== null} transparent animationType="slide" onRequestClose={() => setRejectId(null)}>
        <KeyboardAvoidingView
          style={styles.modalKeyboard}
          behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
        >
          <Pressable style={styles.overlay} onPress={() => setRejectId(null)}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Reject withdrawal</Text>
              <Text style={styles.sheetSub}>Funds will be returned to the customer&apos;s balance.</Text>
              <TextInput style={styles.reasonInput} placeholder="Reason" placeholderTextColor={colors.muted} value={reason} onChangeText={setReason} multiline testID="wd-reject-reason" />
              <PrimaryButton title="Confirm Reject" onPress={doReject} loading={busy} testID="wd-reject-submit" style={{ marginTop: spacing.md }} />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  manualNote: { maxWidth: 1288, alignSelf: "center", marginHorizontal: spacing.lg, flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginBottom: spacing.xs, backgroundColor: colors.brandSecondary, borderRadius: radius.md, padding: spacing.md },
  manualNoteText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  toolbar: { width: "100%", maxWidth: 1320, alignSelf: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  search: { minWidth: 280, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, height: 44 },
  searchInput: { flex: 1, fontSize: 14, color: colors.onSurface },
  sortGroup: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 3, gap: 2 },
  sortButton: { height: 34, minWidth: 68, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  sortButtonActive: { backgroundColor: colors.brandSecondary },
  sortText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  sortTextActive: { color: colors.brandPrimary },
  chipRowWrap: { minHeight: 52, justifyContent: "center" },
  chipRowContent: { width: "100%", maxWidth: 1320, paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center", alignSelf: "center" },
  chip: { height: 34, borderRadius: radius.pill, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipIdle: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 13, fontWeight: "700" },
  listContent: { width: "100%", maxWidth: 1320, alignSelf: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, paddingTop: spacing.xs },
  confirmBox: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, padding: spacing.md, gap: 4 },
  confirmAmount: { color: colors.onSurface, fontWeight: "800", fontSize: 20 },
  confirmDest: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "center" },
  amount: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
  meta: { color: colors.muted, fontSize: 12, marginTop: 1 },
  dest: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.sm },
  destText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 12 },
  date: { color: colors.muted, fontSize: 11 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.xs },
  actionsCompact: { marginTop: 0, flexWrap: "nowrap" },
  act: { minWidth: 68, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  actInfo: { backgroundColor: colors.infoBg },
  actSuccess: { backgroundColor: colors.successBg },
  actDanger: { backgroundColor: colors.errorBg },
  actNeutral: { backgroundColor: colors.surfaceTertiary },
  actText: { fontWeight: "800", fontSize: 11 },
  noAction: { color: colors.muted, fontSize: 12 },
  tableHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  tableHeading: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  tableRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 66, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  tablePrimary: { color: colors.onSurface, fontSize: 12, fontWeight: "700" },
  tableSecondary: { color: colors.muted, fontSize: 10, marginTop: 3 },
  amountStrong: { color: colors.brandDeep },
  modalKeyboard: { flex: 1 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xxxl },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  sheetSub: { color: colors.muted, fontSize: 13, marginTop: 4, marginBottom: spacing.md },
  reasonInput: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, padding: spacing.md, fontSize: 15, color: colors.onSurface, minHeight: 60 },
}));

import { Action } from "@/src/components/admin-form";
import React, { useState } from "react";
import { View, Text, Pressable, FlatList, ScrollView, Modal, TextInput } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, LoadingView, EmptyState, PrimaryButton } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { api, ApiError } from "@/src/api/client";
import { formatNaira, formatMoney, formatDate } from "@/src/lib/format";

type WD = {
  currency?:string; minor_digits?:number; provider_id?:string; provider_status?:string;
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
];

export default function AdminWithdrawals() {
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("PENDING");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [paidItem, setPaidItem] = useState<WD | null>(null);
  const [externalRef,setExternalRef]=useState("");
  const [dispatchItem,setDispatchItem]=useState<WD|null>(null);
  const providers=useQuery({queryKey:["payout-providers"],queryFn:()=>api.get<{providers:{id:string;label:string;enabled:boolean;available:boolean}[]}>("/admin/payout-providers")});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-withdrawals", filter],
    queryFn: () => api.get<{ withdrawals: WD[] }>(`/admin/withdrawals?status=${filter}`),
  });

  const act = async (id: string, path: string, msg: string, body?:any) => {
    setBusy(true);
    try {
      await api.post(`/admin/withdrawals/${id}/${path}`,body);
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
    if (externalRef.trim().length<3) return toast.show("Enter the real payment reference","error");
    setBusy(true);
    try {
      await api.post(`/admin/withdrawals/${paidItem.id}/paid`,{external_reference:externalRef.trim()});
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

  return (
    <ScreenBackground>
      <StackHeader title="Withdrawals" />
      <View style={styles.manualNote}>
        <Ionicons name="information-circle" size={18} color={colors.brandPrimary} />
        <Text style={styles.manualNoteText}>Select a payout provider when processing. Company payouts need the real payment reference. Provider transfers require verified settlement.</Text>
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
      ) : (
        <FlatList
          data={data?.withdrawals ?? []}
          keyExtractor={(w) => w.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md, paddingTop: spacing.xs }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="cash-outline" title="No withdrawals" subtitle="No requests in this status." />}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`admin-wd-${item.id}`}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.amount}>{formatMoney(item.amount_kobo,item.currency||"NGN",item.minor_digits??2)}</Text>
                  <Text style={styles.meta}>{item.customer_name} • {item.ref}</Text>
                </View>
                <StatusBadge status={item.status} />
              </View>
              <View style={styles.dest}>
                <Ionicons name="business" size={16} color={colors.brandPrimary} />
                <Text style={styles.destText}>{item.destination.provider_name} • {item.destination.account_number} • {item.destination.account_name}</Text>
              </View>
              <Text style={styles.date}>{formatDate(item.created_at)}</Text>

              {["PENDING", "PROCESSING"].includes(item.status) && (
                <View style={styles.actions}>
                  {item.status === "PENDING" && (
                    <Pressable style={[styles.act, { backgroundColor: colors.infoBg }]} disabled={busy} onPress={() => setDispatchItem(item)} testID={`wd-process-${item.id}`}>
                      <Text style={[styles.actText, { color: colors.info }]}>Process</Text>
                    </Pressable>
                  )}
                  {(!item.provider_id || item.provider_id === "manual") ? <>
                    <Pressable disabled={busy} style={[styles.act,{backgroundColor:colors.successBg}]} onPress={()=>{setPaidItem(item);setExternalRef("");}}><Text>Mark Paid</Text></Pressable>
                    <Pressable disabled={busy} style={[styles.act,{backgroundColor:colors.errorBg}]} onPress={()=>setRejectId(item.id)}><Text>Reject</Text></Pressable>
                  </> : <Pressable disabled={busy} style={styles.act} onPress={()=>act(item.id,"reconcile","Provider status refreshed")}><Text>Reconcile</Text></Pressable>}
                </View>
              )}
            </View>
          )}
        />
      )}

      <Modal visible={dispatchItem!==null} transparent animationType="slide" onRequestClose={()=>setDispatchItem(null)}><View style={styles.overlay}><View style={styles.sheet}><Text style={styles.sheetTitle}>Choose payout provider</Text><Text style={styles.sheetSub}>This starts the payout. Review the amount and destination before proceeding.</Text>{providers.data?.providers.filter(p=>p.enabled&&p.available).map(p=><Action key={p.id} title={`Process with ${p.label}`} disabled={busy} onPress={()=>act(dispatchItem!.id,"dispatch","Payout processing started",{provider_id:p.id})}/>)}<Action title="Cancel" onPress={()=>setDispatchItem(null)}/></View></View></Modal>
      <Modal visible={paidItem !== null} transparent animationType="slide" onRequestClose={() => setPaidItem(null)}>
        <Pressable style={styles.overlay} onPress={() => setPaidItem(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Confirm company payout</Text>
            <Text style={styles.sheetSub}>Only continue if the company has actually sent this payout outside the app.</Text>
            {paidItem && (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmAmount}>{formatMoney(paidItem.amount_kobo,paidItem.currency||"NGN",paidItem.minor_digits??2)}</Text>
                <Text style={styles.confirmDest}>{paidItem.destination.provider_name} • {paidItem.destination.account_number} • {paidItem.destination.account_name}</Text>
              </View>
            )}
            <TextInput style={styles.reasonInput} placeholder="Actual company payment reference" value={externalRef} onChangeText={setExternalRef} />
            <PrimaryButton title="Confirm Paid" onPress={confirmPaid} loading={busy} testID="wd-paid-confirm" style={{ marginTop: spacing.md }} />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={rejectId !== null} transparent animationType="slide" onRequestClose={() => setRejectId(null)}>
        <Pressable style={styles.overlay} onPress={() => setRejectId(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Reject withdrawal</Text>
            <Text style={styles.sheetSub}>Funds will be returned to the customer&apos;s balance.</Text>
            <TextInput style={styles.reasonInput} placeholder="Reason" placeholderTextColor={colors.muted} value={reason} onChangeText={setReason} multiline testID="wd-reject-reason" />
            <PrimaryButton title="Confirm Reject" onPress={doReject} loading={busy} testID="wd-reject-submit" style={{ marginTop: spacing.md }} />
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  manualNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.xs, backgroundColor: colors.brandSecondary, borderRadius: radius.lg, padding: spacing.md },
  manualNoteText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  confirmBox: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, padding: spacing.md, gap: 4 },
  confirmAmount: { color: colors.onSurface, fontWeight: "800", fontSize: 20 },
  confirmDest: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17 },
  chipRowWrap: { height: 56, justifyContent: "center" },
  chipRowContent: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center" },
  chip: { height: 36, borderRadius: radius.pill, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipIdle: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 14, fontWeight: "700" },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "center" },
  amount: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
  meta: { color: colors.muted, fontSize: 12, marginTop: 1 },
  dest: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.sm },
  destText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 12 },
  date: { color: colors.muted, fontSize: 11 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  act: { flex: 1, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  actText: { fontWeight: "800", fontSize: 13 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xxxl },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  sheetSub: { color: colors.muted, fontSize: 13, marginTop: 4, marginBottom: spacing.md },
  reasonInput: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, padding: spacing.md, fontSize: 15, color: colors.onSurface, minHeight: 60 },
}));

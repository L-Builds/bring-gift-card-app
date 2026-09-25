import React, { useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable, Modal } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, BrandMonogram, PrimaryButton, LoadingView } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/context/auth";
import { api, fileUrl, ApiError } from "@/src/api/client";
import { formatNaira, formatMoney, toMinor, formatDateTime } from "@/src/lib/format";

type Trade = {
  id: string; order_id: string; brand_name: string; brand_color: string; submission_type: string;
  subcategory: string; country: string; card_value_usd: number; quantity: number;
  currency?:string; minor_digits?:number; unit_payout_minor?:number; rate_kobo_per_usd: number; expected_payout_kobo: number; approved_payout_kobo: number | null;
  status: string; reason: string; notes: string; ecode: string; image_paths: string[];
  status_history: { status: string; at: string; note: string }[];
  customer: { full_name: string; email: string; phone: string } | null;
};

export default function AdminTradeDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { token } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [action, setAction] = useState<null | "approve" | "reject" | "need-info">(null);
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading, refetch } = useQuery({ queryKey: ["admin-trade", id], queryFn: () => api.get<Trade>(`/admin/trades/${id}`) });

  if (isLoading || !data) {
    return <ScreenBackground><StackHeader title="Review Trade" /><LoadingView /></ScreenBackground>;
  }

  const openAction = (a: "approve" | "reject" | "need-info") => {
    setText("");
    setAmount(String((data.approved_payout_kobo ?? data.expected_payout_kobo) / 10 ** (data.minor_digits??2)));
    setAction(a);
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (action === "approve") {
        const kobo = amount ? toMinor(amount, data.minor_digits??2) : data.expected_payout_kobo;
        if (!kobo) throw new Error("Enter a valid approved payout");
        await api.post(`/admin/trades/${id}/approve`, { approved_amount_kobo: kobo, note: text });
        toast.show("Trade approved & customer credited", "success");
      } else if (action === "reject") {
        if (!text.trim()) { setBusy(false); return toast.show("Enter a reason", "error"); }
        await api.post(`/admin/trades/${id}/reject`, { reason: text });
        toast.show("Trade rejected", "success");
      } else if (action === "need-info") {
        if (!text.trim()) { setBusy(false); return toast.show("Describe what's needed", "error"); }
        await api.post(`/admin/trades/${id}/need-info`, { reason: text });
        toast.show("Requested more information", "success");
      }
      setAction(null);
      qc.invalidateQueries({ queryKey: ["admin-trades"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      await refetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const canAct = !["APPROVED", "REJECTED"].includes(data.status);
  const Row = ({ label, value }: any) => (
    <View style={styles.detailRow}><Text style={styles.detailKey}>{label}</Text><Text style={styles.detailVal}>{value}</Text></View>
  );

  return (
    <ScreenBackground>
      <StackHeader title="Review Trade" right={<StatusBadge status={data.status} />} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + (canAct ? 100 : spacing.xxxl), gap: spacing.lg }}>
        <View style={styles.headCard}>
          <BrandMonogram name={data.brand_name} color={data.brand_color} size={52} />
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>{data.brand_name}</Text>
            <Text style={styles.order}>{data.order_id}</Text>
          </View>
        </View>

        {data.customer && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Customer</Text>
            <Row label="Name" value={data.customer.full_name} />
            <Row label="Email" value={data.customer.email} />
            <Row label="Phone" value={data.customer.phone} />
          </View>
        )}

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Submission</Text>
          <Row label="Type" value={data.submission_type === "ecode" ? "E-code" : "Physical"} />
          {!!data.subcategory && <Row label="Sub-category" value={data.subcategory} />}
          {!!data.country && <Row label="Country" value={data.country} />}
          <Row label="Value" value={`$${data.card_value_usd} × ${data.quantity}`} />
          <Row label="Payout per card" value={formatMoney(data.unit_payout_minor ?? data.rate_kobo_per_usd * data.card_value_usd, data.currency||"NGN", data.minor_digits??2)} />
          <Row label="Expected payout" value={formatMoney(data.expected_payout_kobo,data.currency||"NGN",data.minor_digits??2)} />
          {!!data.notes && <Row label="Notes" value={data.notes} />}
        </View>

        {data.submission_type === "ecode" && !!data.ecode && (
          <View style={styles.ecodeBox}>
            <Ionicons name="key" size={18} color={colors.brandPrimary} />
            <Text style={styles.ecodeText} selectable>{data.ecode}</Text>
          </View>
        )}

        {data.image_paths.length > 0 && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Uploaded images</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {data.image_paths.map((p) => (
                <Image
                  key={p}
                  source={{ uri: fileUrl(p, token), headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
                  style={styles.image}
                  contentFit="cover"
                />
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Timeline</Text>
          {data.status_history.map((h, i) => (
            <View key={i} style={styles.tlRow}>
              <View style={styles.tlDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tlStatus}>{h.status.replace(/_/g, " ")}</Text>
                {!!h.note && <Text style={styles.tlNote}>{h.note}</Text>}
                <Text style={styles.tlTime}>{formatDateTime(h.at)}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {canAct && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable style={[styles.actBtn, { backgroundColor: colors.warningBg }]} onPress={() => openAction("need-info")} testID="admin-need-info">
            <Ionicons name="help-circle" size={20} color={colors.warning} />
            <Text style={[styles.actText, { color: colors.warning }]}>Info</Text>
          </Pressable>
          <Pressable style={[styles.actBtn, { backgroundColor: colors.errorBg }]} onPress={() => openAction("reject")} testID="admin-reject">
            <Ionicons name="close-circle" size={20} color={colors.error} />
            <Text style={[styles.actText, { color: colors.error }]}>Reject</Text>
          </Pressable>
          <Pressable style={[styles.actBtn, styles.approve]} onPress={() => openAction("approve")} testID="admin-approve">
            <Ionicons name="checkmark-circle" size={20} color={colors.onBrandPrimary} />
            <Text style={[styles.actText, { color: colors.onBrandPrimary }]}>Approve</Text>
          </Pressable>
        </View>
      )}

      <Modal visible={action !== null} transparent animationType="slide" onRequestClose={() => setAction(null)}>
        <Pressable style={styles.overlay} onPress={() => setAction(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {action === "approve" ? "Approve & credit" : action === "reject" ? "Reject trade" : "Request more info"}
            </Text>
            {action === "approve" && (
              <View style={styles.amountField}>
                <Text style={styles.amountLabel}>Approved amount</Text>
                <TextInput style={styles.amountInput} keyboardType="number-pad" value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))} testID="admin-approve-amount" />
              </View>
            )}
            <TextInput
              style={styles.reasonInput}
              placeholder={action === "approve" ? "Note (optional)" : "Reason / message to customer"}
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={setText}
              multiline
              testID="admin-action-text"
            />
            <PrimaryButton
              title={action === "approve" ? "Approve & Credit" : action === "reject" ? "Confirm Reject" : "Send Request"}
              onPress={submit}
              loading={busy}
              testID="admin-action-submit"
              style={{ marginTop: spacing.md }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  headCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.xs },
  brand: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
  order: { color: colors.muted, fontSize: 13 },
  block: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.xs },
  blockTitle: { fontWeight: "800", color: colors.onSurface, fontSize: 15, marginBottom: spacing.xs },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  detailKey: { color: colors.muted, fontSize: 14 },
  detailVal: { color: colors.onSurface, fontWeight: "700", fontSize: 14, maxWidth: "60%", textAlign: "right" },
  ecodeBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brandSecondary, borderRadius: radius.lg, padding: spacing.lg },
  ecodeText: { flex: 1, color: colors.onSurface, fontWeight: "700", fontSize: 15, letterSpacing: 1 },
  image: { width: 120, height: 90, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  tlRow: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.sm },
  tlDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.brandPrimary, marginTop: 4 },
  tlStatus: { fontWeight: "800", color: colors.onSurface, fontSize: 14, textTransform: "capitalize" },
  tlNote: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  tlTime: { color: colors.muted, fontSize: 11, marginTop: 2 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.screenBg },
  actBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 52, borderRadius: radius.lg },
  approve: { flex: 1.4, backgroundColor: colors.brandPrimary },
  actText: { fontWeight: "800", fontSize: 14 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xxxl },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.md },
  amountField: { marginBottom: spacing.md },
  amountLabel: { color: colors.muted, fontSize: 13, marginBottom: 4 },
  amountInput: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, padding: spacing.md, fontSize: 20, fontWeight: "800", color: colors.onSurface },
  reasonInput: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, padding: spacing.md, fontSize: 15, color: colors.onSurface, minHeight: 60 },
}));

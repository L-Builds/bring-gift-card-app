import React, { useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, BrandMonogram, PrimaryButton, LoadingView } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { api, uploadImage, ApiError } from "@/src/api/client";
import { formatNaira, formatMoney, toMinor, formatDateTime } from "@/src/lib/format";

type Trade = {
  id: string; order_id: string; brand_name: string; brand_color: string; submission_type: string;
  subcategory: string; country: string; card_value_usd: number; quantity: number;
  currency?:string; minor_digits?:number; unit_payout_minor?:number; rate_kobo_per_usd: number; expected_payout_kobo: number; approved_payout_kobo: number | null;
  status: string; reason: string; notes: string; ecode_masked?: string;
  image_paths: string[]; status_history: { status: string; at: string; note: string }[];
  created_at: string;
};

export default function TradeDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [reply, setReply] = useState("");
  const [ecode, setEcode] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading, refetch } = useQuery({ queryKey: ["trade", id], queryFn: () => api.get<Trade>(`/trades/${id}`) });

  if (isLoading || !data) {
    return (
      <ScreenBackground>
        <StackHeader title="Trade Details" />
        <LoadingView />
      </ScreenBackground>
    );
  }

  const needInfo = data.status === "NEED_MORE_INFO";
  const payout = data.approved_payout_kobo ?? data.expected_payout_kobo;

  const addImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6 });
    if (res.canceled) return;
    try {
      const p = await uploadImage(res.assets[0].uri);
      setImages((prev) => [...prev, p]);
      toast.show("Image added", "success");
    } catch {
      toast.show("Upload failed", "error");
    }
  };

  const sendReply = async () => {
    if (!reply.trim() && !ecode.trim() && images.length === 0) return toast.show("Add a message or the requested info", "error");
    setSubmitting(true);
    try {
      await api.post(`/trades/${id}/reply`, { message: reply, ecode, image_paths: images });
      qc.invalidateQueries({ queryKey: ["trade", id] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      setReply(""); setEcode(""); setImages([]);
      await refetch();
      toast.show("Response sent — back to review", "success");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not send", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const Row = ({ label, value }: { label: string; value: string }) => (
    <View style={styles.detailRow}>
      <Text style={styles.detailKey}>{label}</Text>
      <Text style={styles.detailVal}>{value}</Text>
    </View>
  );

  return (
    <ScreenBackground>
      <StackHeader title="Trade Details" />
      <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.lg }}>
        <View style={styles.headCard}>
          <BrandMonogram name={data.brand_name} color={data.brand_color} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>{data.brand_name}</Text>
            <Text style={styles.order}>Order ID: {data.order_id}</Text>
          </View>
          <StatusBadge status={data.status} />
        </View>

        <View style={styles.payoutCard}>
          <Text style={styles.payoutLabel}>{data.status === "APPROVED" ? "Approved payout" : "Expected payout"}</Text>
          <Text style={styles.payoutValue}>{formatNaira(payout)}</Text>
        </View>

        {(data.status === "REJECTED" || needInfo) && data.reason ? (
          <View style={[styles.reasonBox, needInfo ? styles.reasonWarn : styles.reasonError]}>
            <Ionicons name={needInfo ? "help-circle" : "close-circle"} size={20} color={needInfo ? colors.warning : colors.error} />
            <Text style={styles.reasonText}>{data.reason}</Text>
          </View>
        ) : null}

        <View style={styles.block}>
          <Row label="Type" value={data.submission_type === "ecode" ? "E-code" : "Physical"} />
          {!!data.subcategory && <Row label="Sub-category" value={data.subcategory} />}
          {!!data.country && <Row label="Country" value={data.country} />}
          <Row label="Card value" value={`$${data.card_value_usd}`} />
          <Row label="Quantity" value={String(data.quantity)} />
          <Row label="Payout per card" value={formatMoney(data.unit_payout_minor ?? data.rate_kobo_per_usd * data.card_value_usd, data.currency||"NGN", data.minor_digits??2)} />
          {!!data.ecode_masked && <Row label="E-code" value={data.ecode_masked} />}
          {!!data.notes && <Row label="Notes" value={data.notes} />}
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Status timeline</Text>
          {data.status_history.map((h, i) => (
            <View key={i} style={styles.timelineRow}>
              <View style={styles.timelineDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tlStatus}>{h.status.replace(/_/g, " ")}</Text>
                {!!h.note && <Text style={styles.tlNote}>{h.note}</Text>}
                <Text style={styles.tlTime}>{formatDateTime(h.at)}</Text>
              </View>
            </View>
          ))}
        </View>

        {needInfo && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Respond to request</Text>
            <TextInput style={styles.replyInput} placeholder="Add a message…" placeholderTextColor={colors.muted} value={reply} onChangeText={setReply} multiline testID="trade-reply-message" />
            {data.submission_type === "ecode" && (
              <TextInput style={styles.replyInput} placeholder="Updated e-code (optional)" placeholderTextColor={colors.muted} value={ecode} onChangeText={setEcode} autoCapitalize="characters" testID="trade-reply-ecode" />
            )}
            <Pressable style={styles.addImage} onPress={addImage} testID="trade-reply-image">
              <Ionicons name="cloud-upload-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.addImageText}>Add image{images.length ? ` (${images.length})` : ""}</Text>
            </Pressable>
            <PrimaryButton title="Send Response" onPress={sendReply} loading={submitting} testID="trade-reply-submit" style={{ marginTop: spacing.sm }} />
          </View>
        )}

        {data.status === "APPROVED" && (
          <Pressable style={styles.receiptRow} onPress={() => router.push(`/receipt?kind=trade&id=${data.id}`)} testID="trade-receipt">
            <Ionicons name="receipt-outline" size={18} color={colors.success} />
            <Text style={styles.receiptText}>View & share your trade receipt</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.success} />
          </Pressable>
        )}

        <Pressable style={styles.helpRow} onPress={() => router.push(`/support/new?category=trade&ref_type=trade&ref_id=${data.id}&subject=${encodeURIComponent(`Help with trade ${data.order_id}`)}`)} testID="trade-get-help">
          <Ionicons name="headset-outline" size={18} color={colors.brandPrimary} />
          <Text style={styles.helpText}>Need help with this trade? Message support</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.brandPrimary} />
        </Pressable>
      </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  headCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.xs },
  brand: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
  order: { color: colors.muted, fontSize: 13, marginTop: 2 },
  payoutCard: { backgroundColor: colors.successBg, borderRadius: radius.xl, padding: spacing.lg, alignItems: "center" },
  payoutLabel: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  payoutValue: { color: colors.success, fontSize: 26, fontWeight: "800", marginTop: 4 },
  reasonBox: { flexDirection: "row", gap: spacing.sm, borderRadius: radius.lg, padding: spacing.md, alignItems: "flex-start" },
  reasonWarn: { backgroundColor: colors.warningBg },
  reasonError: { backgroundColor: colors.errorBg },
  reasonText: { flex: 1, color: colors.onSurface, fontSize: 13, lineHeight: 19 },
  block: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm },
  helpRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brandSecondary, borderRadius: radius.lg, padding: spacing.md },
  receiptRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.successBg, borderRadius: radius.lg, padding: spacing.md },
  receiptText: { flex: 1, color: colors.success, fontWeight: "700", fontSize: 13 },
  helpText: { flex: 1, color: colors.brandPrimary, fontWeight: "700", fontSize: 13 },
  blockTitle: { fontWeight: "800", color: colors.onSurface, fontSize: 15, marginBottom: spacing.xs },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  detailKey: { color: colors.muted, fontSize: 14 },
  detailVal: { color: colors.onSurface, fontWeight: "700", fontSize: 14, maxWidth: "60%", textAlign: "right" },
  timelineRow: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.sm },
  timelineDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.brandPrimary, marginTop: 4 },
  tlStatus: { fontWeight: "800", color: colors.onSurface, fontSize: 14, textTransform: "capitalize" },
  tlNote: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  tlTime: { color: colors.muted, fontSize: 11, marginTop: 2 },
  replyInput: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, padding: spacing.md, fontSize: 15, color: colors.onSurface, minHeight: 48 },
  addImage: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.brandPrimary, borderRadius: radius.lg, padding: spacing.md, justifyContent: "center" },
  addImageText: { color: colors.brandPrimary, fontWeight: "700" },
}));

import React, { useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable, Modal } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, PrimaryButton, LoadingView } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/context/auth";
import { api, fileUrl, ApiError } from "@/src/api/client";
import { formatDateTime } from "@/src/lib/format";

type Sub = {
  id: string; user_id: string; id_type_label: string; id_number: string; full_name: string; dob: string; address: string;
  id_front_path: string; id_back_path: string; selfie_path: string; status: string; reason: string;
  created_at: string; reviewed_at: string | null;
  customer: { id: string; full_name: string; email: string; phone: string; country: string; kyc_status: string } | null;
};

export default function AdminKycReview() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { token } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({ queryKey: ["admin-kyc-detail", id], queryFn: () => api.get<Sub>(`/admin/kyc/${id}`) });

  if (isLoading || !data) return <ScreenBackground><StackHeader title="Review Identity" /><LoadingView /></ScreenBackground>;

  const done = async () => {
    qc.invalidateQueries({ queryKey: ["admin-kyc"] });
    qc.invalidateQueries({ queryKey: ["admin-stats"] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["admin-user", data.user_id] });
    await refetch();
  };

  const approve = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/kyc/${id}/approve`);
      toast.show("Identity verified — customer notified", "success");
      await done();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!reason.trim()) return toast.show("Enter a reason for the customer", "error");
    setBusy(true);
    try {
      await api.post(`/admin/kyc/${id}/reject`, { reason: reason.trim() });
      toast.show("Submission rejected — customer notified", "success");
      setRejecting(false);
      await done();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ label, value }: { label: string; value: string }) => (
    <View style={styles.detailRow}><Text style={styles.detailKey}>{label}</Text><Text style={styles.detailVal} selectable>{value}</Text></View>
  );
  const Doc = ({ label, path }: { label: string; path: string }) => {
    if (!path) return null;
    const uri = fileUrl(path, token);
    return (
      <Pressable onPress={() => setZoom(uri)} style={styles.doc} testID={`admin-kyc-doc-${label.toLowerCase().replace(/\s/g, "-")}`}>
        <Image source={{ uri, headers: token ? { Authorization: `Bearer ${token}` } : undefined }} style={styles.docImg} contentFit="cover" />
        <Text style={styles.docLabel}>{label}</Text>
      </Pressable>
    );
  };

  const canAct = data.status === "PENDING";

  return (
    <ScreenBackground>
      <StackHeader title="Review Identity" right={<StatusBadge status={data.status} />} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + (canAct ? 100 : spacing.xxxl), gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        {data.customer && (
          <Pressable style={styles.block} onPress={() => router.push(`/admin/customer/${data.customer!.id}`)} testID="admin-kyc-customer">
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={styles.blockTitle}>Customer</Text>
              <Ionicons name="open-outline" size={18} color={colors.brandPrimary} />
            </View>
            <Row label="Account name" value={data.customer.full_name} />
            <Row label="Email" value={data.customer.email} />
            <Row label="Phone" value={data.customer.phone || "—"} />
            <Row label="Country" value={data.customer.country} />
          </Pressable>
        )}

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Declared identity</Text>
          <Row label="ID type" value={data.id_type_label} />
          <Row label="ID number" value={data.id_number} />
          <Row label="Full name on ID" value={data.full_name} />
          <Row label="Date of birth" value={data.dob} />
          <Row label="Address" value={data.address} />
          <Row label="Submitted" value={formatDateTime(data.created_at)} />
          {!!data.reviewed_at && <Row label="Reviewed" value={formatDateTime(data.reviewed_at)} />}
          {!!data.reason && <Row label="Reason" value={data.reason} />}
        </View>

        {data.customer && data.customer.full_name.trim().toLowerCase() !== data.full_name.trim().toLowerCase() && (
          <View style={styles.warn}>
            <Ionicons name="warning" size={18} color={colors.warning} />
            <Text style={styles.warnText}>Name on ID differs from account name. Check documents carefully.</Text>
          </View>
        )}

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Documents (tap to enlarge)</Text>
          <View style={styles.docs}>
            <Doc label="ID front" path={data.id_front_path} />
            <Doc label="ID back" path={data.id_back_path} />
            <Doc label="Selfie" path={data.selfie_path} />
          </View>
        </View>
      </ScrollView>

      {canAct && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable style={[styles.actBtn, { backgroundColor: colors.errorBg }]} onPress={() => { setReason(""); setRejecting(true); }} disabled={busy} testID="admin-kyc-reject">
            <Ionicons name="close-circle" size={20} color={colors.error} />
            <Text style={[styles.actText, { color: colors.error }]}>Reject</Text>
          </Pressable>
          <Pressable style={[styles.actBtn, styles.approve]} onPress={approve} disabled={busy} testID="admin-kyc-approve">
            <Ionicons name="shield-checkmark" size={20} color={colors.onBrandPrimary} />
            <Text style={[styles.actText, { color: colors.onBrandPrimary }]}>{busy ? "Working…" : "Verify identity"}</Text>
          </Pressable>
        </View>
      )}

      <Modal visible={rejecting} transparent animationType="slide" onRequestClose={() => setRejecting(false)}>
        <Pressable style={styles.overlay} onPress={() => setRejecting(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Reject verification</Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Tell the customer what to fix (e.g. blurry ID photo)"
              placeholderTextColor={colors.muted}
              value={reason}
              onChangeText={setReason}
              multiline
              testID="admin-kyc-reason"
            />
            <PrimaryButton title="Confirm Reject" onPress={reject} loading={busy} testID="admin-kyc-reject-submit" style={{ marginTop: spacing.md }} />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <Pressable style={styles.zoomOverlay} onPress={() => setZoom(null)} testID="admin-kyc-zoom-close">
          {zoom && <Image source={{ uri: zoom, headers: token ? { Authorization: `Bearer ${token}` } : undefined }} style={styles.zoomImg} contentFit="contain" />}
        </Pressable>
      </Modal>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  block: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.xs, marginTop: spacing.xs },
  blockTitle: { fontWeight: "800", color: colors.onSurface, fontSize: 15, marginBottom: spacing.xs },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, gap: spacing.md },
  detailKey: { color: colors.muted, fontSize: 14 },
  detailVal: { color: colors.onSurface, fontWeight: "700", fontSize: 14, maxWidth: "60%", textAlign: "right" },
  warn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.warningBg, borderRadius: radius.lg, padding: spacing.md },
  warnText: { flex: 1, color: colors.warning, fontWeight: "600", fontSize: 13 },
  docs: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  doc: { width: "48%", gap: 6 },
  docImg: { width: "100%", aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  docLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.screenBg },
  actBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 52, borderRadius: radius.lg },
  approve: { flex: 1.6, backgroundColor: colors.brandPrimary },
  actText: { fontWeight: "800", fontSize: 14 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xxxl },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.md },
  reasonInput: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, padding: spacing.md, fontSize: 15, color: colors.onSurface, minHeight: 80 },
  zoomOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  zoomImg: { width: "100%", height: "80%" },
}));

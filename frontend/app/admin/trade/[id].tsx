import React, { useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable, Modal, KeyboardAvoidingView, Platform, useWindowDimensions } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "@/src/components/private-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, StatusBadge, BrandMonogram, PrimaryButton, LoadingView, QueryErrorView } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/context/auth";
import { api, fileUrl, ApiError } from "@/src/api/client";
import { formatMoney, toMinor, formatDateTime } from "@/src/lib/format";

type Trade = {
  id: string; order_id: string; brand_name: string; brand_color: string; submission_type: string;
  subcategory: string; country: string; card_value_usd: number; quantity: number;
  currency?: string; minor_digits?: number; unit_payout_minor?: number; rate_kobo_per_usd: number; expected_payout_kobo: number; approved_payout_kobo: number | null;
  status: string; reason: string; notes: string; ecode: string; image_paths: string[];
  status_history: { status: string; at: string; note: string }[];
  customer: { full_name: string; email: string; phone: string } | null;
};

export default function AdminTradeDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const toast = useToast();
  const qc = useQueryClient();
  const { token } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [action, setAction] = useState<null | "approve" | "reject" | "need-info">(null);
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerScale, setViewerScale] = useState(1);
  const [viewerRotation, setViewerRotation] = useState(0);

  const { data, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ["admin-trade", id],
    queryFn: () => api.get<Trade>(`/admin/trades/${id}`),
  });

  if (isLoading) {
    return <ScreenBackground><StackHeader title="Trade details" /><LoadingView /></ScreenBackground>;
  }
  if (isError || !data) {
    return (
      <ScreenBackground>
        <StackHeader title="Trade details" />
        <QueryErrorView title="Trade review unavailable" onRetry={() => { void refetch(); }} retrying={isRefetching} />
      </ScreenBackground>
    );
  }

  const openAction = (a: "approve" | "reject" | "need-info") => {
    setText("");
    setAmount(String((data.approved_payout_kobo ?? data.expected_payout_kobo) / 10 ** (data.minor_digits ?? 2)));
    setAction(a);
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (action === "approve") {
        const kobo = amount ? toMinor(amount, data.minor_digits ?? 2) : data.expected_payout_kobo;
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
  const desktopWorkspace = viewportWidth >= 1024;
  const hasEvidence = (data.submission_type === "ecode" && !!data.ecode) || data.image_paths.length > 0;
  const viewerPath = viewerIndex === null ? null : data.image_paths[viewerIndex] ?? null;
  const viewerStageWidth = Math.max(260, Math.min(viewportWidth - (viewportWidth >= 768 ? 120 : 24), 1400));
  const viewerStageHeight = Math.max(220, viewportHeight - (viewportWidth >= 768 ? 210 : 300));
  const viewerRotated = viewerRotation % 180 !== 0;

  const openViewer = (index: number) => {
    setViewerIndex(index);
    setViewerScale(1);
    setViewerRotation(0);
  };
  const closeViewer = () => {
    setViewerIndex(null);
    setViewerScale(1);
    setViewerRotation(0);
  };
  const moveViewer = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= data.image_paths.length) return;
    setViewerIndex(nextIndex);
    setViewerScale(1);
    setViewerRotation(0);
  };
  const zoomOut = () => setViewerScale((value) => Math.max(1, Number((value - 0.5).toFixed(1))));
  const zoomIn = () => setViewerScale((value) => Math.min(3, Number((value + 0.5).toFixed(1))));
  const rotateViewer = () => setViewerRotation((value) => (value + 90) % 360);

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <View style={styles.detailRow}>
      <Text style={styles.detailKey}>{label}</Text>
      <Text style={styles.detailVal}>{value}</Text>
    </View>
  );

  const ReviewActions = () => canAct ? (
    <View style={styles.reviewActions}>
      <Pressable style={[styles.reviewAction, styles.reviewInfo]} onPress={() => openAction("need-info")} testID="admin-need-info">
        <Ionicons name="help-circle-outline" size={19} color={colors.warning} />
        <Text style={[styles.reviewActionText, { color: colors.warning }]}>Need Information</Text>
      </Pressable>
      <Pressable style={[styles.reviewAction, styles.reviewReject]} onPress={() => openAction("reject")} testID="admin-reject">
        <Ionicons name="close-circle-outline" size={19} color={colors.error} />
        <Text style={[styles.reviewActionText, { color: colors.error }]}>Reject Trade</Text>
      </Pressable>
      <Pressable style={[styles.reviewAction, styles.reviewApprove]} onPress={() => openAction("approve")} testID="admin-approve">
        <Ionicons name="checkmark-circle" size={19} color={colors.onBrandPrimary} />
        <Text style={[styles.reviewActionText, { color: colors.onBrandPrimary }]}>Approve Trade</Text>
      </Pressable>
    </View>
  ) : (
    <View style={styles.reviewComplete}>
      <Ionicons name="checkmark-done-circle-outline" size={20} color={data.status === "APPROVED" ? colors.success : colors.muted} />
      <Text style={styles.reviewCompleteText}>This trade review is complete.</Text>
    </View>
  );

  return (
    <ScreenBackground>
      <StackHeader title="Trade details" right={<StatusBadge status={data.status} />} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.pageContent,
          { paddingBottom: insets.bottom + spacing.xxxl },
        ]}
      >
        <View style={styles.tradeHeader}>
          <View style={styles.tradeIdentity}>
            <BrandMonogram name={data.brand_name} color={data.brand_color} size={46} />
            <View style={styles.tradeIdentityText}>
              <Text style={styles.tradeTitle}>{data.order_id}</Text>
              <Text style={styles.tradeSubtitle}>
                {data.brand_name}
                {data.country ? ` · ${data.country}` : ""}
                {` · ${data.submission_type === "ecode" ? "E-code" : "Physical"}`}
              </Text>
            </View>
          </View>
          <View style={styles.headerStatus}><StatusBadge status={data.status} /></View>
        </View>

        <View style={[styles.workspace, !desktopWorkspace && styles.workspaceMobile]} testID="admin-trade-workspace">
          <View style={styles.primaryColumn}>
            <View style={styles.panel}>
              <View style={styles.sectionHeading}>
                <Ionicons name="receipt-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.sectionTitle}>Trade Information</Text>
              </View>
              <View style={styles.rows}>
                <Row label="Card" value={data.brand_name} />
                <Row label="Type" value={data.submission_type === "ecode" ? "E-code" : "Physical"} />
                {!!data.subcategory && <Row label="Sub-category" value={data.subcategory} />}
                {!!data.country && <Row label="Country" value={data.country} />}
                <Row label="Value" value={`$${data.card_value_usd} × ${data.quantity}`} />
                <Row
                  label="Payout per card"
                  value={formatMoney(
                    data.unit_payout_minor ?? data.rate_kobo_per_usd * data.card_value_usd,
                    data.currency || "NGN",
                    data.minor_digits ?? 2,
                  )}
                />
                {!!data.notes && <Row label="Notes" value={data.notes} />}
              </View>
            </View>

            {data.customer && (
              <View style={styles.panel}>
                <View style={styles.sectionHeading}>
                  <Ionicons name="person-outline" size={18} color={colors.brandPrimary} />
                  <Text style={styles.sectionTitle}>Customer</Text>
                </View>
                <View style={styles.rows}>
                  <Row label="Name" value={data.customer.full_name} />
                  <Row label="Email" value={data.customer.email} />
                  <Row label="Phone" value={data.customer.phone} />
                </View>
              </View>
            )}
          </View>

          <View
            style={[
              styles.reviewColumn,
              desktopWorkspace && Platform.OS === "web" && styles.reviewColumnSticky,
              !desktopWorkspace && styles.reviewColumnMobile,
            ]}
            testID="admin-trade-review-panel"
          >
            <View style={styles.reviewHeader}>
              <Text style={styles.sectionTitle}>Review</Text>
              <StatusBadge status={data.status} />
            </View>
            <View style={styles.payoutSummary}>
              <Text style={styles.payoutLabel}>Expected payout</Text>
              <Text style={styles.payoutAmount}>
                {formatMoney(data.expected_payout_kobo, data.currency || "NGN", data.minor_digits ?? 2)}
              </Text>
              <Text style={styles.payoutMeta}>
                {formatMoney(
                  data.unit_payout_minor ?? data.rate_kobo_per_usd * data.card_value_usd,
                  data.currency || "NGN",
                  data.minor_digits ?? 2,
                )} per card · {data.quantity} {data.quantity === 1 ? "card" : "cards"}
              </Text>
            </View>
            {data.approved_payout_kobo != null && (
              <View style={styles.approvedSummary}>
                <Text style={styles.approvedLabel}>Approved payout</Text>
                <Text style={styles.approvedAmount}>
                  {formatMoney(data.approved_payout_kobo, data.currency || "NGN", data.minor_digits ?? 2)}
                </Text>
              </View>
            )}
            <ReviewActions />
          </View>
        </View>

        {hasEvidence && (
          <View style={styles.panel} testID="admin-trade-evidence-section">
            <View style={styles.sectionHeading}>
              <Ionicons name="images-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.sectionTitle}>Evidence</Text>
            </View>

            {data.submission_type === "ecode" && !!data.ecode && (
              <View style={styles.ecodeBox}>
                <Ionicons name="key-outline" size={18} color={colors.brandPrimary} />
                <View style={styles.ecodeContent}>
                  <Text style={styles.evidenceLabel}>Submitted code</Text>
                  <Text style={styles.ecodeText} selectable>{data.ecode}</Text>
                </View>
              </View>
            )}

            {data.image_paths.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imageList}>
                {data.image_paths.map((p, index) => (
                  <Pressable
                    key={`${p}-${index}`}
                    style={styles.imageTile}
                    onPress={() => openViewer(index)}
                    accessibilityRole="button"
                    accessibilityLabel={`View uploaded card image ${index + 1} of ${data.image_paths.length}`}
                    testID={`admin-trade-image-${index}`}
                  >
                    <Image
                      source={{ uri: fileUrl(p, token), headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
                      style={styles.image}
                      contentFit="contain"
                    />
                    <View style={styles.imageMeta}>
                      <Text style={styles.imageNumber}>Image {index + 1}</Text>
                      <View style={styles.imageViewBadge}>
                        <Ionicons name="expand-outline" size={14} color={colors.brandPrimary} />
                        <Text style={styles.imageViewText}>View</Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        <View style={styles.panel}>
          <View style={styles.sectionHeading}>
            <Ionicons name="time-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.sectionTitle}>Activity</Text>
          </View>
          <View style={styles.timeline}>
            {data.status_history.map((h, i) => (
              <View key={i} style={styles.tlRow}>
                <View style={styles.tlRail}>
                  <View style={styles.tlDot} />
                  {i < data.status_history.length - 1 && <View style={styles.tlLine} />}
                </View>
                <View style={styles.tlContent}>
                  <View style={styles.tlTopRow}>
                    <Text style={styles.tlStatus}>{h.status.replace(/_/g, " ")}</Text>
                    <Text style={styles.tlTime}>{formatDateTime(h.at)}</Text>
                  </View>
                  {!!h.note && <Text style={styles.tlNote}>{h.note}</Text>}
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={viewerIndex !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeViewer}
      >
        <View style={[styles.viewerOverlay, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.viewerHeader}>
            <Pressable
              style={styles.viewerIconButton}
              onPress={closeViewer}
              accessibilityRole="button"
              accessibilityLabel="Close image viewer"
              testID="admin-image-viewer-close"
            >
              <Ionicons name="close" size={24} color={colors.onSurfaceInverse} />
            </Pressable>
            <Text style={styles.viewerCounter}>
              {viewerIndex === null ? "" : `Image ${viewerIndex + 1} of ${data.image_paths.length}`}
            </Text>
            <View style={styles.viewerHeaderSpacer} />
          </View>

          <View
            style={[styles.viewerStage, { width: viewerStageWidth, height: viewerStageHeight }]}
            testID="admin-image-viewer-stage"
          >
            {viewerPath && (
              <Image
                source={{ uri: fileUrl(viewerPath, token), headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
                style={{
                  width: viewerRotated ? viewerStageHeight : viewerStageWidth,
                  height: viewerRotated ? viewerStageWidth : viewerStageHeight,
                  transform: [{ scale: viewerScale }, { rotate: `${viewerRotation}deg` }],
                }}
                contentFit="contain"
              />
            )}
          </View>

          <View style={styles.viewerControls}>
            <Pressable
              style={[styles.viewerControlButton, viewerScale <= 1 && styles.viewerControlDisabled]}
              onPress={zoomOut}
              disabled={viewerScale <= 1}
              accessibilityRole="button"
              accessibilityLabel="Zoom out"
              testID="admin-image-viewer-zoom-out"
            >
              <Ionicons name="remove" size={20} color={colors.onSurfaceInverse} />
            </Pressable>
            <Text style={styles.viewerZoomText}>{Math.round(viewerScale * 100)}%</Text>
            <Pressable
              style={[styles.viewerControlButton, viewerScale >= 3 && styles.viewerControlDisabled]}
              onPress={zoomIn}
              disabled={viewerScale >= 3}
              accessibilityRole="button"
              accessibilityLabel="Zoom in"
              testID="admin-image-viewer-zoom-in"
            >
              <Ionicons name="add" size={20} color={colors.onSurfaceInverse} />
            </Pressable>
            <Pressable
              style={styles.viewerControlButton}
              onPress={rotateViewer}
              accessibilityRole="button"
              accessibilityLabel="Rotate image clockwise"
              testID="admin-image-viewer-rotate"
            >
              <Ionicons name="refresh" size={20} color={colors.onSurfaceInverse} />
            </Pressable>
          </View>

          <View style={styles.viewerNav}>
            <Pressable
              style={[styles.viewerNavButton, viewerIndex === 0 && styles.viewerControlDisabled]}
              onPress={() => viewerIndex !== null && moveViewer(viewerIndex - 1)}
              disabled={viewerIndex === 0}
              accessibilityRole="button"
              accessibilityLabel="Previous uploaded image"
              testID="admin-image-viewer-previous"
            >
              <Ionicons name="chevron-back" size={20} color={colors.onSurfaceInverse} />
              <Text style={styles.viewerNavText}>Previous</Text>
            </Pressable>
            <Pressable
              style={[styles.viewerNavButton, viewerIndex === data.image_paths.length - 1 && styles.viewerControlDisabled]}
              onPress={() => viewerIndex !== null && moveViewer(viewerIndex + 1)}
              disabled={viewerIndex === data.image_paths.length - 1}
              accessibilityRole="button"
              accessibilityLabel="Next uploaded image"
              testID="admin-image-viewer-next"
            >
              <Text style={styles.viewerNavText}>Next</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceInverse} />
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={action !== null} transparent animationType="slide" onRequestClose={() => setAction(null)}>
        <KeyboardAvoidingView
          style={styles.modalKeyboard}
          behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
        >
          <Pressable style={styles.overlay} onPress={() => setAction(null)}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>
                {action === "approve" ? "Approve & credit" : action === "reject" ? "Reject trade" : "Request more info"}
              </Text>
              {action === "approve" && (
                <View style={styles.amountField}>
                  <Text style={styles.amountLabel}>Approved amount</Text>
                  <TextInput
                    style={styles.amountInput}
                    keyboardType="number-pad"
                    value={amount}
                    onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ""))}
                    testID="admin-approve-amount"
                  />
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
        </KeyboardAvoidingView>
      </Modal>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  pageContent: {
    width: "100%",
    maxWidth: 1360,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  tradeHeader: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tradeIdentity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.md },
  tradeIdentityText: { flex: 1, minWidth: 0 },
  tradeTitle: { color: colors.onSurface, fontSize: 21, fontWeight: "800" },
  tradeSubtitle: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 3 },
  headerStatus: { flexShrink: 0 },

  workspace: { width: "100%", flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  workspaceMobile: { flexDirection: "column" },
  primaryColumn: { flex: 1, minWidth: 0, gap: spacing.lg },
  reviewColumn: {
    width: 360,
    flexShrink: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.lg,
    alignSelf: "flex-start",
  },
  reviewColumnSticky: { position: "sticky" as any, top: spacing.lg },
  reviewColumnMobile: { width: "100%", position: "relative" },

  panel: {
    width: "100%",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  rows: { borderTopWidth: 1, borderTopColor: colors.divider },
  detailRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  detailKey: { flexShrink: 0, color: colors.muted, fontSize: 13 },
  detailVal: { flex: 1, color: colors.onSurface, fontWeight: "700", fontSize: 13, textAlign: "right" },

  reviewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  payoutSummary: { gap: 4, paddingVertical: spacing.sm },
  payoutLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  payoutAmount: { color: colors.onSurface, fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
  payoutMeta: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 18 },
  approvedSummary: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md, gap: 3 },
  approvedLabel: { color: colors.success, fontSize: 12, fontWeight: "700" },
  approvedAmount: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  reviewActions: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  reviewAction: {
    minHeight: 46,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
  },
  reviewInfo: { backgroundColor: colors.warningBg, borderColor: colors.warningBg },
  reviewReject: { backgroundColor: colors.errorBg, borderColor: colors.errorBg },
  reviewApprove: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  reviewActionText: { fontWeight: "800", fontSize: 13 },
  reviewComplete: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  reviewCompleteText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },

  ecodeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    backgroundColor: colors.brandSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  ecodeContent: { flex: 1, minWidth: 0, gap: 4 },
  evidenceLabel: { color: colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  ecodeText: { color: colors.onSurface, fontWeight: "700", fontSize: 15, letterSpacing: 1 },
  imageList: { gap: spacing.sm },
  imageTile: {
    width: 156,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  image: { width: 138, height: 104, borderRadius: radius.sm, backgroundColor: colors.surface },
  imageMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  imageNumber: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "700" },
  imageViewBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  imageViewText: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800" },

  timeline: { paddingTop: 2 },
  tlRow: { flexDirection: "row", gap: spacing.md, minHeight: 52 },
  tlRail: { width: 14, alignItems: "center" },
  tlDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary, marginTop: 5 },
  tlLine: { width: 1, flex: 1, backgroundColor: colors.borderStrong, marginVertical: 3 },
  tlContent: { flex: 1, paddingBottom: spacing.md },
  tlTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.lg },
  tlStatus: { flex: 1, fontWeight: "800", color: colors.onSurface, fontSize: 13, textTransform: "capitalize" },
  tlNote: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 3 },
  tlTime: { color: colors.muted, fontSize: 11, textAlign: "right" },

  viewerOverlay: { flex: 1, backgroundColor: "rgba(7, 12, 24, 0.96)", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md },
  viewerHeader: { width: "100%", maxWidth: 1400, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  viewerIconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  viewerHeaderSpacer: { width: 44, height: 44 },
  viewerCounter: { color: colors.onSurfaceInverse, fontSize: 14, fontWeight: "800" },
  viewerStage: { alignItems: "center", justifyContent: "center", overflow: "hidden", borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.04)" },
  viewerControls: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  viewerControlButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  viewerControlDisabled: { opacity: 0.35 },
  viewerZoomText: { minWidth: 52, textAlign: "center", color: colors.onSurfaceInverse, fontSize: 13, fontWeight: "800" },
  viewerNav: { width: "100%", maxWidth: 720, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  viewerNavButton: { minWidth: 120, minHeight: 42, paddingHorizontal: spacing.md, borderRadius: radius.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.12)" },
  viewerNavText: { color: colors.onSurfaceInverse, fontSize: 13, fontWeight: "800" },

  modalKeyboard: { flex: 1 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xxxl },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.md },
  amountField: { marginBottom: spacing.md },
  amountLabel: { color: colors.muted, fontSize: 13, marginBottom: 4 },
  amountInput: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, padding: spacing.md, fontSize: 20, fontWeight: "800", color: colors.onSurface },
  reasonInput: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, padding: spacing.md, fontSize: 15, color: colors.onSurface, minHeight: 60 },
}));

import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api, ApiError } from "@/src/api/client";
import { AdminPage, Field, Panel } from "@/src/components/admin-form";
import { EmptyState, LoadingView, QueryErrorView, StatusBadge } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/context/auth";
import { formatDate } from "@/src/lib/format";
import { canManageSettings } from "@/src/lib/staff-access";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type DeletionRequest = {
  status: "pending_review" | "completed";
  reference: string;
  reason?: string;
  user_id: string;
  customer_name?: string;
  customer_email?: string;
  created_at: string;
  completed_at?: string;
};

type DeletionReview = {
  status: "pending_review" | "completed";
  reference: string;
  reason?: string;
  storage_cleanup_available: boolean;
  uploads: { path: string; created_at?: string; trade_evidence: boolean; kyc_evidence?: boolean; support_ticket_ids: string[] }[];
  support_tickets: { id: string; subject: string; status: string; category: string; ref: string; can_remove: boolean }[];
  kyc_submissions: { id: string; status: string }[];
  kyc_retention_reviewed: boolean;
};

type MutationResult = {
  status: "pending_review" | "completed";
  reference: string;
  reason?: string;
  removed_uploads?: number;
  removed_tickets?: number;
};

export default function AccountDeletionRequests() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useStyles();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"pending_review" | "completed">("pending_review");
  const [page, setPage] = useState(1);
  const [openReference, setOpenReference] = useState<string | null>(null);
  const [selectedUploads, setSelectedUploads] = useState<string[]>([]);
  const [selectedTickets, setSelectedTickets] = useState<string[]>([]);
  const [retentionReason, setRetentionReason] = useState("");
  const [identityRecordsReviewed, setIdentityRecordsReviewed] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"cleanup" | "finalize" | null>(null);
  const [busyAction, setBusyAction] = useState<"cleanup" | "kyc" | "finalize" | null>(null);
  const requests = useQuery({
    queryKey: ["admin-account-deletion", status, page],
    queryFn: () => api.get<{ requests: DeletionRequest[]; total: number; page: number; page_size: number }>(
      `/admin/account-deletion?status=${status}&page=${page}`),
    enabled: canManageSettings(user),
  });
  const review = useQuery({
    queryKey: ["admin-account-deletion-review", openReference],
    queryFn: () => api.get<DeletionReview>(`/admin/account-deletion/${encodeURIComponent(openReference!)}/review`),
    enabled: canManageSettings(user) && !!openReference,
  });

  if (!canManageSettings(user)) return <Redirect href="/admin" />;

  const selectRequest = (reference: string) => {
    setOpenReference(openReference === reference ? null : reference);
    setSelectedUploads([]);
    setSelectedTickets([]);
    setRetentionReason("");
    setIdentityRecordsReviewed(false);
    setConfirmAction(null);
  };

  const refresh = async (reference: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-account-deletion"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-account-deletion-review", reference] }),
      queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
    ]);
  };

  const runAction = async (reference: string, action: "cleanup" | "kyc" | "finalize") => {
    if (busyAction) return;
    setBusyAction(action);
    try {
      let result: MutationResult;
      const url = `/admin/account-deletion/${encodeURIComponent(reference)}`;
      if (action === "cleanup") {
        result = await api.post<MutationResult>(`${url}/cleanup`, {
          confirmation: "REVIEWED", upload_paths: selectedUploads, ticket_ids: selectedTickets,
        });
        const removed = `${result.removed_uploads ?? 0} file${result.removed_uploads === 1 ? "" : "s"} and ${result.removed_tickets ?? 0} ticket${result.removed_tickets === 1 ? "" : "s"}`;
        toast.show(result.status === "completed" ? `Account closed. Removed ${removed}.` : `Removed ${removed}.`, "success");
        setSelectedUploads([]);
        setSelectedTickets([]);
      } else if (action === "kyc") {
        result = await api.post<MutationResult>(`${url}/kyc-review`, {
          decision: "retain", records_reviewed: identityRecordsReviewed, reason: retentionReason.trim(),
        });
        toast.show("Identity retention review recorded", "success");
        setRetentionReason("");
        setIdentityRecordsReviewed(false);
      } else {
        result = await api.post<MutationResult>(`${url}/finalize`, {});
        if (result.status === "completed") toast.show("Customer account closed", "success");
        else toast.show(result.reason || "This request still needs review before closure.", "info", { duration: 5000 });
      }
      setConfirmAction(null);
      if (result.status === "completed") {
        setOpenReference(null);
        setPage(1);
      }
      await refresh(reference);
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : "Could not process the request", "error", { duration: 5000 });
      await refresh(reference);
    } finally {
      setBusyAction(null);
    }
  };

  return <AdminPage title="Deletion requests">
    <Panel>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>Customer account deletion</Text>
          <Text style={styles.body}>Review each request, remove eligible personal files and conversations, then close the account when financial obligations are resolved. Financial and security records remain where retention is required.</Text>
        </View>
        <Ionicons name="shield-checkmark-outline" size={27} color={colors.brandPrimary} />
      </View>
      <View style={styles.filters}>
        {(["pending_review", "completed"] as const).map((option) => <Pressable
          key={option}
          testID={`deletion-filter-${option}`}
          accessibilityRole="button"
          accessibilityState={{ selected: status === option }}
          onPress={() => { setStatus(option); setPage(1); setOpenReference(null); setConfirmAction(null); }}
          style={[styles.filter, status === option && styles.filterActive]}
        ><Text style={[styles.filterText, status === option && styles.filterTextActive]}>{option === "pending_review" ? "Pending review" : "Completed"}</Text></Pressable>)}
      </View>
    </Panel>

    {requests.isLoading ? <LoadingView /> : requests.isError ? (
      <QueryErrorView title="Deletion requests unavailable" onRetry={() => { void requests.refetch(); }} retrying={requests.isRefetching} />
    ) : !requests.data?.requests.length ? (
      <Panel><EmptyState icon="person-remove-outline" title={status === "pending_review" ? "No pending requests" : "No completed requests"} /></Panel>
    ) : <>{requests.data.requests.map((item) => <Panel key={item.reference}>
      <View style={styles.requestHeading}>
        <View style={styles.headingCopy}>
          <Text style={styles.customer}>{item.customer_name || "Customer"}</Text>
          {!!item.customer_email && <Text style={styles.body}>{item.customer_email}</Text>}
        </View>
        <StatusBadge status={item.status} />
      </View>
      <Text style={styles.meta}>Reference {item.reference} · Requested {formatDate(item.created_at)}</Text>
      {!!item.completed_at && <Text style={styles.meta}>Completed {formatDate(item.completed_at)}</Text>}
      {!!item.reason && <Text style={styles.reason}>{item.reason}</Text>}
      {item.status === "pending_review" && <>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: openReference === item.reference }}
          testID={"deletion-review-" + item.reference} onPress={() => selectRequest(item.reference)} style={styles.reviewButton}>
          <Text style={styles.reviewText}>{openReference === item.reference ? "Hide review" : "Review request"}</Text>
          <Ionicons name={openReference === item.reference ? "chevron-up" : "chevron-forward"} size={17} color={colors.brandPrimary} />
        </Pressable>
        {openReference === item.reference && (review.isLoading ? <LoadingView /> : review.isError ? (
          <QueryErrorView title="Review details unavailable" onRetry={() => { void review.refetch(); }} retrying={review.isRefetching} />
        ) : review.data ? <DeletionReviewPanel
          reference={item.reference} details={review.data}
          selectedUploads={selectedUploads} setSelectedUploads={setSelectedUploads}
          selectedTickets={selectedTickets} setSelectedTickets={setSelectedTickets}
          retentionReason={retentionReason} setRetentionReason={setRetentionReason}
          identityRecordsReviewed={identityRecordsReviewed} setIdentityRecordsReviewed={setIdentityRecordsReviewed}
          confirmAction={confirmAction} setConfirmAction={setConfirmAction}
          busyAction={busyAction} runAction={runAction}
        /> : null)}
      </>}
    </Panel>)}
      {requests.data.total > requests.data.page_size && <Panel>
        <View style={styles.pagination}>
          <Pressable accessibilityRole="button" disabled={page <= 1}
            onPress={() => { setPage((value) => Math.max(1, value - 1)); setOpenReference(null); }}
            style={[styles.secondaryButton, page <= 1 && styles.disabled]}>
            <Text style={styles.secondaryText}>Previous</Text>
          </Pressable>
          <Text style={styles.meta}>Page {page} of {Math.ceil(requests.data.total / requests.data.page_size)}</Text>
          <Pressable accessibilityRole="button" disabled={page * requests.data.page_size >= requests.data.total}
            onPress={() => { setPage((value) => value + 1); setOpenReference(null); }}
            style={[styles.secondaryButton, page * requests.data.page_size >= requests.data.total && styles.disabled]}>
            <Text style={styles.secondaryText}>Next</Text>
          </Pressable>
        </View>
      </Panel>}
    </>}
  </AdminPage>;
}

type ReviewPanelProps = {
  reference: string;
  details: DeletionReview;
  selectedUploads: string[];
  setSelectedUploads: React.Dispatch<React.SetStateAction<string[]>>;
  selectedTickets: string[];
  setSelectedTickets: React.Dispatch<React.SetStateAction<string[]>>;
  retentionReason: string;
  setRetentionReason: React.Dispatch<React.SetStateAction<string>>;
  identityRecordsReviewed: boolean;
  setIdentityRecordsReviewed: React.Dispatch<React.SetStateAction<boolean>>;
  confirmAction: "cleanup" | "finalize" | null;
  setConfirmAction: React.Dispatch<React.SetStateAction<"cleanup" | "finalize" | null>>;
  busyAction: "cleanup" | "kyc" | "finalize" | null;
  runAction: (reference: string, action: "cleanup" | "kyc" | "finalize") => Promise<void>;
};

function DeletionReviewPanel({
  reference, details, selectedUploads, setSelectedUploads, selectedTickets, setSelectedTickets,
  retentionReason, setRetentionReason, identityRecordsReviewed, setIdentityRecordsReviewed,
  confirmAction, setConfirmAction, busyAction, runAction,
}: ReviewPanelProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const selectedTicketHasFiles = details.uploads.some((upload) =>
    upload.support_ticket_ids.some((ticketId) => selectedTickets.includes(ticketId)));
  const cleanupNeedsStorage = selectedUploads.length > 0 || selectedTicketHasFiles;
  const cleanupAvailable = (selectedUploads.length > 0 || selectedTickets.length > 0)
    && (!cleanupNeedsStorage || details.storage_cleanup_available);

  return <View style={styles.reviewDetails}>
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Identity records</Text>
      {details.kyc_submissions.length ? <>
        <Text style={styles.body}>Verification is paused. Complete an authorized manual review of these identity records and their files before recording a specific lawful retention reason. Keep this request pending if the records cannot be reviewed.</Text>
        {details.kyc_submissions.map((kyc) => <Text key={kyc.id} style={styles.meta}>Submission {kyc.id} · {kyc.status}</Text>)}
        {details.kyc_retention_reviewed ? <Text style={styles.successNote}>Retention review recorded</Text> : <>
          <Field label="Reason for retaining identity records" multiline maxLength={1000}
            value={retentionReason} onChangeText={setRetentionReason}
            placeholder="Describe the applicable financial, security, or legal reason"
            style={styles.reasonInput} />
          <Pressable accessibilityRole="checkbox"
            accessibilityState={{ checked: identityRecordsReviewed }}
            onPress={() => setIdentityRecordsReviewed((previous) => !previous)} style={styles.selectRow}>
            <Ionicons name={identityRecordsReviewed ? "checkbox" : "square-outline"} size={22} color={colors.brandPrimary} />
            <Text style={[styles.body, styles.headingCopy]}>I reviewed the identity records and files through authorized access.</Text>
          </Pressable>
          <Pressable accessibilityRole="button" testID="deletion-record-kyc-review"
            disabled={!!busyAction || !identityRecordsReviewed || retentionReason.trim().length < 10}
            onPress={() => { void runAction(reference, "kyc"); }}
            style={[styles.primaryButton, (!!busyAction || !identityRecordsReviewed || retentionReason.trim().length < 10) && styles.disabled]}>
            <Text style={styles.primaryText}>{busyAction === "kyc" ? "Recording…" : "Record retention review"}</Text>
          </Pressable>
        </>}
      </> : <Text style={styles.muted}>No identity submissions require review.</Text>}
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle}>General support conversations</Text>
      {details.support_tickets.length ? <>
        <Text style={styles.body}>Select closed, nonfinancial tickets after reviewing them. Open tickets must be resolved first.</Text>
        {details.support_tickets.map((ticket) => <View key={ticket.id} style={styles.itemWithOpen}>
          <Pressable accessibilityRole="checkbox"
            accessibilityState={{ checked: selectedTickets.includes(ticket.id), disabled: !ticket.can_remove }}
            disabled={!ticket.can_remove || !!busyAction}
            onPress={() => setSelectedTickets((previous) => previous.includes(ticket.id)
              ? previous.filter((id) => id !== ticket.id) : [...previous, ticket.id])}
            style={[styles.selectRow, styles.headingCopy, !ticket.can_remove && styles.ineligible]}>
            <Ionicons name={selectedTickets.includes(ticket.id) ? "checkbox" : "square-outline"} size={22}
              color={ticket.can_remove ? colors.brandPrimary : colors.muted} />
            <View style={styles.headingCopy}>
              <Text style={styles.rowTitle}>{ticket.subject || ticket.ref || "Support ticket"}</Text>
              <Text style={styles.meta}>{ticket.ref || ticket.id} · {ticket.category} · {ticket.status}{ticket.can_remove ? "" : " · Resolve before removal"}</Text>
            </View>
          </Pressable>
          <Pressable accessibilityRole="link" accessibilityLabel={"Open support ticket " + (ticket.ref || ticket.id)}
            onPress={() => router.push(("/admin/support/" + encodeURIComponent(ticket.id)) as never)} style={styles.openLink}>
            <Text style={styles.reviewText}>Open</Text><Ionicons name="open-outline" size={14} color={colors.brandPrimary} />
          </Pressable>
        </View>)}
      </> : <Text style={styles.muted}>No general support conversations need removal.</Text>}
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Uploaded files</Text>
      {details.uploads.length ? <>
        <Text style={styles.body}>Select only files with no trade, identity, or support link. Files linked to selected tickets are included automatically. Retained evidence cannot be removed here.</Text>
        {details.uploads.map((upload) => {
          const orphan = !upload.trade_evidence && upload.kyc_evidence === false && !upload.support_ticket_ids.length;
          const linkedToSelected = upload.support_ticket_ids.some((id) => selectedTickets.includes(id));
          const label = upload.trade_evidence ? "Trade evidence retained" : upload.kyc_evidence === true
            ? "Identity evidence retained" : upload.support_ticket_ids.length
            ? linkedToSelected ? "Included with selected ticket" : "Linked to support ticket" : upload.kyc_evidence == null
            ? "Evidence link needs review" : "Unlinked file";
          return <Pressable key={upload.path} accessibilityRole="checkbox"
            accessibilityState={{ checked: selectedUploads.includes(upload.path), disabled: !orphan || !details.storage_cleanup_available }}
            disabled={!orphan || !details.storage_cleanup_available || !!busyAction}
            onPress={() => setSelectedUploads((previous) => previous.includes(upload.path)
              ? previous.filter((path) => path !== upload.path) : [...previous, upload.path])}
            style={[styles.selectRow, (!orphan || !details.storage_cleanup_available) && styles.ineligible]}>
            <Ionicons name={selectedUploads.includes(upload.path) ? "checkbox" : "square-outline"} size={22}
              color={orphan && details.storage_cleanup_available ? colors.brandPrimary : colors.muted} />
            <View style={styles.headingCopy}>
              <Text style={styles.filePath} numberOfLines={2}>{upload.path}</Text>
              <Text style={styles.meta}>{label}{upload.created_at ? " · " + formatDate(upload.created_at) : ""}</Text>
            </View>
          </Pressable>;
        })}
        {!details.storage_cleanup_available && <Text style={styles.reason}>Private storage cleanup is unavailable. Keep requests with files pending until storage is configured and the files can be removed.</Text>}
      </> : <Text style={styles.muted}>No uploaded files need review.</Text>}
    </View>

    {(selectedUploads.length > 0 || selectedTickets.length > 0) && <View style={styles.actionArea}>
      <Text style={styles.body}>{selectedUploads.length} unlinked file{selectedUploads.length === 1 ? "" : "s"} and {selectedTickets.length} closed ticket{selectedTickets.length === 1 ? "" : "s"} selected.</Text>
      {cleanupNeedsStorage && !details.storage_cleanup_available && <Text style={styles.reason}>Private storage cleanup is required before removing these records.</Text>}
      {confirmAction === "cleanup" ? <View style={styles.confirm}>
        <Text style={styles.body}>Confirm that these files and conversations have been reviewed. This action removes selected records and may close the account if nothing else is pending.</Text>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={() => setConfirmAction(null)} disabled={!!busyAction} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" testID="deletion-confirm-cleanup" disabled={!!busyAction || !cleanupAvailable}
            onPress={() => { void runAction(reference, "cleanup"); }} style={[styles.dangerButton, (!!busyAction || !cleanupAvailable) && styles.disabled]}>
            <Text style={styles.dangerText}>{busyAction === "cleanup" ? "Removing…" : "Remove selected data"}</Text>
          </Pressable>
        </View>
      </View> : <Pressable accessibilityRole="button" testID="deletion-start-cleanup" disabled={!!busyAction || !cleanupAvailable}
        onPress={() => setConfirmAction("cleanup")} style={[styles.secondaryButton, !cleanupAvailable && styles.disabled]}>
        <Text style={styles.secondaryText}>Remove selected personal data</Text>
      </Pressable>}
    </View>}

    <View style={styles.finalizeArea}>
      <Text style={styles.sectionTitle}>Complete account closure</Text>
      <Text style={styles.body}>The server checks the wallet, unsettled trades, withdrawals, identity review, support conversations, and files again before closing the account.</Text>
      {confirmAction === "finalize" ? <View style={styles.confirm}>
        <Text style={styles.body}>Close this customer account only after the outstanding reviews and obligations have been resolved.</Text>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={() => setConfirmAction(null)} disabled={!!busyAction} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" testID={"deletion-finalize-" + reference}
            disabled={!!busyAction} onPress={() => { void runAction(reference, "finalize"); }}
            style={[styles.dangerButton, !!busyAction && styles.disabled]}>
            <Text style={styles.dangerText}>{busyAction === "finalize" ? "Checking…" : "Complete deletion"}</Text>
          </Pressable>
        </View>
      </View> : <Pressable accessibilityRole="button" disabled={!!busyAction}
        onPress={() => setConfirmAction("finalize")} style={styles.reviewButton}>
        <Text style={styles.reviewText}>Check and complete deletion</Text><Ionicons name="arrow-forward" size={17} color={colors.brandPrimary} />
      </Pressable>}
    </View>
  </View>;
}

const useStyles = makeStyles((colors) => ({
  headingRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  customer: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  body: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 20, marginTop: 4 },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  muted: { color: colors.muted, fontSize: 13 },
  reason: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19, backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.md },
  requestHeading: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  filter: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  filterActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandSecondary },
  filterText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700" },
  filterTextActive: { color: colors.brandPrimary },
  reviewButton: { alignSelf: "flex-start", flexDirection: "row", gap: spacing.sm, alignItems: "center", paddingVertical: spacing.sm },
  reviewText: { color: colors.brandPrimary, fontSize: 13, fontWeight: "700" },
  reviewDetails: { gap: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  selectRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm },
  itemWithOpen: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  openLink: { flexDirection: "row", alignItems: "center", gap: 4, padding: spacing.sm },
  ineligible: { opacity: 0.68 },
  rowTitle: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  filePath: { color: colors.onSurface, fontSize: 12, lineHeight: 18 },
  reasonInput: { minHeight: 74, textAlignVertical: "top" },
  successNote: { color: colors.success, fontSize: 13, fontWeight: "700" },
  primaryButton: { alignSelf: "flex-start", borderRadius: radius.md, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  primaryText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 13 },
  actionArea: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md },
  finalizeArea: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md },
  confirm: { gap: spacing.md, paddingTop: spacing.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.sm },
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  secondaryButton: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  secondaryText: { color: colors.onSurfaceSecondary, fontWeight: "700", fontSize: 13 },
  dangerButton: { borderRadius: radius.md, backgroundColor: colors.error, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  dangerText: { color: colors.onSurfaceInverse, fontWeight: "700", fontSize: 13 },
  disabled: { opacity: 0.5 },
}));

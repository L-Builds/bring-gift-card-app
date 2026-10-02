import React from "react";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { AdminPage, Note, Panel } from "@/src/components/admin-form";
import { formatDateTime, formatMoney } from "@/src/lib/format";
import { makeStyles, radius, spacing } from "@/src/theme";

type Change = {
  action: string;
  target: string;
  actor_name?: string;
  at: string;
  version: number;
  brand_name: string;
  market?: { currency: string; minor_digits: number; name: string };
  rate?: {
    face_value: number;
    payout_minor?: number | null;
    card_country?: string;
    submission_type?: "any" | "physical" | "ecode";
  };
};

const actionLabels: Record<string, string> = {
  "rate.updated": "Updated",
  "rate.disabled": "Disabled",
  "rate.archived": "Archived",
  "rate.deleted": "Removed",
};

function rateContext(change: Change) {
  const details = [change.market?.name, change.rate?.card_country];
  if (change.rate?.submission_type === "physical") details.push("Physical card");
  if (change.rate?.submission_type === "ecode") details.push("Code");
  return details.filter(Boolean).join(" · ");
}

export default function RateHistory() {
  const styles = useStyles();
  const history = useQuery({
    queryKey: ["denomination-history"],
    queryFn: () => api.get<{ changes: Change[] }>("/admin/denomination-history"),
  });

  return <AdminPage title="Rate history">
    <View style={styles.intro}>
      <Text style={styles.introTitle}>Denomination rate changes</Text>
      <Text style={styles.introText}>Earlier per-card rate changes are recorded here. Each trade retains the quote captured when it was submitted.</Text>
    </View>
    {history.isLoading && <Panel><Note>Loading rate history…</Note></Panel>}
    {history.error && <Panel><Note>Rate history is unavailable: {history.error.message}</Note></Panel>}
    {history.data?.changes.length === 0 && <Panel><Note>No denomination rate changes have been recorded yet.</Note></Panel>}
    {history.data?.changes.map((change, index) => {
      const action = actionLabels[change.action] ?? "Changed";
      const isInactive = change.action !== "rate.updated";
      const context = rateContext(change);
      const payout = change.rate?.payout_minor;
      return <View key={`${change.target}:${change.version}:${index}`} style={styles.record} testID="admin-rate-history-record">
        <View style={styles.recordTop}>
          <View style={styles.recordHeading}>
            <Text style={styles.brandName}>{change.brand_name}</Text>
            {!!context && <Text style={styles.context}>{context}</Text>}
          </View>
          <View style={[styles.status, isInactive && styles.statusInactive]}>
            <Text style={[styles.statusText, isInactive && styles.statusTextInactive]}>{action}</Text>
          </View>
        </View>
        {change.rate && <View style={styles.valueBlock}>
          <Text style={styles.valueLabel}>Recorded payout per card</Text>
          <View style={styles.valueRow}>
            <Text style={styles.faceValue}>${change.rate.face_value} card</Text>
            <Text style={styles.payoutValue}>{typeof payout === "number" && change.market
              ? formatMoney(payout, change.market.currency, change.market.minor_digits)
              : "Payout unavailable"}</Text>
          </View>
        </View>}
        <View style={styles.recordFooter}>
          <Text style={styles.meta}>{formatDateTime(change.at)}</Text>
          <Text style={styles.meta}>Version {change.version}</Text>
          <Text style={styles.meta}>By {change.actor_name?.trim() || "Staff member"}</Text>
        </View>
      </View>;
    })}
  </AdminPage>;
}

const useStyles = makeStyles((colors) => ({
  intro: { gap: 4, marginBottom: spacing.xs },
  introTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  introText: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 20 },
  record: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  recordTop: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.sm },
  recordHeading: { flex: 1, minWidth: 180, gap: 3 },
  brandName: { color: colors.onSurface, fontSize: 17, fontWeight: "800" },
  context: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 18 },
  status: { backgroundColor: colors.brandSecondary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  statusInactive: { backgroundColor: colors.surfaceTertiary },
  statusText: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800" },
  statusTextInactive: { color: colors.onSurfaceSecondary },
  valueBlock: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: 6 },
  valueLabel: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "700" },
  valueRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  faceValue: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  payoutValue: { color: colors.onSurface, fontSize: 19, fontWeight: "800" },
  recordFooter: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm, flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  meta: { color: colors.muted, fontSize: 11, lineHeight: 17 },
}));

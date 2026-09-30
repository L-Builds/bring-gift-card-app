import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Action, AdminPage, Note, Panel } from "@/src/components/admin-form";
import { api } from "@/src/api/client";
import { formatDateTime, formatMoney } from "@/src/lib/format";

type Stats = {
  pending_trades: number;
  pending_withdrawals: number;
  total_customers: number;
  total_brands: number;
  open_tickets: number;
};
type Change = {
  target: string;
  action: string;
  at: string;
  version: number;
  brand_name: string;
  market?: { name: string; currency: string; minor_digits: number };
  rate?: { face_value: number; payout_minor: number };
};

export default function Reports() {
  const stats = useQuery({ queryKey: ["admin-stats"], queryFn: () => api.get<Stats>("/admin/stats") });
  const history = useQuery({ queryKey: ["denomination-history"], queryFn: () => api.get<{ changes: Change[] }>("/admin/denomination-history") });
  const refresh = () => { void Promise.all([stats.refetch(), history.refetch()]); };

  return (
    <AdminPage title="Reports">
      <Note>Current operations and recorded rate changes. Counts reflect live records; this page does not estimate revenue or payouts.</Note>
      <Action title="Refresh report" onPress={refresh} />
      <Panel>
        <Note>Operations snapshot</Note>
        {stats.isLoading && <Note>Loading current counts…</Note>}
        {stats.isError && <Note>Could not load current counts. Use Refresh report to retry.</Note>}
        {stats.data && <>
          <Note>Pending trades: {stats.data.pending_trades}</Note>
          <Note>Pending withdrawals: {stats.data.pending_withdrawals}</Note>
          <Note>Open support tickets: {stats.data.open_tickets}</Note>
          <Note>Customers: {stats.data.total_customers}</Note>
          <Note>Catalog records: {stats.data.total_brands}</Note>
        </>}
      </Panel>
      <Panel>
        <Note>Recent rate changes</Note>
        {history.isLoading && <Note>Loading rate history…</Note>}
        {history.isError && <Note>Could not load rate history. Use Refresh report to retry.</Note>}
        {history.data?.changes.length === 0 && <Note>No denomination changes have been recorded yet.</Note>}
        {history.data?.changes.slice(0, 8).map((change, index) => (
          <Panel key={`${change.target}-${change.version}-${index}`}>
            <Note>{change.brand_name} · {change.market?.name ?? "Market"} · {change.action === "rate.disabled" ? "Disabled" : "Updated"}</Note>
            {change.rate && <Note>${change.rate.face_value} → {change.market ? formatMoney(change.rate.payout_minor, change.market.currency, change.market.minor_digits) : `${change.rate.payout_minor} minor units`} per card</Note>}
            <Note>{formatDateTime(change.at)}</Note>
          </Panel>
        ))}
      </Panel>
    </AdminPage>
  );
}

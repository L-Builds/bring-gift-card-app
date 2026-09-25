import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/toast";
import { AdminPage, Panel, Field, Action, Toggle, Note } from "@/src/components/admin-form";
import { Market } from "@/src/lib/market";
const blank: Market = { code: "", name: "", currency: "", minor_digits: 2, is_active: true };
export default function Markets() {
  const [form, setForm] = useState<Market>(blank); const [busy, setBusy] = useState(false);
  const toast = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-markets"], queryFn: () => api.get<{ markets: Market[] }>("/admin/markets") });
  const save = async () => { setBusy(true); try { await api.post("/admin/markets", form); await qc.invalidateQueries(); setForm(blank); toast.show("Market saved", "success"); } catch(e) { toast.show((e as Error).message, "error"); } finally { setBusy(false); } };
  return <AdminPage title="Countries & Currencies"><Note>Manage payout markets. A wallet keeps its original currency; changing existing currency units is blocked to protect balances.</Note>
    {q.error && <Note>{q.error.message}</Note>}
    <Panel><Field label="Country code (e.g. NG)" value={form.code} onChangeText={v=>setForm({...form,code:v.toUpperCase()})}/><Field label="Country name" value={form.name} onChangeText={v=>setForm({...form,name:v})}/><Field label="Currency code (e.g. NGN)" value={form.currency} onChangeText={v=>setForm({...form,currency:v.toUpperCase()})}/><Field label="Currency decimal places" keyboardType="number-pad" value={String(form.minor_digits)} onChangeText={v=>setForm({...form,minor_digits:Number(v)})}/><Toggle label="Available" value={form.is_active} onChange={v=>setForm({...form,is_active:v})}/><Action title="Save market" disabled={busy} onPress={save}/><Action title="Clear form" onPress={()=>setForm(blank)}/></Panel>
    {q.data?.markets.map(m=><Panel key={m.code}><Note>{m.name} · {m.currency} · {m.is_active?"Active":"Disabled"}</Note><Action title={`Edit ${m.name}`} onPress={()=>setForm(m)}/></Panel>)}
  </AdminPage>;
}

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/toast";
import { AdminPage, Panel, Field, Action, Toggle, Note } from "@/src/components/admin-form";
type Provider = { id:string; label:string; adapter:string; enabled:boolean; configured?:boolean; available:boolean };
const blank = { id:"paystack", label:"Paystack", adapter:"paystack", enabled:false, secret:"", webhook_secret:"" };
export default function Providers() {
  const [f,setF]=useState(blank); const [busy,setBusy]=useState(false); const toast=useToast(); const qc=useQueryClient();
  const q=useQuery({queryKey:["payout-providers"],queryFn:()=>api.get<{providers:Provider[];default:string}>("/admin/payout-providers")});
  const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);try{await fn();await qc.invalidateQueries({queryKey:["payout-providers"]});setF({...f,secret:"",webhook_secret:""});toast.show("Provider settings saved","success");}catch(e){toast.show((e as Error).message,"error");}finally{setBusy(false);}};
  return <AdminPage title="Payout Providers"><Note>Company/manual payouts remain available. Paystack and Flutterwave support NGN bank transfers here. Other markets use company payout. New providers require a reviewed adapter before activation.</Note>{q.error&&<Note>{q.error.message}</Note>}
    {q.data?.providers.map(p=><Panel key={p.id}><Note>{p.label} · {p.enabled?"Enabled":"Disabled"}{q.data.default===p.id?" · Default":""}{p.id!=="manual"?` · ${p.configured?"Key stored":"No key"}`:""}</Note>{p.id!=="manual"&&<Action title={`Edit ${p.label}`} onPress={()=>setF({id:p.id,label:p.label,adapter:p.adapter,enabled:p.enabled,secret:"",webhook_secret:""})}/>}<Action title="Make default" disabled={busy||!p.enabled||!p.available} onPress={()=>run(()=>api.post("/admin/payout-default",{provider_id:p.id}))}/></Panel>)}
    <Panel><Action title="Add Paystack" onPress={()=>setF(blank)}/><Action title="Add Flutterwave" onPress={()=>setF({...blank,id:"flutterwave",label:"Flutterwave",adapter:"flutterwave"})}/><Action title="Register another provider" onPress={()=>setF({...blank,id:"",label:"",adapter:""})}/>
      <Field label="Provider ID" value={f.id} onChangeText={v=>setF({...f,id:v})}/><Field label="Display name" value={f.label} onChangeText={v=>setF({...f,label:v})}/><Field label="Adapter" value={f.adapter} onChangeText={v=>setF({...f,adapter:v})}/><Field label="Secret API key (blank keeps existing)" secureTextEntry autoCapitalize="none" value={f.secret} onChangeText={v=>setF({...f,secret:v})}/><Field label="Flutterwave webhook secret (blank keeps existing)" secureTextEntry autoCapitalize="none" value={f.webhook_secret} onChangeText={v=>setF({...f,webhook_secret:v})}/><Toggle label="Enabled" value={f.enabled} onChange={v=>setF({...f,enabled:v})}/><Action title="Save provider" disabled={busy} onPress={()=>run(()=>api.post(`/admin/payout-providers/${f.id}`,f))}/><Note>Webhook: {api.base}/webhooks/payouts/{f.id || "provider-id"}</Note>
    </Panel>
  </AdminPage>;
}

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { AdminPage, Panel, Note } from "@/src/components/admin-form";
import { formatMoney, formatDateTime } from "@/src/lib/format";
type Change={action:string;target:string;actor:string;at:string;version:number;brand_name:string;market?:{currency:string;minor_digits:number;name:string};rate?:{face_value:number;payout_minor:number}};
export default function RateHistory(){
 const q=useQuery({queryKey:["denomination-history"],queryFn:()=>api.get<{changes:Change[]}>("/admin/denomination-history")});
 return <AdminPage title="Rate history"><Note>Latest 300 denomination changes. Each trade keeps its original quote snapshot.</Note>{q.isLoading&&<Note>Loading…</Note>}{q.error&&<Note>{q.error.message}</Note>}{q.data?.changes.length===0&&<Note>No denomination changes recorded yet.</Note>}{q.data?.changes.map((r,i)=><Panel key={r.target+":"+r.version+":"+i}><Note>{r.brand_name} · {r.market?.name} · {r.action==="rate.disabled"?"Disabled":"Updated"}</Note>{r.rate&&<Note>${r.rate.face_value} → {formatMoney(r.rate.payout_minor,r.market?.currency||"NGN",r.market?.minor_digits??2)} per card</Note>}<Note>Version {r.version} · {formatDateTime(r.at)} · Admin {r.actor}</Note></Panel>)}</AdminPage>;
}

import React, { useState } from "react";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/toast";
import { AdminPage, Panel, Field, Action, Toggle, Note } from "@/src/components/admin-form";
import { CardRate, Market } from "@/src/lib/market";
import { formatMoney, toMinor } from "@/src/lib/format";
type Brand = { id:string; name:string; category:string; color:string; is_active:boolean; is_popular:boolean; submission_types:string[]; subcategories:string[]; countries:string[] };
const blank:Brand={id:"",name:"",category:"Other",color:"#1F5AF6",is_active:true,is_popular:false,submission_types:["physical","ecode"],subcategories:[],countries:[]};
export default function Catalog(){
 const [f,setF]=useState<Brand>(blank),[country,setCountry]=useState("NG"),[face,setFace]=useState(""),[amount,setAmount]=useState(""),[busy,setBusy]=useState(false);
 const toast=useToast(),qc=useQueryClient(),router=useRouter();
 const brands=useQuery({queryKey:["admin-brands"],queryFn:()=>api.get<{brands:Brand[]}>("/admin/brands")});
 const markets=useQuery({queryKey:["admin-markets"],queryFn:()=>api.get<{markets:Market[]}>("/admin/markets")});
 const rates=useQuery({queryKey:["admin-card-rates",f.id],queryFn:()=>api.get<{rates:CardRate[]}>(`/admin/card-rates?brand_id=${f.id}`),enabled:!!f.id});
 const market=markets.data?.markets.find(m=>m.code===country);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn();await qc.invalidateQueries();toast.show("Saved. Customer views use the updated rates.","success");}catch(e){toast.show((e as Error).message,"error");}finally{setBusy(false);}};
 const saveBrand=()=>run(async()=>{const body={...f,countries:f.countries.map(v=>v.trim()).filter(Boolean),subcategories:f.subcategories.map(v=>v.trim()).filter(Boolean)};const saved=f.id?await api.patch<Brand>(`/admin/brands/${f.id}`,body):await api.post<Brand>("/admin/brands",body);setF(saved);});
 const saveRate=()=>run(async()=>{const minor=toMinor(amount,market?.minor_digits??2);if(!market||!minor||!Number.isSafeInteger(Number(face))||Number(face)<=0)throw new Error("Select a market and enter a valid face value and total payout");await api.post("/admin/card-rates",{brand_id:f.id,market_code:country,face_value:Number(face),payout_minor:minor,is_active:true});setFace("");setAmount("");});
 return <AdminPage title="Catalog & Rates"><Action title="New gift card" onPress={()=>setF({...blank})}/><Action title="Rate history" onPress={()=>router.push("/admin/rate-history")}/>
  {brands.error&&<Note>{brands.error.message}</Note>}
  <Panel><Note>{f.id?`Editing ${f.name}`:"Create a gift card"}</Note><Field label="Card name" value={f.name} onChangeText={v=>setF({...f,name:v})}/><Field label="Category" value={f.category} onChangeText={v=>setF({...f,category:v})}/><Field label="Brand color" value={f.color} onChangeText={v=>setF({...f,color:v})}/><Field label="Card-origin countries (comma separated)" value={f.countries.join(",")} onChangeText={v=>setF({...f,countries:v.split(",")})}/><Field label="Card types / subcategories (comma separated)" value={f.subcategories.join(",")} onChangeText={v=>setF({...f,subcategories:v.split(",")})}/><Toggle label="Physical cards" value={f.submission_types.includes("physical")} onChange={v=>setF({...f,submission_types:v?[...f.submission_types,"physical"]:f.submission_types.filter(t=>t!=="physical")})}/><Toggle label="E-codes" value={f.submission_types.includes("ecode")} onChange={v=>setF({...f,submission_types:v?[...f.submission_types,"ecode"]:f.submission_types.filter(t=>t!=="ecode")})}/><Toggle label="Active" value={f.is_active} onChange={v=>setF({...f,is_active:v})}/><Toggle label="Popular on Home" value={f.is_popular} onChange={v=>setF({...f,is_popular:v})}/><Action title="Save card" disabled={busy||!f.name.trim()||!f.submission_types.length} onPress={saveBrand}/></Panel>
  {!!f.id&&<Panel><Note>Enter the total payout for one card at this face value. Quantity is applied by the backend.</Note>
   {markets.data?.markets.map(m=><Action key={m.code} title={`${country===m.code?"✓ ":""}${m.name} · ${m.currency}`} onPress={()=>setCountry(m.code)}/>)}
   <Field label="Card face value (USD)" keyboardType="number-pad" value={face} onChangeText={setFace}/><Field label={`Total payout (${market?.currency||"select market"})`} keyboardType="decimal-pad" value={amount} onChangeText={setAmount}/><Action title="Save denomination rate" disabled={busy} onPress={saveRate}/>
   {rates.error&&<Note>{rates.error.message}</Note>}
   {rates.data?.rates.map(r=>{const m=markets.data?.markets.find(x=>x.code===r.market_code);return <Panel key={r.id}><Note>{m?.name||r.market_code} · ${r.face_value} → {formatMoney(r.payout_minor,m?.currency||"NGN",m?.minor_digits??2)} · {r.is_active?"Active":"Disabled"}</Note><Action title="Edit rate" onPress={()=>{setCountry(r.market_code);setFace(String(r.face_value));setAmount(String(r.payout_minor/10**(m?.minor_digits??2)));}}/><Action title="Disable rate" disabled={busy||!r.is_active} onPress={()=>run(async()=>{await api.del(`/admin/card-rates/${r.id}`);})}/></Panel>})}
  </Panel>}
  {brands.data?.brands.map(b=><Panel key={b.id}><Note>{b.name} · {b.category} · {b.is_active?"Active":"Disabled"}</Note><Action title={`Edit ${b.name}`} onPress={()=>{setF(b);setFace("");setAmount("");}}/></Panel>)}
 </AdminPage>;
}

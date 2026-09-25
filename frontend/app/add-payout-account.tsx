import React,{useState} from "react";
import {useRouter} from "expo-router";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {api} from "@/src/api/client";
import {AdminPage,Panel,Field,Action,Note} from "@/src/components/admin-form";
import {useToast} from "@/src/components/toast";
export default function AddAccount(){
 const [provider,setProvider]=useState("manual"),[bank,setBank]=useState(""),[code,setCode]=useState(""),[number,setNumber]=useState(""),[name,setName]=useState(""),[busy,setBusy]=useState(false);
 const router=useRouter(),qc=useQueryClient(),toast=useToast();
 const options=useQuery({queryKey:["payout-options"],queryFn:()=>api.get<{providers:{id:string;label:string}[]}>("/payout-options")});
 const banks=useQuery({queryKey:["payout-banks",provider],queryFn:()=>api.get<{banks:{code:string;name:string}[]}>(`/payout-banks/${provider}`),enabled:provider!=="manual"});
 const select=(id:string)=>{setProvider(id);setBank("");setCode("");};
 const save=async()=>{setBusy(true);try{const saved=await api.post<{account_name:string;verified:boolean}>("/payout-accounts",{provider_name:bank,account_number:number.trim(),account_name:name.trim(),bank_code:code,payout_provider_id:provider,kind:"bank"});await qc.invalidateQueries({queryKey:["payout-accounts"]});toast.show(saved.verified?`Bank verified: ${saved.account_name}`:"Saved for company verification before payout","success");router.back();}catch(e){toast.show((e as Error).message,"error");}finally{setBusy(false);}};
 return <AdminPage title="Add Payout Account"><Panel><Note>Select how the company should pay this account.</Note><Action title={`${provider==="manual"?"✓ ":""}Company / Manual`} onPress={()=>select("manual")}/>{options.data?.providers.map(p=><Action key={p.id} title={`${provider===p.id?"✓ ":""}${p.label}`} onPress={()=>select(p.id)}/>)}{options.error&&<Note>{options.error.message}</Note>}</Panel>
 <Panel>{provider==="manual"?<Field label="Bank / payout institution" value={bank} onChangeText={setBank}/>:<><Note>Select bank</Note>{banks.isLoading&&<Note>Loading banks…</Note>}{banks.error&&<Note>{banks.error.message}</Note>}{banks.data?.banks.map(b=><Action key={b.code} title={`${code===b.code?"✓ ":""}${b.name}`} onPress={()=>{setBank(b.name);setCode(b.code);}}/>)}</>}
 <Field label="Account number" value={number} onChangeText={setNumber}/><Field label="Account holder name" value={name} onChangeText={setName}/><Note>{provider==="manual"?"The company must verify these details before sending a payment. This account is not marked bank-verified.":"The bank account name will be checked with the payout provider when you save."}</Note><Action title={provider==="manual"?"Save account":"Verify & save account"} disabled={busy||!bank||number.length<4||name.trim().length<2} onPress={save}/></Panel></AdminPage>;
}

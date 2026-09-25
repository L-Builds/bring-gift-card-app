import React,{useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {api} from "@/src/api/client";
import {AdminPage,Panel,Field,Action,Note} from "@/src/components/admin-form";
import {useToast} from "@/src/components/toast";
export default function Production(){
 const [kind,setKind]=useState("terms"),[title,setTitle]=useState("Terms & Conditions"),[content,setContent]=useState(""),[busy,setBusy]=useState(false);const toast=useToast();
 const q=useQuery({queryKey:["readiness"],queryFn:()=>api.get<{checks:Record<string,boolean>;release_note:string}>("/admin/readiness")});
 const load=async(k:string)=>{setKind(k);setTitle(k==="terms"?"Terms & Conditions":"Privacy Policy");setContent("");try{const d=await api.get<{title:string;content:string}>(`/legal/${k}`,false);setTitle(d.title);setContent(d.content);}catch(e){toast.show((e as Error).message,"info");}};
 const save=async()=>{setBusy(true);try{await api.post(`/admin/legal/${kind}`,{title,content});await q.refetch();toast.show("Company document published","success");}catch(e){toast.show((e as Error).message,"error");}finally{setBusy(false);}};
 return <AdminPage title="Production Setup"><Panel>{q.error&&<Note>{q.error.message}</Note>}{Object.entries(q.data?.checks||{}).map(([k,v])=><Note key={k}>{v?"Ready":"Missing"} · {k.replace(/_/g," ")}</Note>)}<Note>{q.data?.release_note}</Note></Panel><Panel><Note>Publish only company-approved legal text. No policy has been invented for this project.</Note><Action title="Load Terms" onPress={()=>load("terms")}/><Action title="Load Privacy Policy" onPress={()=>load("privacy")}/><Field label="Document title" value={title} onChangeText={setTitle}/><Field label="Approved document text" value={content} onChangeText={setContent} multiline style={{minHeight:240,textAlignVertical:"top"}}/><Action title={`Publish ${kind}`} disabled={busy||content.length<40} onPress={save}/></Panel></AdminPage>;
}

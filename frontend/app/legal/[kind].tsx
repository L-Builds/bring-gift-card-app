import React from "react";
import {useLocalSearchParams} from "expo-router";
import {useQuery} from "@tanstack/react-query";
import {api} from "@/src/api/client";
import {AdminPage,Panel,Note} from "@/src/components/admin-form";
export default function Legal(){const {kind}=useLocalSearchParams<{kind:string}>();const q=useQuery({queryKey:["legal",kind],queryFn:()=>api.get<{title:string;content:string}>(`/legal/${kind}`,false)});return <AdminPage title={q.data?.title||(kind==="terms"?"Terms & Conditions":"Privacy Policy")}><Panel><Note>{q.isLoading?"Loading…":q.error?q.error.message:q.data?.content}</Note></Panel></AdminPage>;}

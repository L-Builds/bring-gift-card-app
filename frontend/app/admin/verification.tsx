import React from "react";
import { useRouter } from "expo-router";
import { Action, AdminPage, Note, Panel } from "@/src/components/admin-form";

export default function Verification() {
  const router = useRouter();
  return (
    <AdminPage title="Verification">
      <Panel>
        <Note>Identity verification is paused for this release.</Note>
        <Note>No new identity submissions are being accepted, and there is no review queue to process. Customer signup and ordinary trading do not require KYC at this stage.</Note>
        <Action title="View customers" onPress={() => router.push("/admin/customers")} />
      </Panel>
    </AdminPage>
  );
}

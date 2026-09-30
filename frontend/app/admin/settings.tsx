import React from "react";
import { useRouter } from "expo-router";
import { Action, AdminPage, Note, Panel } from "@/src/components/admin-form";
import { useAuth } from "@/src/context/auth";
import { canManageStaff } from "@/src/lib/staff-access";

export default function AdminSettings() {
  const router = useRouter();
  const { user } = useAuth();
  return (
    <AdminPage title="Settings">
      <Panel>
        <Note>Company configuration</Note>
        <Note>Review production readiness and the published legal documents before accepting live trades.</Note>
        <Action title="Production and legal" onPress={() => router.push("/admin/production")} />
        <Action title="Payout providers" onPress={() => router.push("/admin/payout-providers")} />
        <Action title="Markets and currencies" onPress={() => router.push("/admin/markets")} />
      </Panel>
      {canManageStaff(user) && (
        <Panel>
          <Note>Team access</Note>
          <Note>Manage staff accounts and worker assignments.</Note>
          <Action title="Staff" onPress={() => router.push("/admin/staff")} />
        </Panel>
      )}
    </AdminPage>
  );
}

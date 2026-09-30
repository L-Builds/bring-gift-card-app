import React, { useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { AdminPage, Panel, Field, Action, Toggle, Note } from "@/src/components/admin-form";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/context/auth";
import { STAFF_SCOPES, StaffScope } from "@/src/lib/staff-access";

type StaffRole = "general_manager" | "manager" | "worker";
type StaffMember = {
  id: string;
  full_name: string;
  email: string;
  staff_role: StaffRole;
  staff_permissions: StaffScope[];
  disabled: boolean;
  created_at: string;
};

function roleLabel(role: StaffRole) {
  if (role === "general_manager") return "General Manager";
  return role === "manager" ? "Manager" : "Worker";
}

export default function StaffManagement() {
  const { width } = useWindowDimensions();
  const desktop = width >= 1100;
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isGeneralManager = user?.staff_role === "general_manager";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<"manager" | "worker">("worker");
  const [newPermissions, setNewPermissions] = useState<StaffScope[]>([]);
  const [permissionEdits, setPermissionEdits] = useState<Record<string, StaffScope[]>>({});
  const [passwordEdits, setPasswordEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const staff = useQuery({
    queryKey: ["admin-staff", page, query],
    queryFn: () => api.get<{ staff: StaffMember[]; total: number; page: number; page_size: number }>(`/admin/staff?page=${page}&page_size=50&q=${encodeURIComponent(query)}`),
    enabled: user?.role === "admin" && user.staff_role !== "worker",
  });

  const toggleNewPermission = (scope: StaffScope) => {
    setNewPermissions(current => current.includes(scope) ? current.filter(item => item !== scope) : [...current, scope]);
  };
  const togglePermissionEdit = (member: StaffMember, scope: StaffScope) => {
    setPermissionEdits(current => {
      const selected = current[member.id] ?? member.staff_permissions ?? [];
      return { ...current, [member.id]: selected.includes(scope) ? selected.filter(item => item !== scope) : [...selected, scope] };
    });
  };
  const refreshStaff = async () => { await queryClient.invalidateQueries({ queryKey: ["admin-staff"] }); };
  const createStaff = async () => {
    setBusy(true);
    try {
      await api.post("/admin/staff", {
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        staff_role: newRole,
        ...(newRole === "worker" ? { staff_permissions: newPermissions } : {}),
      });
      setFullName("");
      setEmail("");
      setPassword("");
      setNewPermissions([]);
      setNewRole("worker");
      await refreshStaff();
      toast.show("Staff account created", "success");
    } catch (error) {
      toast.show((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const updateStaff = async (id: string, body: { disabled?: boolean; staff_permissions?: StaffScope[]; password?: string }) => {
    setBusyId(id);
    try {
      await api.patch(`/admin/staff/${id}`, body);
      await refreshStaff();
      setPermissionEdits(current => { const next = { ...current }; delete next[id]; return next; });
      setPasswordEdits(current => { const next = { ...current }; delete next[id]; return next; });
      toast.show("Staff access updated", "success");
    } catch (error) {
      toast.show((error as Error).message, "error");
    } finally {
      setBusyId(null);
    }
  };

  const canCreate = fullName.trim().length >= 2 && email.includes("@") && password.length >= 12 && password.endsWith("@admin");

  return <AdminPage title="Staff">
    <Note>General Managers and Managers oversee the team. Workers only see the operations areas assigned to them.</Note>
    <View style={{ flexDirection: desktop ? "row" : "column", alignItems: "flex-start", gap: 16 }}>
    <View style={desktop ? { width: 360, flexShrink: 0 } : { width: "100%" }}>
    <Panel>
      <Note>Create staff account</Note>
      <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" />
      <Field label="Work email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Field label="Temporary password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
      <Note>Admin passwords must be at least 12 characters and end with @admin. Share the temporary password privately with the staff member.</Note>
      {isGeneralManager && <Action title={`Manager${newRole === "manager" ? " ✓" : ""}`} onPress={() => setNewRole("manager")} disabled={busy} />}
      <Action title={`Worker${newRole === "worker" ? " ✓" : ""}`} onPress={() => setNewRole("worker")} disabled={busy} />
      {newRole === "worker" && STAFF_SCOPES.map(scope => <Toggle key={scope.key} label={`${scope.label} — ${scope.description}`} value={newPermissions.includes(scope.key)} onChange={() => toggleNewPermission(scope.key)} />)}
      <Action title={busy ? "Creating account…" : "Create staff account"} onPress={() => { void createStaff(); }} disabled={busy || !canCreate} />
    </Panel>
    </View>

    <View style={desktop ? { flex: 1, gap: 16, minWidth: 0 } : { width: "100%", gap: 16 }}>
    <Note>Current staff</Note>
    <Panel>
      <Field label="Search staff by name or email" value={search} onChangeText={setSearch} autoCapitalize="none" returnKeyType="search" onSubmitEditing={() => { setPage(1); setQuery(search.trim()); }} />
      <Action title="Search staff" onPress={() => { setPage(1); setQuery(search.trim()); }} />
      {!!query && <Action title="Show all staff" onPress={() => { setSearch(""); setQuery(""); setPage(1); }} />}
    </Panel>
    {staff.isLoading && <Note>Loading staff…</Note>}
    {staff.error && <Panel><Note>Staff unavailable: {staff.error.message}</Note><Action title="Retry" onPress={() => { void staff.refetch(); }} /></Panel>}
    {!staff.isError && staff.data?.staff.length === 0 && <Panel><Note>No staff accounts yet.</Note></Panel>}
    {!staff.isError && staff.data?.staff.map(member => {
      const mayEdit = member.id !== user?.id && (isGeneralManager ? member.staff_role !== "general_manager" : member.staff_role === "worker");
      const selected = permissionEdits[member.id] ?? member.staff_permissions ?? [];
      return <Panel key={member.id}>
        <Note>{member.full_name} · {roleLabel(member.staff_role)}{member.disabled ? " · Disabled" : " · Active"}</Note>
        <Note>{member.email}</Note>
        {member.staff_role === "worker" && <Note>Assigned: {member.staff_permissions?.length ? member.staff_permissions.map(scope => STAFF_SCOPES.find(item => item.key === scope)?.label ?? scope).join(", ") : "No operations areas"}</Note>}
        {mayEdit && <Action title={expandedId === member.id ? "Hide controls" : "Manage account"} onPress={() => setExpandedId(current => current === member.id ? null : member.id)} />}
        {mayEdit && expandedId === member.id && <>
          {member.staff_role === "worker" && STAFF_SCOPES.map(scope => <Toggle key={scope.key} label={scope.label} value={selected.includes(scope.key)} onChange={() => togglePermissionEdit(member, scope.key)} />)}
          {member.staff_role === "worker" && permissionEdits[member.id] && <Action title={busyId === member.id ? "Saving…" : "Save assigned areas"} onPress={() => { void updateStaff(member.id, { staff_permissions: selected }); }} disabled={busyId === member.id} />}
          <Field label="New temporary password" value={passwordEdits[member.id] ?? ""} onChangeText={value => setPasswordEdits(current => ({ ...current, [member.id]: value }))} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
          {!!passwordEdits[member.id] && <Action title="Reset password" onPress={() => { void updateStaff(member.id, { password: passwordEdits[member.id] }); }} disabled={busyId === member.id || passwordEdits[member.id].length < 12 || !passwordEdits[member.id].endsWith("@admin")} />}
          <Action title={member.disabled ? "Enable account" : "Disable account"} onPress={() => { void updateStaff(member.id, { disabled: !member.disabled }); }} disabled={busyId === member.id} />
        </>}
      </Panel>;
    })}
    {!staff.isError && !!staff.data?.total && <Panel>
      <Note>Page {page} · {staff.data.total} staff accounts</Note>
      {page > 1 && <Action title="Previous page" onPress={() => setPage(current => current - 1)} />}
      {page * staff.data.page_size < staff.data.total && <Action title="Next page" onPress={() => setPage(current => current + 1)} />}
    </Panel>}
    </View>
    </View>
  </AdminPage>;
}

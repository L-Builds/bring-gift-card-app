import React, { useMemo, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { api } from "@/src/api/client";
import { AdminPage, Panel, Field, Action, Toggle, Note } from "@/src/components/admin-form";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/context/auth";
import { STAFF_SCOPES, StaffScope } from "@/src/lib/staff-access";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

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

function RolePill({ role }: { role: StaffRole }) {
  const styles = useStyles();
  return <View style={[styles.pill, role === "general_manager" ? styles.pillManager : role === "manager" ? styles.pillManager : styles.pillWorker]}>
    <Text style={[styles.pillText, role === "worker" ? styles.pillWorkerText : styles.pillManagerText]}>{roleLabel(role)}</Text>
  </View>;
}

function StatusPill({ disabled }: { disabled: boolean }) {
  const styles = useStyles();
  return <View style={[styles.pill, disabled ? styles.pillDisabled : styles.pillActive]}>
    <Text style={[styles.pillText, disabled ? styles.pillDisabledText : styles.pillActiveText]}>{disabled ? "Disabled" : "Active"}</Text>
  </View>;
}

export default function StaffManagement() {
  const { width } = useWindowDimensions();
  const desktop = width >= 1050;
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const styles = useStyles();
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

  const counts = useMemo(() => {
    const rows = staff.data?.staff ?? [];
    return {
      general_manager: rows.filter((member) => member.staff_role === "general_manager").length,
      manager: rows.filter((member) => member.staff_role === "manager").length,
      worker: rows.filter((member) => member.staff_role === "worker").length,
    };
  }, [staff.data?.staff]);

  const toggleNewPermission = (scope: StaffScope) => {
    setNewPermissions((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);
  };
  const togglePermissionEdit = (member: StaffMember, scope: StaffScope) => {
    setPermissionEdits((current) => {
      const selected = current[member.id] ?? member.staff_permissions ?? [];
      return { ...current, [member.id]: selected.includes(scope) ? selected.filter((item) => item !== scope) : [...selected, scope] };
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
      setPermissionEdits((current) => { const next = { ...current }; delete next[id]; return next; });
      setPasswordEdits((current) => { const next = { ...current }; delete next[id]; return next; });
      toast.show("Staff access updated", "success");
    } catch (error) {
      toast.show((error as Error).message, "error");
    } finally {
      setBusyId(null);
    }
  };

  const canCreate = fullName.trim().length >= 2 && email.includes("@") && password.length >= 12 && password.endsWith("@admin");
  const rows = staff.data?.staff ?? [];
  const expandedMember = rows.find((member) => member.id === expandedId) ?? null;

  const permissionsLabel = (member: StaffMember) => {
    if (member.staff_role === "general_manager") return "Full company access";
    if (member.staff_role === "manager") return "Management access";
    if (!member.staff_permissions?.length) return "No operations assigned";
    return member.staff_permissions.map((scope) => STAFF_SCOPES.find((item) => item.key === scope)?.label ?? scope).join(", ");
  };

  return <AdminPage title="Staff">
    <View>
      <Text style={styles.title}>Team access</Text>
      <Text style={styles.subtitle}>General Managers oversee the company, Managers manage operations and Workers only access their assigned areas.</Text>
    </View>

    <View style={styles.summaryRow} testID="staff-role-summary">
      <View style={styles.summaryItem}><Text style={styles.summaryValue}>{counts.general_manager}</Text><Text style={styles.summaryLabel}>General Managers shown</Text></View>
      <View style={styles.summaryItem}><Text style={styles.summaryValue}>{counts.manager}</Text><Text style={styles.summaryLabel}>Managers shown</Text></View>
      <View style={styles.summaryItem}><Text style={styles.summaryValue}>{counts.worker}</Text><Text style={styles.summaryLabel}>Workers shown</Text></View>
      {!!staff.data?.total && <View style={styles.summaryItem}><Text style={styles.summaryValue}>{staff.data.total}</Text><Text style={styles.summaryLabel}>Total staff</Text></View>}
    </View>

    <View style={[styles.workspace, !desktop && styles.workspaceMobile]} testID="admin-staff-workspace">
      <View style={styles.createColumn}>
        <Panel>
          <Text style={styles.panelTitle}>Create staff account</Text>
          <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" />
          <Field label="Work email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
          <Field label="Temporary password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
          <Note>Admin passwords must be at least 12 characters and end with @admin.</Note>

          <Text style={styles.fieldHeading}>Role</Text>
          <View style={styles.roleButtons}>
            {isGeneralManager && <Pressable onPress={() => setNewRole("manager")} style={[styles.roleButton, newRole === "manager" && styles.roleButtonActive]} testID="staff-create-manager-role">
              <Text style={[styles.roleButtonText, newRole === "manager" && styles.roleButtonTextActive]}>Manager</Text>
            </Pressable>}
            <Pressable onPress={() => setNewRole("worker")} style={[styles.roleButton, newRole === "worker" && styles.roleButtonActive]} testID="staff-create-worker-role">
              <Text style={[styles.roleButtonText, newRole === "worker" && styles.roleButtonTextActive]}>Worker</Text>
            </Pressable>
          </View>

          {newRole === "worker" && <View style={{ gap: spacing.sm }}>
            <Text style={styles.fieldHeading}>Assigned permissions</Text>
            {STAFF_SCOPES.map((scope) => <Toggle key={scope.key} label={scope.label} description={scope.description} value={newPermissions.includes(scope.key)} onChange={() => toggleNewPermission(scope.key)} />)}
          </View>}
          <Action title={busy ? "Creating account…" : "Create Staff Account"} onPress={() => { void createStaff(); }} disabled={busy || !canCreate} />
        </Panel>
      </View>

      <View style={styles.mainColumn}>
        <Panel>
          <Field label="Search staff by name or email" value={search} onChangeText={setSearch} autoCapitalize="none" returnKeyType="search" onSubmitEditing={() => { setPage(1); setQuery(search.trim()); }} />
          <View style={styles.searchActions}>
            <Pressable style={styles.searchButton} onPress={() => { setPage(1); setQuery(search.trim()); }}><Ionicons name="search" size={16} color={colors.onBrandPrimary} /><Text style={styles.searchButtonText}>Search</Text></Pressable>
            {!!query && <Pressable style={styles.clearButton} onPress={() => { setSearch(""); setQuery(""); setPage(1); }}><Text style={styles.clearButtonText}>Show all</Text></Pressable>}
          </View>
        </Panel>

        {staff.isLoading && <Note>Loading staff…</Note>}
        {staff.error && <Panel><Note>Staff unavailable: {staff.error.message}</Note><Action title="Retry" onPress={() => { void staff.refetch(); }} /></Panel>}
        {!staff.isError && rows.length === 0 && <Panel><Note>No staff accounts found.</Note></Panel>}

        {desktop && rows.length > 0 ? <View style={styles.table} testID="staff-desktop-table">
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeading, { flex: 1.5 }]}>Staff</Text>
            <Text style={[styles.tableHeading, { flex: 1 }]}>Role</Text>
            <Text style={[styles.tableHeading, { flex: 1.7 }]}>Assigned Permissions</Text>
            <Text style={[styles.tableHeading, { flex: 0.85 }]}>Status</Text>
            <Text style={[styles.tableHeading, { width: 78 }]}>Action</Text>
          </View>
          {rows.map((member) => {
            const mayEdit = member.id !== user?.id && (isGeneralManager ? member.staff_role !== "general_manager" : member.staff_role === "worker");
            return <Pressable key={member.id} disabled={!mayEdit} onPress={() => mayEdit && setExpandedId((current) => current === member.id ? null : member.id)} style={[styles.tableRow, expandedId === member.id && styles.tableRowSelected]} accessibilityRole={mayEdit ? "button" : undefined}>
              <View style={{ flex: 1.5 }}><Text style={styles.tablePrimary}>{member.full_name}</Text><Text style={styles.tableSecondary} numberOfLines={1}>{member.email}</Text></View>
              <View style={{ flex: 1, alignItems: "flex-start" }}><RolePill role={member.staff_role} /></View>
              <Text style={[styles.tableSecondary, { flex: 1.7 }]} numberOfLines={2}>{permissionsLabel(member)}</Text>
              <View style={{ flex: 0.85, alignItems: "flex-start" }}><StatusPill disabled={member.disabled} /></View>
              <Text style={[styles.editLink, { width: 78, opacity: mayEdit ? 1 : 0.45 }]}>{mayEdit ? (expandedId === member.id ? "Close" : "Manage") : "Protected"}</Text>
            </Pressable>;
          })}
        </View> : !desktop && <View style={{ gap: spacing.sm }}>
          {rows.map((member) => {
            const mayEdit = member.id !== user?.id && (isGeneralManager ? member.staff_role !== "general_manager" : member.staff_role === "worker");
            return <Pressable key={member.id} disabled={!mayEdit} onPress={() => mayEdit && setExpandedId((current) => current === member.id ? null : member.id)} style={[styles.mobileCard, expandedId === member.id && styles.tableRowSelected]}>
              <View style={{ flex: 1 }}><Text style={styles.tablePrimary}>{member.full_name}</Text><Text style={styles.tableSecondary}>{member.email}</Text><Text style={styles.permissionsText}>{permissionsLabel(member)}</Text></View>
              <View style={{ alignItems: "flex-end", gap: 6 }}><RolePill role={member.staff_role} /><StatusPill disabled={member.disabled} /></View>
            </Pressable>;
          })}
        </View>}

        {!!expandedMember && (() => {
          const selected = permissionEdits[expandedMember.id] ?? expandedMember.staff_permissions ?? [];
          const mayEdit = expandedMember.id !== user?.id && (isGeneralManager ? expandedMember.staff_role !== "general_manager" : expandedMember.staff_role === "worker");
          if (!mayEdit) return null;
          return <Panel>
            <View style={styles.manageTitleRow}>
              <View style={{ flex: 1 }}><Text style={styles.panelTitle}>Manage {expandedMember.full_name}</Text><Text style={styles.tableSecondary}>{roleLabel(expandedMember.staff_role)} · {expandedMember.email}</Text></View>
              <Pressable onPress={() => setExpandedId(null)} hitSlop={8}><Ionicons name="close" size={20} color={colors.muted} /></Pressable>
            </View>
            {expandedMember.staff_role === "worker" && <>
              <Text style={styles.fieldHeading}>Assigned permissions</Text>
              {STAFF_SCOPES.map((scope) => <Toggle key={scope.key} label={scope.label} description={scope.description} value={selected.includes(scope.key)} onChange={() => togglePermissionEdit(expandedMember, scope.key)} />)}
              {permissionEdits[expandedMember.id] && <Action title={busyId === expandedMember.id ? "Saving…" : "Save Assigned Permissions"} onPress={() => { void updateStaff(expandedMember.id, { staff_permissions: selected }); }} disabled={busyId === expandedMember.id} />}
            </>}
            <Field label="New temporary password" value={passwordEdits[expandedMember.id] ?? ""} onChangeText={(value) => setPasswordEdits((current) => ({ ...current, [expandedMember.id]: value }))} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
            {!!passwordEdits[expandedMember.id] && <Action title="Reset Password" onPress={() => { void updateStaff(expandedMember.id, { password: passwordEdits[expandedMember.id] }); }} disabled={busyId === expandedMember.id || passwordEdits[expandedMember.id].length < 12 || !passwordEdits[expandedMember.id].endsWith("@admin")} />}
            <Action title={expandedMember.disabled ? "Enable Account" : "Disable Account"} onPress={() => { void updateStaff(expandedMember.id, { disabled: !expandedMember.disabled }); }} disabled={busyId === expandedMember.id} />
          </Panel>;
        })()}

        {!staff.isError && !!staff.data?.total && <View style={styles.pagination}>
          <Text style={styles.tableSecondary}>Page {page} · {staff.data.total} staff accounts</Text>
          <View style={styles.paginationActions}>
            {page > 1 && <Pressable style={styles.clearButton} onPress={() => setPage((current) => current - 1)}><Text style={styles.clearButtonText}>Previous</Text></Pressable>}
            {page * staff.data.page_size < staff.data.total && <Pressable style={styles.clearButton} onPress={() => setPage((current) => current + 1)}><Text style={styles.clearButtonText}>Next</Text></Pressable>}
          </View>
        </View>}
      </View>
    </View>
  </AdminPage>;
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.onSurface, fontSize: 19, fontWeight: "800" },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summaryItem: { minWidth: 130, flexGrow: 1, flexBasis: 130, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  summaryValue: { color: colors.onSurface, fontSize: 21, fontWeight: "800" },
  summaryLabel: { color: colors.onSurfaceSecondary, fontSize: 11, marginTop: 2 },
  workspace: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  workspaceMobile: { flexDirection: "column" },
  createColumn: { width: 350, maxWidth: "100%", flexShrink: 0 },
  mainColumn: { flex: 1, width: "100%", minWidth: 0, gap: spacing.md },
  panelTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  fieldHeading: { color: colors.onSurface, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.35 },
  roleButtons: { flexDirection: "row", gap: spacing.sm },
  roleButton: { minHeight: 36, flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  roleButtonActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandSecondary },
  roleButtonText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "800" },
  roleButtonTextActive: { color: colors.brandPrimary },
  searchActions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  searchButton: { minHeight: 36, paddingHorizontal: 13, borderRadius: radius.md, backgroundColor: colors.brandPrimary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  searchButtonText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: "800" },
  clearButton: { minHeight: 34, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  clearButtonText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "800" },
  table: { width: "100%", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surface },
  tableHeader: { flexDirection: "row", gap: spacing.md, alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  tableHeading: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  tableRow: { minHeight: 62, flexDirection: "row", gap: spacing.md, alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surface },
  tableRowSelected: { backgroundColor: colors.screenBgAlt },
  tablePrimary: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  tableSecondary: { color: colors.onSurfaceSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 },
  permissionsText: { color: colors.muted, fontSize: 11, marginTop: 5 },
  editLink: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800" },
  pill: { minHeight: 24, borderRadius: radius.pill, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  pillText: { fontSize: 10, fontWeight: "800" },
  pillManager: { backgroundColor: colors.brandSecondary },
  pillManagerText: { color: colors.brandPrimary },
  pillWorker: { backgroundColor: colors.surfaceTertiary },
  pillWorkerText: { color: colors.onSurfaceSecondary },
  pillActive: { backgroundColor: colors.successBg },
  pillDisabled: { backgroundColor: colors.errorBg },
  pillActiveText: { color: colors.success },
  pillDisabledText: { color: colors.error },
  mobileCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  manageTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" },
  paginationActions: { flexDirection: "row", gap: spacing.xs },
}));

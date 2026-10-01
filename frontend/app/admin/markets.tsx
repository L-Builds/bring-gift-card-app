import React, { useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/toast";
import { AdminPage, Panel, Field, Action, Toggle, Note } from "@/src/components/admin-form";
import { Market } from "@/src/lib/market";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const blank: Market = { code: "", name: "", currency: "", minor_digits: 2, is_active: true };

function StatusPill({ active }: { active: boolean }) {
  const styles = useStyles();
  return <View style={[styles.statusPill, active ? styles.statusActive : styles.statusPaused]}>
    <Text style={[styles.statusText, active ? styles.statusTextActive : styles.statusTextPaused]}>{active ? "Active" : "Paused"}</Text>
  </View>;
}

export default function Markets() {
  const { width } = useWindowDimensions();
  const desktop = width >= 960;
  const [form, setForm] = useState<Market>({ ...blank });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const styles = useStyles();
  const q = useQuery({ queryKey: ["admin-markets"], queryFn: () => api.get<{ markets: Market[] }>("/admin/markets") });

  const save = async () => {
    setBusy(true);
    try {
      await api.post("/admin/markets", form);
      await qc.invalidateQueries({ queryKey: ["admin-markets"] });
      setForm({ ...blank });
      toast.show("Market saved", "success");
    } catch (error) {
      toast.show((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const editing = !!form.code && !!q.data?.markets.some((market) => market.code === form.code);

  return <AdminPage title="Markets">
    <View style={styles.headingRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Countries & currencies</Text>
        <Text style={styles.subtitle}>Control which payout markets are available. Existing currency units stay immutable to protect wallet balances.</Text>
      </View>
      <Pressable onPress={() => setForm({ ...blank })} style={styles.addButton} testID="markets-add-market">
        <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
        <Text style={styles.addButtonText}>Add Market</Text>
      </Pressable>
    </View>

    {q.isLoading && <Note>Loading markets…</Note>}
    {q.error && <Panel><Note>Markets unavailable: {q.error.message}</Note><Action title="Retry markets" onPress={() => { void q.refetch(); }} /></Panel>}

    <View style={[styles.workspace, !desktop && styles.workspaceMobile]} testID="admin-markets-workspace">
      <View style={styles.mainColumn}>
        {!q.isError && !q.isLoading && q.data?.markets.length === 0 && <Panel><Note>No payout markets have been configured yet.</Note></Panel>}
        {desktop && !!q.data?.markets.length ? <View style={styles.table} testID="markets-desktop-table">
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeading, { flex: 1.5 }]}>Country</Text>
            <Text style={[styles.tableHeading, { flex: 0.6 }]}>Code</Text>
            <Text style={[styles.tableHeading, { flex: 0.9 }]}>Currency</Text>
            <Text style={[styles.tableHeading, { flex: 0.8 }]}>Decimals</Text>
            <Text style={[styles.tableHeading, { flex: 0.8 }]}>Status</Text>
            <Text style={[styles.tableHeading, { width: 60 }]}>Action</Text>
          </View>
          {q.data?.markets.map((market) => <Pressable key={market.code} onPress={() => setForm({ ...market })} style={[styles.tableRow, form.code === market.code && styles.tableRowSelected]} accessibilityRole="button" accessibilityLabel={`Edit ${market.name}`}>
            <Text style={[styles.tablePrimary, { flex: 1.5 }]}>{market.name}</Text>
            <Text style={[styles.tableCode, { flex: 0.6 }]}>{market.code}</Text>
            <Text style={[styles.tablePrimary, { flex: 0.9 }]}>{market.currency}</Text>
            <Text style={[styles.tablePrimary, { flex: 0.8 }]}>{market.minor_digits}</Text>
            <View style={{ flex: 0.8, alignItems: "flex-start" }}><StatusPill active={market.is_active} /></View>
            <Text style={[styles.editLink, { width: 60 }]}>Edit</Text>
          </Pressable>)}
        </View> : !desktop && <View style={{ gap: spacing.sm }}>
          {q.data?.markets.map((market) => <Pressable key={market.code} onPress={() => setForm({ ...market })} style={[styles.mobileCard, form.code === market.code && styles.tableRowSelected]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tablePrimary}>{market.name}</Text>
              <Text style={styles.subtitle}>{market.code} · {market.currency} · {market.minor_digits} decimals</Text>
            </View>
            <StatusPill active={market.is_active} />
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>)}
        </View>}
      </View>

      <View style={styles.editorColumn} testID="market-editor-panel">
        <Panel>
          <View>
            <Text style={styles.editorTitle}>{editing ? `Edit ${form.name}` : "Add Market"}</Text>
            <Text style={styles.subtitle}>{editing ? "Update availability without changing protected currency units." : "Create a country and payout currency pairing."}</Text>
          </View>
          <Field label="Country code (e.g. NG)" value={form.code} onChangeText={(value) => setForm({ ...form, code: value.toUpperCase() })} editable={!editing} />
          <Field label="Country name" value={form.name} onChangeText={(value) => setForm({ ...form, name: value })} />
          <Field label="Currency code (e.g. NGN)" value={form.currency} onChangeText={(value) => setForm({ ...form, currency: value.toUpperCase() })} editable={!editing} />
          <Field label="Currency decimal places" keyboardType="number-pad" value={String(form.minor_digits)} onChangeText={(value) => setForm({ ...form, minor_digits: Number(value) })} editable={!editing} />
          <Toggle label="Active market" value={form.is_active} onChange={(value) => setForm({ ...form, is_active: value })} />
          {editing && <Note>Country code, currency and decimal precision are locked for an existing market by the backend to protect balances.</Note>}
          <Action title={busy ? "Saving…" : editing ? "Save Changes" : "Save Market"} disabled={busy || !form.code.trim() || !form.name.trim() || !form.currency.trim()} onPress={() => { void save(); }} />
          {editing && <Action title="Cancel Edit" onPress={() => setForm({ ...blank })} />}
        </Panel>
      </View>
    </View>
  </AdminPage>;
}

const useStyles = makeStyles((colors) => ({
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" },
  title: { color: colors.onSurface, fontSize: 19, fontWeight: "800" },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
  addButton: { minHeight: 38, paddingHorizontal: 13, borderRadius: radius.md, backgroundColor: colors.brandPrimary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  addButtonText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "800" },
  workspace: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  workspaceMobile: { flexDirection: "column" },
  mainColumn: { flex: 1, minWidth: 0, width: "100%" },
  editorColumn: { width: 360, maxWidth: "100%", flexShrink: 0 },
  editorTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "800" },
  table: { width: "100%", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surface },
  tableHeader: { flexDirection: "row", gap: spacing.md, alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border },
  tableHeading: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  tableRow: { minHeight: 58, flexDirection: "row", gap: spacing.md, alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surface },
  tableRowSelected: { backgroundColor: colors.screenBgAlt },
  tablePrimary: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  tableCode: { color: colors.brandPrimary, fontSize: 12, fontWeight: "800" },
  editLink: { color: colors.brandPrimary, fontSize: 12, fontWeight: "800" },
  statusPill: { minHeight: 24, borderRadius: radius.pill, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  statusActive: { backgroundColor: colors.successBg },
  statusPaused: { backgroundColor: colors.surfaceTertiary },
  statusText: { fontSize: 10, fontWeight: "800" },
  statusTextActive: { color: colors.success },
  statusTextPaused: { color: colors.onSurfaceSecondary },
  mobileCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
}));

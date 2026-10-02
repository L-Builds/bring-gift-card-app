import React, { useState } from "react";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { AdminPage, Panel, Field, Action, Note } from "@/src/components/admin-form";
import { useToast } from "@/src/components/toast";
import { makeStyles, radius, spacing } from "@/src/theme";

type Readiness = {
  checks: Record<string, boolean>;
  configuration_complete: boolean;
  release_note: string;
};

const checkLabels: Record<string, string> = {
  markets: "Active payout markets",
  catalog: "Active gift cards",
  rates: "Headline and trade rates",
  legal: "Reviewed legal documents",
  email: "Email delivery",
  private_storage: "Private upload storage",
  encryption: "Data encryption key",
};

export default function Production() {
  const styles = useStyles();
  const [kind, setKind] = useState("terms");
  const [title, setTitle] = useState("Terms & Conditions");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const readiness = useQuery({
    queryKey: ["readiness"],
    queryFn: () => api.get<Readiness>("/admin/readiness"),
  });

  const load = async (nextKind: string) => {
    setKind(nextKind);
    setTitle(nextKind === "terms" ? "Terms & Conditions" : "Privacy Policy");
    setContent("");
    try {
      const document = await api.get<{ title: string; content: string }>(`/legal/${nextKind}`, false);
      setTitle(document.title);
      setContent(document.content);
    } catch (error) {
      toast.show((error as Error).message, "info");
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/legal/${kind}`, { title, content });
      await readiness.refetch();
      toast.show("Company document published", "success");
    } catch (error) {
      toast.show((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return <AdminPage title="Production Setup">
    <View style={styles.heading}>
      <Text style={styles.title}>Configuration checks</Text>
      <Text style={styles.description}>See which required company settings are configured before release testing.</Text>
    </View>
    <Panel>
      {readiness.isLoading && <Note>Checking configuration…</Note>}
      {readiness.error && <Note>Configuration checks are unavailable: {readiness.error.message}</Note>}
      {readiness.data && <>
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>{readiness.data.configuration_complete ? "All settings configured" : "Setup still needed"}</Text>
          <Text style={styles.summaryText}>{readiness.data.configuration_complete ? "Complete real provider and device testing before release." : "Review the items marked Needs setup below."}</Text>
        </View>
        <View style={styles.checkList}>
          {Object.entries(readiness.data.checks).map(([key, ready]) => <View key={key} style={styles.checkRow}>
            <Text style={styles.checkLabel}>{checkLabels[key] ?? key.replace(/_/g, " ")}</Text>
            <View style={[styles.status, ready ? styles.statusReady : styles.statusNeeded]}>
              <Text style={[styles.statusText, ready ? styles.statusTextReady : styles.statusTextNeeded]}>{ready ? "Ready" : "Needs setup"}</Text>
            </View>
          </View>)}
        </View>
        <Text style={styles.footnote}>{readiness.data.release_note}</Text>
      </>}
    </Panel>
    <Panel>
      <View style={styles.heading}>
        <Text style={styles.title}>Legal documents</Text>
        <Text style={styles.description}>Reviewed Terms of Service and Privacy Policy are bundled with this release. Publishing a document here creates a versioned company override.</Text>
      </View>
      <View style={styles.documentActions}>
        <View style={styles.documentAction}><Action title="Load Terms" onPress={() => { void load("terms"); }} /></View>
        <View style={styles.documentAction}><Action title="Load Privacy Policy" onPress={() => { void load("privacy"); }} /></View>
      </View>
      <Field label="Document title" value={title} onChangeText={setTitle} />
      <Field label="Approved document text" value={content} onChangeText={setContent} multiline style={{ minHeight: 240, textAlignVertical: "top" }} />
      <Action title={busy ? "Publishing…" : `Publish ${kind === "terms" ? "Terms" : "Privacy Policy"}`} disabled={busy || content.length < 40} onPress={() => { void save(); }} />
    </Panel>
  </AdminPage>;
}

const useStyles = makeStyles((colors) => ({
  heading: { gap: 4 },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  description: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 19 },
  summary: { backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, gap: 3 },
  summaryTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  summaryText: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 18 },
  checkList: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden" },
  checkRow: { minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  checkLabel: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  status: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  statusReady: { backgroundColor: colors.successBg },
  statusNeeded: { backgroundColor: colors.warningBg },
  statusText: { fontSize: 11, fontWeight: "800" },
  statusTextReady: { color: colors.success },
  statusTextNeeded: { color: colors.warning },
  footnote: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  documentActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  documentAction: { minWidth: 150, flexGrow: 1 },
}));

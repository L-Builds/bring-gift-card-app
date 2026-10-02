import React, { useState } from "react";
import { Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/toast";
import { AdminPage, Panel, Field, Action, Toggle, Note } from "@/src/components/admin-form";
import { makeStyles, radius, spacing } from "@/src/theme";

type Provider = {
  id: string;
  label: string;
  adapter: string;
  enabled: boolean;
  configured?: boolean;
  available: boolean;
};

const blank = { id: "paystack", label: "Paystack", adapter: "paystack", enabled: false, secret: "", webhook_secret: "" };

export default function Providers() {
  const styles = useStyles();
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();
  const providers = useQuery({
    queryKey: ["payout-providers"],
    queryFn: () => api.get<{ providers: Provider[]; default: string }>("/admin/payout-providers"),
  });

  const run = async (request: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await request();
      await queryClient.invalidateQueries({ queryKey: ["payout-providers"] });
      setForm((current) => ({ ...current, secret: "", webhook_secret: "" }));
      toast.show("Provider settings saved", "success");
    } catch (error) {
      toast.show((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return <AdminPage title="Payout Providers">
    <View style={styles.heading}>
      <Text style={styles.title}>Payout methods</Text>
      <Text style={styles.description}>Company payouts remain available. Paystack and Flutterwave can handle Nigerian naira bank transfers after their credentials and adapter are configured. Other markets use company payout.</Text>
    </View>
    {providers.isLoading && <Panel><Note>Loading payout providers…</Note></Panel>}
    {providers.error && <Panel><Note>Payout providers unavailable: {providers.error.message}</Note><Action title="Retry providers" onPress={() => { void providers.refetch(); }} /></Panel>}
    {!providers.isError && providers.data?.providers.map((provider) => {
      const isManual = provider.id === "manual";
      const isDefault = providers.data.default === provider.id;
      return <Panel key={provider.id}>
        <View style={styles.providerHeader}>
          <View style={styles.providerHeading}>
            <Text style={styles.providerName}>{provider.label}</Text>
            <Text style={styles.providerDetails}>{isManual ? "Company payout" : provider.configured ? "API key stored" : "API key needed"}{!provider.available ? " · Adapter unavailable" : ""}</Text>
          </View>
          <View style={styles.badges}>
            {isDefault && <View style={[styles.badge, styles.defaultBadge]}><Text style={[styles.badgeText, styles.defaultText]}>Default</Text></View>}
            <View style={[styles.badge, provider.enabled ? styles.enabledBadge : styles.disabledBadge]}>
              <Text style={[styles.badgeText, provider.enabled ? styles.enabledText : styles.disabledText]}>{provider.enabled ? "Enabled" : "Disabled"}</Text>
            </View>
          </View>
        </View>
        <View style={styles.actions}>
          {!isManual && <View style={styles.action}><Action title={`Edit ${provider.label}`} onPress={() => setForm({ id: provider.id, label: provider.label, adapter: provider.adapter, enabled: provider.enabled, secret: "", webhook_secret: "" })} /></View>}
          <View style={styles.action}><Action title={isDefault ? "Current default" : "Make default"} disabled={busy || isDefault || !provider.enabled || !provider.available} onPress={() => { void run(() => api.post("/admin/payout-default", { provider_id: provider.id })); }} /></View>
        </View>
      </Panel>;
    })}
    <Panel>
      <View style={styles.heading}>
        <Text style={styles.title}>Configure provider</Text>
        <Text style={styles.description}>Choose a provider template or enter a reviewed adapter. Blank secret fields keep the stored credentials.</Text>
      </View>
      <View style={styles.actions}>
        <View style={styles.action}><Action title="Paystack" onPress={() => setForm(blank)} /></View>
        <View style={styles.action}><Action title="Flutterwave" onPress={() => setForm({ ...blank, id: "flutterwave", label: "Flutterwave", adapter: "flutterwave" })} /></View>
        <View style={styles.action}><Action title="Another provider" onPress={() => setForm({ ...blank, id: "", label: "", adapter: "" })} /></View>
      </View>
      <Field label="Provider ID" value={form.id} onChangeText={(value) => setForm({ ...form, id: value })} />
      <Field label="Display name" value={form.label} onChangeText={(value) => setForm({ ...form, label: value })} />
      <Field label="Adapter" value={form.adapter} onChangeText={(value) => setForm({ ...form, adapter: value })} />
      <Field label="Secret API key (blank keeps existing)" secureTextEntry autoCapitalize="none" value={form.secret} onChangeText={(value) => setForm({ ...form, secret: value })} />
      <Field label="Flutterwave webhook secret (blank keeps existing)" secureTextEntry autoCapitalize="none" value={form.webhook_secret} onChangeText={(value) => setForm({ ...form, webhook_secret: value })} />
      <Toggle label="Enabled" value={form.enabled} onChange={(value) => setForm({ ...form, enabled: value })} />
      <Action title={busy ? "Saving…" : "Save provider"} disabled={busy || !form.id.trim() || !form.label.trim() || !form.adapter.trim()} onPress={() => { void run(() => api.post(`/admin/payout-providers/${form.id}`, form)); }} />
      <View style={styles.webhook}><Text style={styles.webhookLabel}>Webhook URL</Text><Text selectable style={styles.webhookValue}>{api.base}/webhooks/payouts/{form.id || "provider-id"}</Text></View>
    </Panel>
  </AdminPage>;
}

const useStyles = makeStyles((colors) => ({
  heading: { gap: 4 },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  description: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 19 },
  providerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: spacing.md },
  providerHeading: { flex: 1, minWidth: 180, gap: 3 },
  providerName: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  providerDetails: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 18 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  badge: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5 },
  defaultBadge: { backgroundColor: colors.brandSecondary },
  enabledBadge: { backgroundColor: colors.successBg },
  disabledBadge: { backgroundColor: colors.surfaceTertiary },
  badgeText: { fontSize: 10, fontWeight: "800" },
  defaultText: { color: colors.brandPrimary },
  enabledText: { color: colors.success },
  disabledText: { color: colors.onSurfaceSecondary },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  action: { minWidth: 140, flexGrow: 1 },
  webhook: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  webhookLabel: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "700" },
  webhookValue: { color: colors.onSurface, fontSize: 12, lineHeight: 18 },
}));

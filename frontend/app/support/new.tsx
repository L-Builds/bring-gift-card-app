import React, { useState } from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, PrimaryButton, BrandMonogram } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/context/auth";
import { api, ApiError } from "@/src/api/client";
import { formatNaira } from "@/src/lib/format";

type Cat = { key: string; label: string };
type Trade = { id: string; order_id: string; brand_name: string; brand_color: string; status: string; expected_payout_kobo: number };
type Wd = { id: string; ref: string; amount_kobo: number; status: string };

export default function NewTicket() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { isGuest, loading } = useAuth();
  const params = useLocalSearchParams<{ category?: string; subject?: string; ref_type?: string; ref_id?: string }>();

  const [category, setCategory] = useState(params.category || "");
  const [subject, setSubject] = useState(params.subject || "");
  const [message, setMessage] = useState("");
  const [refType, setRefType] = useState<"" | "trade" | "withdrawal">((params.ref_type as any) || "");
  const [refId, setRefId] = useState(params.ref_id || "");
  const [busy, setBusy] = useState(false);

  const { data: meta } = useQuery({ queryKey: ["support-tickets"], queryFn: () => api.get<{ categories: Cat[] }>("/support/tickets"), enabled: !isGuest });
  const { data: trades } = useQuery({ queryKey: ["my-trades"], queryFn: () => api.get<{ trades: Trade[] }>("/trades"), enabled: !isGuest && category === "trade" });
  const { data: wds } = useQuery({ queryKey: ["my-withdrawals"], queryFn: () => api.get<{ withdrawals: Wd[] }>("/withdrawals"), enabled: !isGuest && category === "withdrawal" });

  if (loading) return null;
  if (isGuest) return <Redirect href="/(auth)/login" />;

  const pickCategory = (k: string) => {
    setCategory(k);
    if (k !== "trade" && k !== "withdrawal") { setRefType(""); setRefId(""); }
    else if (k !== refType) { setRefType(k as any); setRefId(""); }
  };

  const submit = async () => {
    if (!category) return toast.show("Choose a topic", "error");
    if (subject.trim().length < 3) return toast.show("Enter a short subject", "error");
    if (message.trim().length < 3) return toast.show("Describe your issue", "error");
    setBusy(true);
    try {
      const t = await api.post<{ id: string; ref: string }>("/support/tickets", {
        subject: subject.trim(), category, message: message.trim(),
        ref_type: refId ? refType : "", ref_id: refId ? refId : "",
      });
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.show(`Ticket ${t.ref} opened — we'll reply in the app`, "success");
      router.replace(`/support/${t.id}`);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not open ticket", "error");
    } finally {
      setBusy(false);
    }
  };

  const refItems: { id: string; title: string; sub: string; color: string }[] =
    category === "trade" ? (trades?.trades ?? []).slice(0, 10).map((t) => ({ id: t.id, title: t.brand_name, sub: `${t.order_id} • ${formatNaira(t.expected_payout_kobo)} • ${t.status.replace(/_/g, " ")}`, color: t.brand_color }))
    : category === "withdrawal" ? (wds?.withdrawals ?? []).slice(0, 10).map((w) => ({ id: w.id, title: "Withdrawal", sub: `${w.ref} • ${formatNaira(w.amount_kobo)} • ${w.status}`, color: colors.brandPrimary }))
    : [];

  return (
    <ScreenBackground>
      <StackHeader title="New Ticket" />
      <KeyboardAwareScrollView bottomOffset={24} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.lg }}>
        <View style={styles.block}>
          <Text style={styles.blockTitle}>What is this about?</Text>
          <View style={styles.chips}>
            {(meta?.categories ?? []).map((c) => {
              const active = category === c.key;
              return (
                <Pressable key={c.key} onPress={() => pickCategory(c.key)} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]} testID={`ticket-cat-${c.key}`}>
                  <Text style={[styles.chipText, { color: active ? colors.onBrandPrimary : colors.onSurface }]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {refItems.length > 0 && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Link a {category} (optional)</Text>
            {refItems.map((r) => {
              const active = refId === r.id;
              return (
                <Pressable key={r.id} style={[styles.refRow, active && styles.refRowActive]} onPress={() => setRefId(active ? "" : r.id)} testID={`ticket-ref-${r.id}`}>
                  <BrandMonogram name={r.title} color={r.color} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.refTitle}>{r.title}</Text>
                    <Text style={styles.refSub} numberOfLines={1}>{r.sub}</Text>
                  </View>
                  <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={20} color={active ? colors.brandPrimary : colors.muted} />
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Details</Text>
          <View style={styles.input}>
            <Ionicons name="text-outline" size={20} color={colors.muted} />
            <TextInput style={styles.inputText} placeholder="Subject" placeholderTextColor={colors.muted} value={subject} onChangeText={setSubject} maxLength={120} testID="ticket-subject" />
          </View>
          <View style={[styles.input, styles.textarea]}>
            <TextInput
              style={[styles.inputText, { minHeight: 120, textAlignVertical: "top" }]}
              placeholder="Describe what happened, including any references or amounts…"
              placeholderTextColor={colors.muted}
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={3000}
              testID="ticket-message"
            />
          </View>
        </View>

        <PrimaryButton title="Send to Support" icon="send" onPress={submit} loading={busy} testID="ticket-submit" />
      </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  block: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, marginTop: spacing.xs },
  blockTitle: { fontWeight: "800", color: colors.onSurface, fontSize: 15, marginBottom: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { height: 38, borderRadius: radius.pill, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipIdle: { backgroundColor: colors.surfaceTertiary },
  chipText: { fontSize: 13, fontWeight: "700" },
  refRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.surface, backgroundColor: colors.surfaceSecondary },
  refRowActive: { borderColor: colors.brandPrimary },
  refTitle: { fontWeight: "800", color: colors.onSurface, fontSize: 14 },
  refSub: { color: colors.muted, fontSize: 12, textTransform: "capitalize" },
  input: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.lg, height: 56 },
  textarea: { height: undefined, alignItems: "flex-start", paddingVertical: spacing.md },
  inputText: { flex: 1, fontSize: 15, color: colors.onSurface },
}));

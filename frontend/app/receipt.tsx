import React, { useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, Platform, Share } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, LoadingView, PrimaryButton, EmptyState } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { api, ApiError } from "@/src/api/client";
import { formatMoney, formatDateTime } from "@/src/lib/format";

type Receipt = {
  currency: string; minor_digits: number;
  kind: "trade" | "withdrawal"; title: string; receipt_no: string; ref: string; status: string; verification_code: string;
  customer: { name: string; email: string }; issued_at: string; created_at: string; completed_at: string;
  lines: { label: string; value: string }[]; total_kobo: number; total_label: string; company: { name: string; support: string };
};

export default function ReceiptScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const shotRef = useRef<View>(null);
  const [busy, setBusy] = useState<"share" | "save" | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["receipt", kind, id],
    queryFn: () => api.get<Receipt>(`/receipts/${kind}/${id}`),
    retry: false,
  });

  const textVersion = (r: Receipt) =>
    [`${r.company.name} — ${r.title}`, `Receipt ${r.receipt_no}`, `${r.total_label}: ${formatMoney(r.total_kobo,r.currency,r.minor_digits)}`,
      ...r.lines.map((l) => `${l.label}: ${l.value}`), `Completed: ${formatDateTime(r.completed_at)}`, `Verification: ${r.verification_code}`].join("\n");

  const capture = async () => {
    if (!shotRef.current) throw new Error("no view");
    return captureRef(shotRef, { format: "png", quality: 1, result: Platform.OS === "web" ? "data-uri" : "tmpfile" });
  };

  const onShare = async () => {
    if (!data) return;
    setBusy("share");
    try {
      const uri = await capture();
      if (Platform.OS === "web") {
        const a = document.createElement("a");
        a.href = uri;
        a.download = `${data.receipt_no}.png`;
        a.click();
        toast.show("Receipt downloaded", "success");
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: `${data.title} ${data.receipt_no}` });
      } else {
        await Share.share({ message: textVersion(data) });
      }
    } catch {
      try {
        await Share.share({ message: textVersion(data) });
      } catch {
        toast.show("Could not share receipt", "error");
      }
    } finally {
      setBusy(null);
    }
  };

  const onCopy = async () => {
    if (!data) return;
    setBusy("save");
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(textVersion(data));
        toast.show("Receipt details copied", "success");
      } else {
        await Share.share({ message: textVersion(data) });
      }
    } catch {
      toast.show("Could not copy", "error");
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) return <ScreenBackground><StackHeader title="Receipt" /><LoadingView /></ScreenBackground>;
  if (error || !data) {
    return (
      <ScreenBackground>
        <StackHeader title="Receipt" />
        <EmptyState icon="receipt-outline" title="Receipt not available" subtitle={error instanceof ApiError ? error.message : "Receipts are issued for approved trades and paid withdrawals."} />
      </ScreenBackground>
    );
  }

  const paid = data.kind === "withdrawal";

  return (
    <ScreenBackground>
      <StackHeader title={data.title} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + 120 }} showsVerticalScrollIndicator={false}>
        <View ref={shotRef} collapsable={false} style={styles.receipt} testID="receipt-card">
          <View style={styles.brandRow}>
            <View style={styles.logo}><Text style={styles.logoText}>B</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.company}>{data.company.name}</Text>
              <Text style={styles.small}>{data.title}</Text>
            </View>
            <View style={styles.stamp}>
              <Ionicons name="checkmark-circle" size={14} color={colors.success} />
              <Text style={styles.stampText}>{paid ? "PAID" : "APPROVED"}</Text>
            </View>
          </View>

          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>{data.total_label}</Text>
            <Text style={styles.total} testID="receipt-total">{formatMoney(data.total_kobo,data.currency,data.minor_digits)}</Text>
            <Text style={styles.receiptNo}>{data.receipt_no}</Text>
          </View>

          <View style={styles.dash} />
          {data.lines.map((l) => (
            <View key={l.label} style={styles.line}>
              <Text style={styles.lineLabel}>{l.label}</Text>
              <Text style={styles.lineValue}>{l.value}</Text>
            </View>
          ))}
          <View style={styles.dash} />
          <View style={styles.line}><Text style={styles.lineLabel}>Customer</Text><Text style={styles.lineValue}>{data.customer.name}</Text></View>
          <View style={styles.line}><Text style={styles.lineLabel}>Email</Text><Text style={styles.lineValue}>{data.customer.email}</Text></View>
          <View style={styles.line}><Text style={styles.lineLabel}>Submitted</Text><Text style={styles.lineValue}>{formatDateTime(data.created_at)}</Text></View>
          <View style={styles.line}><Text style={styles.lineLabel}>{paid ? "Paid" : "Approved"}</Text><Text style={styles.lineValue}>{formatDateTime(data.completed_at)}</Text></View>
          <View style={styles.dash} />
          <View style={styles.footerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.small}>Verification code</Text>
              <Text style={styles.code} testID="receipt-code">{data.verification_code}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.small}>Questions?</Text>
              <Text style={styles.smallStrong}>{data.company.support}</Text>
            </View>
          </View>
          <Text style={styles.issued}>Issued {formatDateTime(data.issued_at)} • Thank you for trading with {data.company.name}</Text>
        </View>
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable style={styles.secondary} onPress={onCopy} disabled={busy !== null} testID="receipt-copy">
          <Ionicons name={Platform.OS === "web" ? "copy-outline" : "document-text-outline"} size={18} color={colors.brandPrimary} />
          <Text style={styles.secondaryText}>{Platform.OS === "web" ? "Copy details" : "Share as text"}</Text>
        </Pressable>
        <PrimaryButton title={Platform.OS === "web" ? "Download image" : "Share receipt"} icon={Platform.OS === "web" ? "download-outline" : "share-social"} onPress={onShare} loading={busy === "share"} style={{ flex: 1.4 }} testID="receipt-share" />
      </View>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  receipt: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.sm, marginTop: spacing.xs },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logo: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  logoText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 20 },
  company: { fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  small: { color: colors.muted, fontSize: 11 },
  smallStrong: { color: colors.onSurface, fontSize: 11, fontWeight: "700" },
  stamp: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.successBg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  stampText: { color: colors.success, fontWeight: "900", fontSize: 11, letterSpacing: 1 },
  totalBox: { alignItems: "center", paddingVertical: spacing.lg },
  totalLabel: { color: colors.muted, fontSize: 12 },
  total: { fontSize: 32, fontWeight: "900", color: colors.onSurface, marginTop: 2 },
  receiptNo: { color: colors.brandPrimary, fontWeight: "700", fontSize: 12, marginTop: 4, letterSpacing: 1 },
  dash: { height: 1, borderTopWidth: 1, borderStyle: "dashed", borderColor: colors.border, marginVertical: spacing.xs },
  line: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: 5 },
  lineLabel: { color: colors.muted, fontSize: 13 },
  lineValue: { color: colors.onSurface, fontWeight: "700", fontSize: 13, maxWidth: "62%", textAlign: "right" },
  footerRow: { flexDirection: "row", alignItems: "flex-end", paddingTop: spacing.xs },
  code: { fontWeight: "900", color: colors.onSurface, fontSize: 16, letterSpacing: 3 },
  issued: { color: colors.muted, fontSize: 10, textAlign: "center", marginTop: spacing.md },
  actions: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.screenBg },
  secondary: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 56, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  secondaryText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 13 },
}));

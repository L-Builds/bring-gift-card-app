import React from "react";
import { View, Text, TextInput, Pressable, ScrollView, Switch } from "react-native";
import { makeStyles, spacing, radius, useTheme } from "@/src/theme";
import { ScreenBackground } from "./ui";
import { StackHeader } from "./stack-header";

export function AdminPage({ title, children }: { title: string; children: React.ReactNode }) {
  return <ScreenBackground><StackHeader title={title} /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 80 }}>{children}</ScrollView></ScreenBackground>;
}
export function Panel({ children }: { children: React.ReactNode }) {
  const s = styles(); return <View style={s.panel}>{children}</View>;
}
export function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  const s = styles(); return <View style={{ gap: 6 }}><Text style={s.label}>{label}</Text><TextInput {...props} accessibilityLabel={label} style={[s.input, props.style]} /></View>;
}
export function Action({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  const s = styles(); return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.action, disabled && { opacity: 0.45 }]}><Text style={s.actionText}>{title}</Text></Pressable>;
}
export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const s = styles(); const {colors}=useTheme(); return <View style={s.row}><Text style={s.label}>{label}</Text><Switch trackColor={{false:colors.border,true:colors.brandPrimary}} thumbColor={colors.surface} accessibilityLabel={label} value={value} onValueChange={onChange} /></View>;
}
export function Note({ children }: { children: React.ReactNode }) { const s=styles(); return <Text style={s.note}>{children}</Text>; }
const styles = makeStyles(c => ({ panel: { backgroundColor: c.surface, padding: spacing.lg, borderRadius: radius.lg, gap: spacing.md }, label: { color: c.onSurface, fontWeight: "700" }, input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 12, color: c.onSurface, backgroundColor: c.surface, minHeight: 46 }, action: { backgroundColor: c.brandPrimary, borderRadius: radius.md, padding: 14, alignItems: "center" }, actionText: { color: "white", fontWeight: "700" }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, note: { color: c.onSurfaceSecondary, lineHeight: 21 } }));

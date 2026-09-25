import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { formatDateTime } from "@/src/lib/format";
import { TicketMessage } from "@/src/lib/support";

/** Chat-style thread shared by the customer and admin ticket screens. */
export function TicketThread({
  messages,
  mySide,
  onSend,
  disabled,
  disabledHint,
  header,
  testID = "thread",
}: {
  messages: TicketMessage[];
  mySide: "customer" | "admin";
  onSend: (body: string) => Promise<void>;
  disabled?: boolean;
  disabledHint?: string;
  header?: React.ReactNode;
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
      <ScrollView ref={scroll} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {header}
        {messages.map((m) => {
          const mine = m.sender === mySide;
          return (
            <View key={m.id} style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]} testID={`${testID}-msg-${m.id}`}>
              {!mine && (
                <View style={styles.avatar}>
                  <Ionicons name={m.sender === "admin" ? "headset" : "person"} size={16} color={colors.brandPrimary} />
                </View>
              )}
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                {!mine && <Text style={styles.sender}>{m.sender_name}</Text>}
                <Text style={[styles.body, mine && { color: colors.onBrandPrimary }]} selectable>{m.body}</Text>
                <Text style={[styles.time, mine && { color: colors.onBrandPrimary, opacity: 0.75 }]}>{formatDateTime(m.created_at)}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
        {disabled ? (
          <View style={styles.closed}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.muted} />
            <Text style={styles.closedText}>{disabledHint ?? "This conversation is closed."}</Text>
          </View>
        ) : (
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder={mySide === "admin" ? "Reply to customer…" : "Write a message…"}
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={3000}
              testID={`${testID}-input`}
            />
            <Pressable style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]} onPress={send} disabled={!text.trim() || sending} testID={`${testID}-send`}>
              {sending ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <Ionicons name="send" size={18} color={colors.onBrandPrimary} />}
            </Pressable>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, maxWidth: "88%" },
  rowMine: { alignSelf: "flex-end" },
  rowTheirs: { alignSelf: "flex-start" },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  bubble: { borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2, flexShrink: 1 },
  bubbleMine: { backgroundColor: colors.brandPrimary, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 6 },
  sender: { color: colors.brandPrimary, fontWeight: "800", fontSize: 11 },
  body: { color: colors.onSurface, fontSize: 15, lineHeight: 21 },
  time: { color: colors.muted, fontSize: 10, marginTop: 2, alignSelf: "flex-end" },
  composer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: colors.screenBg },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  input: { flex: 1, minHeight: 48, maxHeight: 120, backgroundColor: colors.surface, borderRadius: radius.xl, paddingHorizontal: spacing.lg, paddingVertical: 12, fontSize: 15, color: colors.onSurface, borderWidth: 1, borderColor: colors.border },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  closed: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, backgroundColor: colors.surfaceTertiary, borderRadius: radius.xl },
  closedText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
}));

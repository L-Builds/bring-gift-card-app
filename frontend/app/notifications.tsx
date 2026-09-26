import React, { useEffect } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, LoadingView, EmptyState } from "@/src/components/ui";
import { api } from "@/src/api/client";
import { formatDateTime } from "@/src/lib/format";

type Notif = { id: string; title: string; body: string; type: string; ref_id?: string; read: boolean; created_at: string };
const ICON: Record<string, any> = { trade: "swap-horizontal", withdrawal: "cash", security: "shield-checkmark", support: "chatbubbles" };

export default function Notifications() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const router = useRouter();

  const { data, isLoading } = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<{ notifications: Notif[] }>("/notifications") });

  useEffect(() => {
    (async () => {
      await api.post("/notifications/read");
      qc.invalidateQueries({ queryKey: ["notif-unread"] });
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ScreenBackground>
      <StackHeader title="Notifications" />
      {isLoading ? (
        <LoadingView />
      ) : (
        <FlatList
          data={(data?.notifications ?? []).filter((n) => n.type !== "kyc")}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.md }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="notifications-outline" title="No notifications" subtitle="Trade, wallet and withdrawal updates will appear here." />}
          renderItem={({ item }) => (
            <Pressable style={[styles.card, !item.read && styles.unread]} onPress={() => {
              const r = item.ref_id;
              if (item.type === "trade" && r) router.push(`/trade/${r}`);
              else if (item.type === "withdrawal") router.push("/wallet");
              else if (item.type === "support" && r) router.push(`/support/${r}`);
              else if (item.type === "security") router.push("/security/pin");
            }} testID={`notif-${item.id}`}>
              <View style={styles.icon}><Ionicons name={ICON[item.type] || "notifications"} size={20} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.body}>{item.body}</Text>
                <Text style={styles.time}>{formatDateTime(item.created_at)}</Text>
              </View>
              {!item.read && <View style={styles.dot} />}
            </Pressable>
          )}
        />
      )}
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { flexDirection: "row", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  unread: { borderLeftWidth: 3, borderLeftColor: colors.brandPrimary },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  body: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
  time: { color: colors.muted, fontSize: 11, marginTop: 4 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brandPrimary, marginTop: 6 },
}));

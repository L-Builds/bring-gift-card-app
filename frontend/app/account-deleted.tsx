import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { PrimaryButton, ScreenBackground } from "@/src/components/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { takeAccountDeletionCompleted } from "@/src/lib/account-deletion-result";

export default function AccountDeleted() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const checked = useRef(false);
  const [confirmed, setConfirmed] = useState<boolean | null>(null);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    setConfirmed(takeAccountDeletionCompleted());
  }, []);

  if (confirmed === null) return null;
  if (!confirmed) return <Redirect href="/(tabs)" />;

  return (
    <ScreenBackground>
      <View style={[styles.container, { paddingTop: insets.top + spacing.xxxl, paddingBottom: insets.bottom + spacing.xxxl }]} testID="account-deleted-screen">
        <View style={styles.card}>
          <View style={styles.icon}><Ionicons name="checkmark-circle" size={38} color={colors.success} /></View>
          <Text style={styles.title}>Your account is closed</Text>
          <Text style={styles.body}>Your Bring Gift Card customer account has been closed. Personal account data has been removed or anonymized where appropriate. Records required for financial, security or legal reasons may be retained.</Text>
          <PrimaryButton title="Go to sign in" onPress={() => router.replace("/(auth)/login")} testID="account-deleted-login" />
        </View>
      </View>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center", gap: spacing.lg },
  icon: { width: 68, height: 68, borderRadius: 24, backgroundColor: colors.successBg, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 21, fontWeight: "800", color: colors.onSurface, textAlign: "center" },
  body: { fontSize: 14, lineHeight: 21, color: colors.onSurfaceSecondary, textAlign: "center" },
}));

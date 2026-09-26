import React, { useState } from "react";
import { View, Text, Pressable, TextInput, Alert, Linking, Platform, ActivityIndicator } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { makeStyles, useTheme, radius, spacing } from "@/src/theme";
import { StackHeader } from "@/src/components/stack-header";
import { ScreenBackground, PrimaryButton, LoadingView, StatusBadge } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/context/auth";
import { api, uploadImage, fileUrl, ApiError } from "@/src/api/client";
import { formatDateTime } from "@/src/lib/format";

type Kyc = {
  status: string;
  submission: null | {
    id: string; id_type: string; id_type_label: string; id_number_masked: string; full_name: string; dob: string;
    address: string; id_front_path: string; id_back_path: string; selfie_path: string; status: string; reason: string;
    created_at: string; reviewed_at: string | null;
  };
  policy: { id_types: { key: string; label: string }[] };
};

type Slot = "front" | "back" | "selfie";

export default function KycScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { user, isGuest, loading: authLoading, token, refresh } = useAuth();

  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [dob, setDob] = useState("");
  const [address, setAddress] = useState("");
  const [docs, setDocs] = useState<Record<Slot, string>>({ front: "", back: "", selfie: "" });
  const [uploading, setUploading] = useState<Slot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resubmit, setResubmit] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["kyc"], queryFn: () => api.get<Kyc>("/kyc"), enabled: !isGuest });

  if (authLoading) return <ScreenBackground><StackHeader title="Identity Verification" /><LoadingView /></ScreenBackground>;
  if (isGuest) return <Redirect href="/(auth)/login" />;

  const openSettings = () =>
    Alert.alert("Permission needed", "Please allow access in Settings to continue your verification.", [
      { text: "Not now", style: "cancel" },
      { text: "Open Settings", onPress: () => Linking.openSettings() },
    ]);

  const ensurePermission = async (kind: "camera" | "library"): Promise<boolean> => {
    if (Platform.OS === "web") return true;
    const get = kind === "camera" ? ImagePicker.getCameraPermissionsAsync : ImagePicker.getMediaLibraryPermissionsAsync;
    const req = kind === "camera" ? ImagePicker.requestCameraPermissionsAsync : ImagePicker.requestMediaLibraryPermissionsAsync;
    const cur = await get();
    if (cur.granted) return true;
    if (!cur.canAskAgain) {
      openSettings();
      return false;
    }
    const why = kind === "camera"
      ? "We use your camera to take a live selfie that confirms you match your ID."
      : "We need photo access so you can upload a clear picture of your ID document.";
    const proceed = await new Promise<boolean>((resolve) =>
      Alert.alert(kind === "camera" ? "Allow camera access" : "Allow photo access", why, [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        { text: "Continue", onPress: () => resolve(true) },
      ]),
    );
    if (!proceed) return false;
    const res = await req();
    if (res.granted) return true;
    if (!res.canAskAgain) openSettings();
    return false;
  };

  const capture = async (slot: Slot, source: "camera" | "library") => {
    if (!(await ensurePermission(source))) return;
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, allowsEditing: false };
    const res = source === "camera" && Platform.OS !== "web"
      ? await ImagePicker.launchCameraAsync({ ...opts, cameraType: slot === "selfie" ? ImagePicker.CameraType.front : ImagePicker.CameraType.back })
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return;
    setUploading(slot);
    try {
      const path = await uploadImage(res.assets[0].uri);
      setDocs((d) => ({ ...d, [slot]: path }));
    } catch {
      toast.show("Upload failed, please retry", "error");
    } finally {
      setUploading(null);
    }
  };

  const pick = (slot: Slot) => {
    if (Platform.OS === "web") return capture(slot, "library");
    Alert.alert(slot === "selfie" ? "Take a selfie" : "Add ID photo", undefined, [
      { text: "Camera", onPress: () => capture(slot, "camera") },
      { text: "Photo library", onPress: () => capture(slot, "library") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const onSubmit = async () => {
    if (!idType) return toast.show("Select your ID type", "error");
    if (idNumber.trim().length < 4) return toast.show("Enter a valid ID number", "error");
    if (fullName.trim().length < 2) return toast.show("Enter your full legal name", "error");
    if (dob.trim().length < 4) return toast.show("Enter your date of birth", "error");
    if (address.trim().length < 4) return toast.show("Enter your residential address", "error");
    if (!docs.front) return toast.show("Upload the front of your ID", "error");
    if (!docs.selfie) return toast.show("Add a selfie holding your ID", "error");
    setSubmitting(true);
    try {
      await api.post("/kyc", {
        id_type: idType, id_number: idNumber.trim(), full_name: fullName.trim(), dob: dob.trim(), address: address.trim(),
        id_front_path: docs.front, id_back_path: docs.back, selfie_path: docs.selfie,
      });
      await qc.invalidateQueries({ queryKey: ["kyc"] });
      await refresh();
      setResubmit(false);
      toast.show("Verification submitted — we'll review it shortly", "success");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not submit verification", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !data) return <ScreenBackground><StackHeader title="Identity Verification" /><LoadingView /></ScreenBackground>;

  const status = data.status;
  const sub = data.submission;
  const showForm = status === "unverified" || (status === "rejected" && resubmit);

  const DocSlot = ({ slot, label, hint, icon }: { slot: Slot; label: string; hint: string; icon: any }) => (
    <Pressable style={[styles.docSlot, docs[slot] && styles.docSlotDone]} onPress={() => pick(slot)} disabled={uploading !== null} testID={`kyc-doc-${slot}`}>
      {docs[slot] ? (
        <Image source={{ uri: fileUrl(docs[slot], token), headers: token ? { Authorization: `Bearer ${token}` } : undefined }} style={styles.docImg} contentFit="cover" />
      ) : (
        <View style={styles.docIcon}>
          {uploading === slot ? <ActivityIndicator color={colors.brandPrimary} /> : <Ionicons name={icon} size={26} color={colors.brandPrimary} />}
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.docLabel}>{label}</Text>
        <Text style={styles.docHint}>{docs[slot] ? "Uploaded • tap to replace" : hint}</Text>
      </View>
      <Ionicons name={docs[slot] ? "checkmark-circle" : "camera-outline"} size={22} color={docs[slot] ? colors.success : colors.muted} />
    </Pressable>
  );

  const StatusCard = () => {
    const map: Record<string, { icon: any; color: string; bg: string; title: string; body: string }> = {
      verified: { icon: "shield-checkmark", color: colors.success, bg: colors.successBg, title: "Identity verified", body: "Your identity has been reviewed and verified." },
      pending: { icon: "time", color: colors.warning, bg: colors.warningBg, title: "Under review", body: "Our team is reviewing your submitted documents." },
      rejected: { icon: "alert-circle", color: colors.error, bg: colors.errorBg, title: "Verification not approved", body: sub?.reason || "Please review the reason and resubmit your documents." },
      unverified: { icon: "id-card", color: colors.brandPrimary, bg: colors.brandSecondary, title: "Verify your identity", body: "A quick one-time check keeps your account and payouts safe." },
    };
    const s = map[status] ?? map.unverified;
    return (
      <View style={[styles.statusCard, { backgroundColor: s.bg }]} testID={`kyc-status-${status}`}>
        <View style={[styles.statusIcon, { backgroundColor: colors.surface }]}><Ionicons name={s.icon} size={26} color={s.color} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusTitle, { color: s.color }]}>{s.title}</Text>
          <Text style={styles.statusBody}>{s.body}</Text>
        </View>
      </View>
    );
  };

  return (
    <ScreenBackground>
      <StackHeader title="Identity Verification" right={<StatusBadge status={status} />} />
      <KeyboardAwareScrollView bottomOffset={24} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.lg }}>
        <StatusCard />

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Why verify?</Text>
          <View style={styles.limitRow}><Ionicons name="person-circle-outline" size={18} color={colors.brandPrimary} /><Text style={styles.limitText}>Helps the company confirm the identity connected to your account when verification is required.</Text></View>
          <View style={styles.limitRow}><Ionicons name="shield-checkmark-outline" size={18} color={colors.brandPrimary} /><Text style={styles.limitText}>Supports safer account and payout review without assuming unapproved monetary thresholds.</Text></View>
          <View style={styles.limitRow}><Ionicons name="lock-closed-outline" size={18} color={colors.brandPrimary} /><Text style={styles.limitText}>Your documents are stored privately and only reviewed by our compliance team.</Text></View>
        </View>

        {sub && !showForm && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Submitted details</Text>
            {[["ID type", sub.id_type_label], ["ID number", sub.id_number_masked], ["Full name", sub.full_name], ["Date of birth", sub.dob], ["Submitted", formatDateTime(sub.created_at)]].map(([k, v]) => (
              <View key={k} style={styles.detailRow}><Text style={styles.detailKey}>{k}</Text><Text style={styles.detailVal}>{v}</Text></View>
            ))}
            {status === "rejected" && (
              <PrimaryButton title="Resubmit documents" onPress={() => setResubmit(true)} testID="kyc-resubmit" style={{ marginTop: spacing.md }} />
            )}
          </View>
        )}

        {showForm && (
          <>
            <View style={styles.block}>
              <Text style={styles.blockTitle}>1. Choose your ID</Text>
              <View style={styles.chips}>
                {data.policy.id_types.map((t) => {
                  const active = idType === t.key;
                  return (
                    <Pressable key={t.key} onPress={() => setIdType(t.key)} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]} testID={`kyc-idtype-${t.key}`}>
                      <Text style={[styles.chipText, { color: active ? colors.onBrandPrimary : colors.onSurface }]}>{t.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.input}>
                <Ionicons name="card-outline" size={20} color={colors.muted} />
                <TextInput style={styles.inputText} placeholder="ID number" placeholderTextColor={colors.muted} value={idNumber} onChangeText={setIdNumber} autoCapitalize="characters" testID="kyc-idnumber" />
              </View>
            </View>

            <View style={styles.block}>
              <Text style={styles.blockTitle}>2. Personal details</Text>
              <View style={styles.input}>
                <Ionicons name="person-outline" size={20} color={colors.muted} />
                <TextInput style={styles.inputText} placeholder="Full legal name (as on ID)" placeholderTextColor={colors.muted} value={fullName} onChangeText={setFullName} testID="kyc-fullname" />
              </View>
              <View style={styles.input}>
                <Ionicons name="calendar-outline" size={20} color={colors.muted} />
                <TextInput style={styles.inputText} placeholder="Date of birth (DD/MM/YYYY)" placeholderTextColor={colors.muted} value={dob} onChangeText={setDob} keyboardType="numbers-and-punctuation" testID="kyc-dob" />
              </View>
              <View style={[styles.input, { height: undefined, minHeight: 56, paddingVertical: spacing.md, alignItems: "flex-start" }]}>
                <Ionicons name="home-outline" size={20} color={colors.muted} />
                <TextInput style={[styles.inputText, { minHeight: 40 }]} placeholder="Residential address" placeholderTextColor={colors.muted} value={address} onChangeText={setAddress} multiline testID="kyc-address" />
              </View>
            </View>

            <View style={styles.block}>
              <Text style={styles.blockTitle}>3. Upload documents</Text>
              <DocSlot slot="front" label="ID front" hint="Clear photo, all corners visible" icon="id-card-outline" />
              <DocSlot slot="back" label="ID back (optional)" hint="If your ID has details on the back" icon="albums-outline" />
              <DocSlot slot="selfie" label="Selfie with ID" hint="Hold your ID next to your face" icon="happy-outline" />
            </View>

            <PrimaryButton title="Submit for verification" icon="arrow-forward" onPress={onSubmit} loading={submitting} disabled={uploading !== null} testID="kyc-submit" />
            {status === "rejected" && (
              <Pressable onPress={() => setResubmit(false)} style={{ alignSelf: "center" }}><Text style={styles.cancelLink}>Cancel</Text></Pressable>
            )}
          </>
        )}

        {status === "verified" && (
          <PrimaryButton title="Start trading" variant="secondary" icon="arrow-forward" onPress={() => router.replace("/(tabs)/trade")} testID="kyc-start-trading" />
        )}
      </KeyboardAwareScrollView>
    </ScreenBackground>
  );
}

const useStyles = makeStyles((colors) => ({
  statusCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.xs },
  statusIcon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  statusTitle: { fontWeight: "800", fontSize: 16 },
  statusBody: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
  block: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm },
  blockTitle: { fontWeight: "800", color: colors.onSurface, fontSize: 15, marginBottom: spacing.xs },
  limitRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  limitText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 },
  bold: { fontWeight: "800", color: colors.onSurface },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  detailKey: { color: colors.muted, fontSize: 14 },
  detailVal: { color: colors.onSurface, fontWeight: "700", fontSize: 14, maxWidth: "60%", textAlign: "right" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  chip: { height: 38, borderRadius: radius.pill, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipIdle: { backgroundColor: colors.surfaceTertiary },
  chipText: { fontSize: 13, fontWeight: "700" },
  input: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.lg, height: 56 },
  inputText: { flex: 1, fontSize: 15, color: colors.onSurface },
  docSlot: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1.5, borderColor: colors.surfaceSecondary },
  docSlotDone: { borderColor: colors.success },
  docIcon: { width: 56, height: 56, borderRadius: 14, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  docImg: { width: 56, height: 56, borderRadius: 14, backgroundColor: colors.surfaceTertiary },
  docLabel: { fontWeight: "800", color: colors.onSurface, fontSize: 14 },
  docHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
  cancelLink: { color: colors.muted, fontWeight: "700", paddingVertical: spacing.sm },
}));

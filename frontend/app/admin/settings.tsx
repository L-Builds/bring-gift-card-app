import React from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Action, AdminPage, Field, Note } from "@/src/components/admin-form";
import { useAdminConnection } from "@/src/components/admin-connectivity";
import { usePwaInstall } from "@/src/components/web-pwa";
import { ApiError, api } from "@/src/api/client";
import { useAuth, type User } from "@/src/context/auth";
import { browserNotificationPermission, useAdminBrowserPreferences } from "@/src/lib/admin-preferences";
import { STAFF_SCOPES, canManageSettings } from "@/src/lib/staff-access";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

type SettingsRowProps = {
  icon: IconName;
  title: string;
  description: string;
  status?: string;
  onPress?: () => void;
  disabled?: boolean;
};

type SessionResponse = {
  message: string;
  access_token: string;
  user: User;
};

function roleLabel(user: User | null) {
  if (user?.staff_role === "general_manager") return "General Manager";
  if (user?.staff_role === "manager") return "Manager";
  return "Worker";
}

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function timeLabel(value: Date | null) {
  if (!value) return "Not yet";
  return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function SettingsRow({ icon, title, description, status, onPress, disabled = false }: SettingsRowProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const actionable = !!onPress && !disabled;

  return (
    <Pressable
      accessibilityRole={actionable ? "button" : undefined}
      accessibilityLabel={title}
      disabled={!actionable}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && actionable && styles.pressed, disabled && styles.rowDisabled]}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={20} color={colors.brandPrimary} />
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle}>{title}</Text>
          {!!status && <View style={styles.statusPill}><Text style={styles.statusText}>{status}</Text></View>}
        </View>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      {actionable && <Ionicons name="chevron-forward" size={18} color={colors.muted} />}
    </Pressable>
  );
}

function SettingsCard({ title, subtitle, children, testID }: { title: string; subtitle: string; children: React.ReactNode; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.cardHeading}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
      <View style={styles.cardRows}>{children}</View>
    </View>
  );
}

export default function AdminSettings() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { user, replaceSession, refresh } = useAuth();
  const { canInstall, isInstalled, install } = usePwaInstall();
  const connection = useAdminConnection();
  const { preferences, setBrowserNotifications, setSoundAlerts } = useAdminBrowserPreferences(user?.id || "");
  const management = canManageSettings(user);
  const twoColumns = width >= 900;
  const cardWidth = twoColumns ? ("48.8%" as const) : ("100%" as const);
  const name = user?.full_name?.trim() || "Staff account";
  const notificationState = user?.notifications_enabled ? "On" : "Off";
  const browserPermission = browserNotificationPermission();

  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [passwordBusy, setPasswordBusy] = React.useState(false);
  const [passwordError, setPasswordError] = React.useState("");
  const [passwordSuccess, setPasswordSuccess] = React.useState("");

  const [securityOpen, setSecurityOpen] = React.useState(false);
  const [sessionPassword, setSessionPassword] = React.useState("");
  const [sessionBusy, setSessionBusy] = React.useState(false);
  const [sessionError, setSessionError] = React.useState("");
  const [sessionSuccess, setSessionSuccess] = React.useState("");

  const [preferenceBusy, setPreferenceBusy] = React.useState(false);
  const [accountPreferenceMessage, setAccountPreferenceMessage] = React.useState("");
  const [accountPreferenceError, setAccountPreferenceError] = React.useState("");
  const [devicePreferenceMessage, setDevicePreferenceMessage] = React.useState("");
  const [devicePreferenceError, setDevicePreferenceError] = React.useState("");

  const changePassword = async () => {
    setPasswordError("");
    setPasswordSuccess("");
    if (!currentPassword) return setPasswordError("Enter your current password.");
    if (newPassword.length < 12 || !newPassword.endsWith("@admin")) {
      return setPasswordError("Admin passwords must be at least 12 characters and end with @admin.");
    }
    if (newPassword !== confirmPassword) return setPasswordError("The new passwords do not match.");
    if (newPassword === currentPassword) return setPasswordError("Choose a new password that is different from the current password.");

    setPasswordBusy(true);
    try {
      const result = await api.post<SessionResponse>("/auth/password/change", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      await replaceSession(result.access_token, result.user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess(result.message);
    } catch (error) {
      setPasswordError(errorMessage(error));
    } finally {
      setPasswordBusy(false);
    }
  };

  const revokeOtherSessions = async () => {
    setSessionError("");
    setSessionSuccess("");
    if (!sessionPassword) return setSessionError("Enter your current password to continue.");

    setSessionBusy(true);
    try {
      const result = await api.post<SessionResponse>("/auth/sessions/revoke-others", {
        current_password: sessionPassword,
      });
      await replaceSession(result.access_token, result.user);
      setSessionPassword("");
      setSessionSuccess(result.message);
    } catch (error) {
      setSessionError(errorMessage(error));
    } finally {
      setSessionBusy(false);
    }
  };

  const toggleAdminNotifications = async () => {
    if (preferenceBusy) return;
    setPreferenceBusy(true);
    setAccountPreferenceError("");
    setAccountPreferenceMessage("");
    try {
      await api.patch("/auth/admin-notifications", { notifications_enabled: !user?.notifications_enabled });
      await refresh();
      setAccountPreferenceMessage(`Admin work alerts ${user?.notifications_enabled ? "disabled" : "enabled"}.`);
    } catch (error) {
      setAccountPreferenceError(errorMessage(error));
    } finally {
      setPreferenceBusy(false);
    }
  };

  const toggleBrowserNotifications = async () => {
    if (preferenceBusy) return;
    setPreferenceBusy(true);
    setDevicePreferenceError("");
    setDevicePreferenceMessage("");
    try {
      const result = await setBrowserNotifications(!preferences.browserNotifications);
      if (!result.enabled && result.permission === "denied") {
        setDevicePreferenceError("Browser notifications are blocked for this site. Allow them in your browser settings, then try again.");
      } else if (!result.enabled && result.permission === "unsupported") {
        setDevicePreferenceError("This browser does not support page notifications for Bring Admin.");
      } else {
        setDevicePreferenceMessage(result.enabled ? "Browser work alerts enabled on this device." : "Browser work alerts disabled on this device.");
      }
    } finally {
      setPreferenceBusy(false);
    }
  };

  const toggleSoundAlerts = async () => {
    if (preferenceBusy) return;
    setPreferenceBusy(true);
    setDevicePreferenceError("");
    setDevicePreferenceMessage("");
    try {
      const enabled = !preferences.soundAlerts;
      await setSoundAlerts(enabled);
      setDevicePreferenceMessage(`Sound alerts ${enabled ? "enabled" : "disabled"} on this device.`);
    } finally {
      setPreferenceBusy(false);
    }
  };

  const workerScopes = STAFF_SCOPES.filter((scope) => user?.staff_permissions?.includes(scope.key)).map((scope) => scope.label);
  const accessDescription = user?.staff_role === "general_manager"
    ? "Full company management access, including managers, workers and company configuration."
    : user?.staff_role === "manager"
      ? "Company management access. Managers can create and manage Workers, but cannot create or change Managers or the General Manager."
      : workerScopes.length
        ? `Worker access is limited to: ${workerScopes.join(", ")}. Company management controls stay hidden.`
        : "Worker account with no operational work areas assigned yet. Personal settings remain available.";

  const connectionStatus = connection.status === "online" ? "Online" : connection.status === "checking" ? "Checking" : connection.status === "offline" ? "Offline" : "Unavailable";
  const installStatus = isInstalled ? "Installed" : canInstall ? "Available" : "Browser menu";

  return (
    <AdminPage title="Settings">
      <View style={styles.intro}>
        <Text style={styles.eyebrow}>ADMIN SETTINGS</Text>
        <Text style={styles.heading}>Account, security and company configuration</Text>
        <Text style={styles.introText}>Personal settings stay available to every staff member. Company-wide controls are shown only to roles allowed to manage them.</Text>
      </View>

      <View style={styles.grid}>
        <View style={{ width: cardWidth }}>
          <SettingsCard title="My Account" subtitle="Your signed-in company identity and account security." testID="settings-my-account">
            <SettingsRow
              icon="person-circle-outline"
              title={name}
              description={`${user?.email || "No email"} · ${roleLabel(user)}`}
              status="Signed in"
            />
            <SettingsRow
              icon="key-outline"
              title="Change Password"
              description="Verify your current password, then choose a new admin password."
              status={passwordOpen ? "Open" : "Protected"}
              onPress={() => {
                setPasswordOpen(value => !value);
                setPasswordError("");
                setPasswordSuccess("");
              }}
            />
            {passwordOpen && <View style={styles.formPanel} testID="settings-change-password-form">
              <Field label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
              <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
              <Field label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
              <Note>Admin passwords must be at least 12 characters and end with @admin. Changing your password logs out older sessions while this device receives a fresh session.</Note>
              {!!passwordError && <Text style={styles.errorText} accessibilityRole="alert">{passwordError}</Text>}
              {!!passwordSuccess && <Text style={styles.successText} accessibilityRole="alert">{passwordSuccess}</Text>}
              <Action title={passwordBusy ? "Changing password…" : "Change password"} onPress={() => { void changePassword(); }} disabled={passwordBusy} />
            </View>}
            <SettingsRow
              icon="shield-checkmark-outline"
              title="Security & Sessions"
              description="Log out other browsers and devices without signing out this one."
              status={securityOpen ? "Open" : "Protected"}
              onPress={() => {
                setSecurityOpen(value => !value);
                setSessionError("");
                setSessionSuccess("");
              }}
            />
            {securityOpen && <View style={styles.formPanel} testID="settings-security-sessions-form">
              <Text style={styles.formTitle}>Log out other sessions</Text>
              <Text style={styles.formText}>Use this if you signed in on another computer or phone, or if you think another device still has access. Your current browser stays signed in.</Text>
              <Field label="Current password" value={sessionPassword} onChangeText={setSessionPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
              {!!sessionError && <Text style={styles.errorText} accessibilityRole="alert">{sessionError}</Text>}
              {!!sessionSuccess && <Text style={styles.successText} accessibilityRole="alert">{sessionSuccess}</Text>}
              <Action title={sessionBusy ? "Logging out other sessions…" : "Log out other sessions"} onPress={() => { void revokeOtherSessions(); }} disabled={sessionBusy} />
            </View>}
          </SettingsCard>
        </View>

        <View style={{ width: cardWidth }}>
          <SettingsCard title="Notifications" subtitle="Control work-queue alerts for this staff account." testID="settings-notifications">
            <SettingsRow
              icon="notifications-outline"
              title="Admin work alerts"
              description="Allow new assigned work to trigger optional browser and sound alerts. Queue counts remain visible even when alerts are off."
              status={notificationState}
              onPress={() => { void toggleAdminNotifications(); }}
              disabled={preferenceBusy}
            />
            {!!accountPreferenceError && <View style={styles.inlineMessage}><Text style={styles.errorText} accessibilityRole="alert">{accountPreferenceError}</Text></View>}
            {!!accountPreferenceMessage && <View style={styles.inlineMessage}><Text style={styles.successText} accessibilityRole="alert">{accountPreferenceMessage}</Text></View>}
          </SettingsCard>
        </View>

        <View style={{ width: cardWidth }}>
          <SettingsCard title="Browser / App Preferences" subtitle="Device-specific alert choices for the browser or installed admin app." testID="settings-browser-preferences">
            <SettingsRow
              icon="desktop-outline"
              title="Browser notifications"
              description={browserPermission === "denied" ? "Blocked by this browser. Change the site notification permission before enabling it." : "Show a desktop notification when new work enters one of your visible queues while Bring Admin is open or installed."}
              status={browserPermission === "unsupported" ? "Unsupported" : browserPermission === "denied" ? "Blocked" : preferences.browserNotifications ? "On" : "Off"}
              onPress={() => { void toggleBrowserNotifications(); }}
              disabled={preferenceBusy || browserPermission === "unsupported"}
            />
            <SettingsRow
              icon="volume-medium-outline"
              title="Sound alerts"
              description="Play a short local sound when the visible work-queue total increases."
              status={preferences.soundAlerts ? "On" : "Off"}
              onPress={() => { void toggleSoundAlerts(); }}
              disabled={preferenceBusy}
            />
            {!!devicePreferenceError && <View style={styles.inlineMessage}><Text style={styles.errorText} accessibilityRole="alert">{devicePreferenceError}</Text></View>}
            {!!devicePreferenceMessage && <View style={styles.inlineMessage}><Text style={styles.successText} accessibilityRole="alert">{devicePreferenceMessage}</Text></View>}
            <View style={styles.notePanel}><Note>Browser and sound preferences are saved on this device. They do not change another worker's browser settings.</Note></View>
          </SettingsCard>
        </View>

        {management && <View style={{ width: cardWidth }}>
          <SettingsCard title="Company Configuration" subtitle="Controls that affect the whole Bring Gift Card operation." testID="settings-company-configuration">
            <SettingsRow
              icon="document-text-outline"
              title="Production & Legal"
              description="Review production readiness and published legal documents."
              onPress={() => router.push("/admin/production")}
            />
            <SettingsRow
              icon="card-outline"
              title="Payout Providers"
              description="Manage approved payout provider configuration."
              onPress={() => router.push("/admin/payout-providers")}
            />
            <SettingsRow
              icon="globe-outline"
              title="Markets & Currencies"
              description="Manage active markets, currencies and precision."
              onPress={() => router.push("/admin/markets")}
            />
          </SettingsCard>
        </View>}

        <View style={{ width: cardWidth }}>
          <SettingsCard title="Install / Admin App" subtitle="Use Bring Admin from a supported browser or install it as an app-like workspace." testID="settings-admin-app">
            {isInstalled ? (
              <SettingsRow
                icon="checkmark-circle-outline"
                title="Bring Admin is installed"
                description="This device is currently running the standalone admin workspace."
                status="Installed"
              />
            ) : Platform.OS === "web" && canInstall ? (
              <SettingsRow
                icon="download-outline"
                title="Install Bring Admin"
                description="Install this admin workspace on this computer using the browser install prompt."
                status="Available"
                onPress={() => { void install(); }}
              />
            ) : (
              <SettingsRow
                icon="desktop-outline"
                title="Bring Admin"
                description={Platform.OS === "web" ? "Use the browser Install app option when it is offered for this site." : "The installable admin workspace is intended for supported desktop browsers."}
                status={installStatus}
              />
            )}
            <SettingsRow
              icon="information-circle-outline"
              title="Admin workspace"
              description="Desktop-first company tools remain available in the browser without changing the customer app."
            />
          </SettingsCard>
        </View>

        <View style={{ width: cardWidth }}>
          <SettingsCard title="Connectivity & Refresh" subtitle="Live connection state and automatic data-refresh behavior." testID="settings-connectivity">
            <SettingsRow
              icon={connection.status === "online" ? "cloud-done-outline" : "cloud-offline-outline"}
              title="API connection"
              description={`Last health check: ${timeLabel(connection.lastCheckedAt)}. Last successful admin data sync: ${timeLabel(connection.lastSyncedAt)}.`}
              status={connectionStatus}
              onPress={() => { void connection.checkNow(); }}
            />
            <SettingsRow
              icon="sync-outline"
              title="Automatic data refresh"
              description="Active admin data refreshes about every 15 seconds. The API connection is checked about every 30 seconds and when the browser returns to focus."
              status="Automatic"
            />
            <SettingsRow
              icon="refresh-outline"
              title="Refresh now"
              description="Check the API and refresh active admin data immediately."
              status={connection.refreshing ? "Refreshing" : "Ready"}
              onPress={() => { void connection.refreshNow(); }}
              disabled={connection.refreshing}
            />
          </SettingsCard>
        </View>

        <View style={{ width: cardWidth }}>
          <SettingsCard title="Access & Permissions" subtitle="Your role controls which company areas appear and which API actions are allowed." testID="settings-access-rules">
            <SettingsRow
              icon="shield-outline"
              title={roleLabel(user)}
              description={accessDescription}
              status={user?.staff_role === "general_manager" ? "Full access" : user?.staff_role === "manager" ? "Management" : `${workerScopes.length} assigned`}
            />
            {user?.staff_role === "worker" && STAFF_SCOPES.map((scope) => (
              <SettingsRow
                key={scope.key}
                icon={user.staff_permissions?.includes(scope.key) ? "checkmark-circle-outline" : "remove-circle-outline"}
                title={scope.label}
                description={scope.description}
                status={user.staff_permissions?.includes(scope.key) ? "Assigned" : "No access"}
              />
            ))}
          </SettingsCard>
        </View>
      </View>

      {!management && <View style={styles.permissionNote} testID="settings-limited-role-note">
        <Ionicons name="lock-closed-outline" size={18} color={colors.muted} />
        <Text style={styles.permissionText}>Company-wide configuration is hidden for this role. Your manager controls access to management settings.</Text>
      </View>}
    </AdminPage>
  );
}

const useStyles = makeStyles((c) => ({
  intro: { gap: 6, marginBottom: spacing.sm },
  eyebrow: { color: c.brandPrimary, fontSize: 10, fontWeight: "800", letterSpacing: 1.35 },
  heading: { color: c.onSurface, fontSize: 22, fontWeight: "800", lineHeight: 28 },
  introText: { color: c.onSurfaceSecondary, fontSize: 13, lineHeight: 20, maxWidth: 720 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.lg },
  card: { width: "100%", backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 16, overflow: "hidden" },
  cardHeading: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.divider, gap: 4 },
  cardTitle: { color: c.onSurface, fontSize: 15, fontWeight: "800" },
  cardSubtitle: { color: c.muted, fontSize: 11, lineHeight: 17 },
  cardRows: { width: "100%" },
  row: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: c.divider },
  rowDisabled: { opacity: 0.68 },
  rowIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: c.brandSecondary, flexShrink: 0 },
  rowCopy: { flex: 1, minWidth: 0, gap: 4 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  rowTitle: { color: c.onSurface, fontSize: 13, fontWeight: "800", flexShrink: 1 },
  rowDescription: { color: c.onSurfaceSecondary, fontSize: 11, lineHeight: 17 },
  statusPill: { borderRadius: 999, backgroundColor: c.surfaceTertiary, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { color: c.onSurfaceTertiary, fontSize: 9, fontWeight: "800" },
  pressed: { opacity: 0.72, backgroundColor: c.surfaceSecondary },
  formPanel: { gap: spacing.md, padding: spacing.lg, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.surfaceSecondary },
  formTitle: { color: c.onSurface, fontSize: 13, fontWeight: "800" },
  formText: { color: c.onSurfaceSecondary, fontSize: 11, lineHeight: 18 },
  inlineMessage: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider },
  notePanel: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.surfaceSecondary },
  errorText: { color: c.error, fontSize: 11, lineHeight: 17, fontWeight: "700" },
  successText: { color: c.success, fontSize: 11, lineHeight: 17, fontWeight: "700" },
  permissionNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderRadius: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, padding: spacing.md },
  permissionText: { flex: 1, color: c.onSurfaceSecondary, fontSize: 11, lineHeight: 17 },
}));

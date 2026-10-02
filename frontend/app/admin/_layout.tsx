import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@react-native-vector-icons/ionicons";

import { useAuth, type User } from "@/src/context/auth";
import { api } from "@/src/api/client";
import { useAdminConnection } from "@/src/components/admin-connectivity";
import { usePwaInstall } from "@/src/components/web-pwa";
import { canManageSettings, canManageStaff, canWorkIn } from "@/src/lib/staff-access";
import { playAdminAlertTone, showAdminBrowserNotification, useAdminBrowserPreferences } from "@/src/lib/admin-preferences";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
type NavItem = { label: string; href: string; icon: IconName; visible: (user: User | null) => boolean };
const management = canManageSettings;
const navigation: { label: string; items: NavItem[] }[] = [
  { label: "Workspace", items: [
    { label: "Dashboard", href: "/admin", icon: "grid-outline", visible: (u) => u?.role === "admin" },
    { label: "Trades", href: "/admin/trades", icon: "swap-horizontal-outline", visible: (u) => canWorkIn(u, "trades") },
    { label: "Withdrawals", href: "/admin/withdrawals", icon: "cash-outline", visible: (u) => canWorkIn(u, "withdrawals") },
    { label: "Customers", href: "/admin/customers", icon: "people-outline", visible: (u) => canWorkIn(u, "customers") },
    { label: "Verification", href: "/admin/verification", icon: "shield-checkmark-outline", visible: (u) => canWorkIn(u, "customers") },
    { label: "Support", href: "/admin/support", icon: "chatbubbles-outline", visible: (u) => canWorkIn(u, "support") },
  ] },
  { label: "Management", items: [
    { label: "Catalog", href: "/admin/catalog", icon: "albums-outline", visible: management },
    { label: "Rates", href: "/admin/rates", icon: "pricetags-outline", visible: management },
    { label: "Markets", href: "/admin/markets", icon: "globe-outline", visible: management },
    { label: "Staff", href: "/admin/staff", icon: "people-circle-outline", visible: canManageStaff },
    { label: "Deletion requests", href: "/admin/account-deletion", icon: "person-remove-outline", visible: management },
    { label: "Reports", href: "/admin/reports", icon: "bar-chart-outline", visible: management },
    { label: "Settings", href: "/admin/settings", icon: "settings-outline", visible: (u) => u?.role === "admin" },
  ] },
];

const titleByRoute: Record<string, string> = {
  "": "Dashboard", trade: "Trade details", trades: "Trades", withdrawals: "Withdrawals",
  customer: "Customer details", customers: "Customers", verification: "Verification",
  kyc: "Verification", support: "Support", catalog: "Catalog", rates: "Rates",
  markets: "Markets", staff: "Staff", "account-deletion": "Deletion requests", reports: "Reports", settings: "Settings",
  "rate-history": "Rate history", production: "Production setup", "payout-providers": "Payout providers",
};

function parentRoute(path: string) {
  if (path.startsWith("/admin/trade/")) return "/admin/trades";
  if (path.startsWith("/admin/customer/")) return "/admin/customers";
  if (path.startsWith("/admin/kyc/")) return "/admin/verification";
  if (path.startsWith("/admin/support/")) return "/admin/support";
  if (path === "/admin/rate-history") return "/admin/rates";
  if (path === "/admin/production" || path === "/admin/payout-providers") return "/admin/settings";
  return path === "/admin" || path === "/admin/" ? null : "/admin";
}

function selectedRoute(path: string) {
  return parentRoute(path) && (path.split("/").length > 3 || ["/admin/rate-history", "/admin/production", "/admin/payout-providers"].includes(path))
    ? parentRoute(path) : path.replace(/\/$/, "") || "/admin";
}

function staffRole(user: User | null) {
  if (user?.staff_role === "general_manager") return "General Manager";
  return user?.staff_role === "manager" ? "Manager" : "Worker";
}

function updatedLabel(value: Date | null, now: number) {
  if (!value) return "Awaiting check";
  const elapsed = Math.max(0, Math.floor((now - value.getTime()) / 1000));
  if (elapsed < 5) return "Updated just now";
  return elapsed < 60 ? `Updated ${elapsed}s ago` : `Updated ${Math.floor(elapsed / 60)}m ago`;
}

export default function AdminLayout() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { status, lastCheckedAt, lastSyncedAt, refreshing, checkNow, refreshNow } = useAdminConnection();
  const { canInstall, install } = usePwaInstall();
  const { preferences } = useAdminBrowserPreferences(user?.id || "");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [topMenu, setTopMenu] = useState<"queues" | "account" | null>(null);
  const [reconnected, setReconnected] = useState(false);
  const previousStatus = useRef(status);
  const previousAttentionCount = useRef<number | null>(null);
  const [now, setNow] = useState(0);
  const desktop = width >= 1024;
  const compact = width < 800;
  const name = user?.full_name?.trim() || user?.email?.split("@")[0] || "Staff";
  const initial = name.charAt(0).toUpperCase();
  const title = titleByRoute[pathname.split("/")[2] ?? ""] ?? "Admin";
  const back = parentRoute(pathname);
  const selected = selectedRoute(pathname);
  const groups = useMemo(() => navigation.map((group) => ({ ...group, items: group.items.filter((item) => item.visible(user)) })).filter((group) => group.items.length), [user]);
  const queueStats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get<{ pending_trades: number; pending_withdrawals: number; open_tickets: number }>("/admin/stats"),
    enabled: user?.role === "admin",
  });
  const queueItems = useMemo(() => [
    { label: "Pending trades", href: "/admin/trades", count: queueStats.data?.pending_trades, visible: canWorkIn(user, "trades"), icon: "swap-horizontal-outline" as IconName, note: "Awaiting review" },
    { label: "Payout requests", href: "/admin/withdrawals", count: queueStats.data?.pending_withdrawals, visible: canWorkIn(user, "withdrawals"), icon: "cash-outline" as IconName, note: "Pending or processing" },
    { label: "Open support", href: "/admin/support", count: queueStats.data?.open_tickets, visible: canWorkIn(user, "support"), icon: "chatbubbles-outline" as IconName, note: "Customer tickets" },
  ].filter((item) => item.visible), [queueStats.data?.open_tickets, queueStats.data?.pending_trades, queueStats.data?.pending_withdrawals, user]);
  const attentionCount = queueItems.reduce((total, item) => total + (item.count || 0), 0);

  useEffect(() => {
    previousAttentionCount.current = null;
  }, [user?.id]);
  useEffect(() => {
    if (!queueStats.data) return;
    if (previousAttentionCount.current == null) {
      previousAttentionCount.current = attentionCount;
      return;
    }
    const increase = attentionCount - previousAttentionCount.current;
    previousAttentionCount.current = attentionCount;
    if (increase <= 0 || !user?.notifications_enabled) return;
    if (preferences.soundAlerts) playAdminAlertTone();
    if (preferences.browserNotifications) {
      const details = queueItems.filter((item) => (item.count || 0) > 0).map((item) => `${item.label}: ${item.count}`).join(" · ");
      showAdminBrowserNotification("Bring Gift Card Admin", `${increase} new work item${increase === 1 ? "" : "s"} need attention${details ? `. ${details}` : "."}`);
    }
  }, [attentionCount, preferences.browserNotifications, preferences.soundAlerts, queueItems, queueStats.data, user?.notifications_enabled]);

  useEffect(() => {
    const id = setTimeout(() => { setDrawerOpen(false); setTopMenu(null); }, 0);
    return () => clearTimeout(id);
  }, [pathname]);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 10000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, []);
  useEffect(() => {
    const wasDisconnected = previousStatus.current === "offline" || previousStatus.current === "unavailable";
    previousStatus.current = status;
    if (!wasDisconnected || status !== "online") return;
    const start = setTimeout(() => setReconnected(true), 0);
    const id = setTimeout(() => setReconnected(false), 5000);
    return () => { clearTimeout(start); clearTimeout(id); };
  }, [status]);
  useEffect(() => {
    if (Platform.OS !== "web" || (!drawerOpen && !topMenu)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDrawerOpen(false);
      setTopMenu(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, topMenu]);

  const go = (href: string) => { setDrawerOpen(false); setTopMenu(null); if (href !== pathname) router.push(href as never); };
  const signOut = async () => { setDrawerOpen(false); setTopMenu(null); await logout(); router.replace("/(auth)/login"); };
  const sidebar = <View style={styles.sidebar}>
    <ScrollView contentContainerStyle={styles.sidebarScroll} showsVerticalScrollIndicator={false}>
      {groups.map((group) => <View key={group.label} style={styles.navGroup}>
        <Text style={styles.groupLabel}>{group.label.toUpperCase()}</Text>
        {group.items.map((item) => {
          const active = selected === item.href;
          return <Pressable key={item.href} onPress={() => go(item.href)} accessibilityRole="link" accessibilityLabel={item.label}
            accessibilityState={{ selected: active }} testID={`admin-nav-${item.label.toLowerCase()}`}
            style={({ pressed }) => [styles.navItem, active && styles.navItemActive, pressed && styles.pressed]}>
            <Ionicons name={item.icon} size={19} color={active ? colors.brandPrimary : colors.onSurfaceSecondary} />
            <Text style={[styles.navText, active && styles.navTextActive]}>{item.label}</Text>
          </Pressable>;
        })}
      </View>)}
    </ScrollView>
    <View style={styles.sidebarFooter}>
      <View style={styles.identity}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
        <View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.staffName}>{name}</Text><Text style={styles.staffRole}>{staffRole(user)}</Text></View>
      </View>
      <Pressable onPress={() => { void signOut(); }} accessibilityRole="button" accessibilityLabel="Log out" style={({ pressed }) => [styles.logout, pressed && styles.pressed]}>
        <Ionicons name="log-out-outline" size={19} color={colors.onSurfaceSecondary} /><Text style={styles.logoutText}>Log out</Text>
      </Pressable>
    </View>
  </View>;

  const online = status === "online";
  const statusColor = online ? colors.success : status === "checking" ? colors.warning : colors.error;
  const statusText = online ? "Online" : status === "checking" ? "Checking" : status === "unavailable" ? "Unavailable" : "Offline";

  return <View style={[styles.shell, { paddingTop: insets.top }]}>
    <View style={styles.topbar}>
      {!desktop && <Pressable onPress={() => setDrawerOpen(true)} accessibilityRole="button" accessibilityLabel="Open admin menu" testID="admin-menu-open" style={styles.iconButton}>
        <Ionicons name="menu" size={24} color={colors.brandDeep} />
      </Pressable>}
      <View style={[styles.brand, desktop && styles.brandDesktop]}>
        <Image source={require("../../assets/brand/logo-blue.png")} resizeMode="contain" style={styles.brandMark} accessibilityLabel="Bring Gift Card logo" />
        <Text numberOfLines={1} style={styles.brandName}>{compact ? "Bring Admin" : "Bring Gift Card Admin"}</Text>
      </View>
      {back && <Pressable onPress={() => router.replace(back as never)} accessibilityRole="button" accessibilityLabel={`Back to ${titleByRoute[back.split("/")[2] ?? ""] ?? "Dashboard"}`} testID="admin-back" style={styles.backButton}>
        <Ionicons name="arrow-back" size={19} color={colors.brandDeep} />
      </Pressable>}
      {!compact && <Text style={styles.pageTitle} numberOfLines={1}>{title}</Text>}
      <View style={styles.topActions}>
        <Pressable onPress={() => { void checkNow(); }} accessibilityRole="button" accessibilityLabel={`${statusText}. Connection ${updatedLabel(lastCheckedAt, now).toLowerCase()}. Check connection`} testID="admin-connection-status" style={styles.connection}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <View><Text style={[styles.connectionText, { color: statusColor }]}>{statusText}</Text>{!compact && <Text style={styles.lastCheck}>{refreshing ? "Refreshing data…" : lastSyncedAt ? `Auto refresh · ${updatedLabel(lastSyncedAt, now)}` : "Awaiting data"}</Text>}</View>
        </Pressable>
        {!compact && <Pressable onPress={() => { void refreshNow(); }} accessibilityRole="button" accessibilityLabel="Refresh admin data" style={styles.iconButton}>
          {refreshing ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Ionicons name="refresh-outline" size={20} color={colors.onSurfaceSecondary} />}
        </Pressable>}
        <Pressable onPress={() => setTopMenu(topMenu === "queues" ? null : "queues")} accessibilityRole="button" accessibilityLabel="Open work queues" testID="admin-queues-menu" style={styles.iconButton}>
          <Ionicons name="notifications-outline" size={21} color={colors.onSurfaceSecondary} />
          {attentionCount > 0 && <View style={styles.alertBadge}><Text style={styles.alertBadgeText}>{attentionCount > 99 ? "99+" : attentionCount}</Text></View>}
        </Pressable>
        {canInstall && <Pressable onPress={() => { void install(); }} accessibilityRole="button" accessibilityLabel="Install Bring Admin" style={styles.installButton}>
          <Ionicons name="download-outline" size={17} color={colors.brandPrimary} />{!compact && <Text style={styles.installText}>Install</Text>}
        </Pressable>}
        {desktop && <Pressable onPress={() => setTopMenu(topMenu === "account" ? null : "account")} accessibilityRole="button" accessibilityLabel="Open account menu" testID="admin-account-menu" style={styles.topAccount}>
          <View style={styles.topAvatar}><Text style={styles.topAvatarText}>{initial}</Text></View>
          <Text style={styles.topAccountName} numberOfLines={1}>{name.split(/\s+/)[0]}</Text>
          <Ionicons name="chevron-down" size={13} color={colors.muted} />
        </Pressable>}
      </View>
    </View>
    {(status === "offline" || status === "unavailable" || reconnected) && <View style={[styles.banner, reconnected && status === "online" && styles.bannerOnline]} accessibilityRole="alert">
      <Ionicons name={status === "online" ? "checkmark-circle-outline" : "cloud-offline-outline"} size={18} color={status === "online" ? colors.success : colors.error} />
      <Text style={styles.bannerText}>{status === "offline" ? "Offline. Data may be stale; reconnect to refresh before making changes." : status === "unavailable" ? "Cannot reach the service. Retry connection." : "Back online. Refreshing current data."}</Text>
      {status !== "online" && <Pressable onPress={() => { void checkNow(); }} accessibilityRole="button" accessibilityLabel="Retry connection"><Text style={styles.retryText}>Retry</Text></Pressable>}
    </View>}
    <View style={styles.body}>
      {desktop && sidebar}
      <View style={styles.content}>
        {compact && <View style={styles.mobileTitleRow}><Text style={styles.mobileTitle}>{title}</Text></View>}
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.screenBg } }} />
      </View>
    </View>
    {drawerOpen && <View style={[styles.drawerLayer, { top: insets.top }]}>
      <Pressable style={styles.scrim} onPress={() => setDrawerOpen(false)} accessibilityRole="button" accessibilityLabel="Close admin menu" testID="admin-menu-scrim" />
      <View style={[styles.drawer, { paddingBottom: insets.bottom }]}>
        <View style={styles.drawerHeading}><Text style={styles.drawerTitle}>Bring Admin</Text>
          <Pressable onPress={() => setDrawerOpen(false)} accessibilityRole="button" accessibilityLabel="Close admin menu" style={styles.iconButton}><Ionicons name="close" size={23} color={colors.onSurface} /></Pressable>
        </View>
        {sidebar}
      </View>
    </View>}
    {topMenu && <View style={[styles.popoverLayer, { top: insets.top + 68 }]}>
      <Pressable style={styles.popoverScrim} onPress={() => setTopMenu(null)} accessibilityRole="button" accessibilityLabel="Close menu" />
      <View style={styles.popover}>
        {topMenu === "account" ? <>
          <Text style={styles.popoverTitle}>{name}</Text><Text style={styles.staffRole}>{staffRole(user)}</Text>
          <Pressable onPress={() => { void signOut(); }} accessibilityRole="button" accessibilityLabel="Log out" style={styles.popoverItem}><Ionicons name="log-out-outline" size={18} color={colors.onSurfaceSecondary} /><Text style={styles.popoverItemText}>Log out</Text></Pressable>
        </> : <>
          <Text style={styles.popoverTitle}>Needs attention</Text>
          <Text style={styles.popoverSubtitle}>{attentionCount > 0 ? `${attentionCount} open work item${attentionCount === 1 ? "" : "s"} across your assigned queues.` : "Your assigned work queues are clear."}</Text>
          {queueItems.length ? queueItems.map((item) => <Pressable key={item.href} onPress={() => go(item.href)} accessibilityRole="link" accessibilityLabel={item.label} style={styles.popoverItem}>
            <View style={styles.popoverQueueIcon}><Ionicons name={item.icon} size={16} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}><Text style={styles.popoverItemText}>{item.label}</Text><Text style={styles.popoverItemNote}>{item.note}</Text></View>
            <Text style={[styles.popoverCount, (item.count || 0) === 0 && styles.popoverCountMuted]}>{item.count == null ? (queueStats.isLoading ? "Loading" : "Unavailable") : item.count}</Text>
          </Pressable>) : <Text style={styles.staffRole}>No work areas assigned yet.</Text>}
        </>}
      </View>
    </View>}
  </View>;
}

const useStyles = makeStyles((c) => ({
  shell: { flex: 1, backgroundColor: c.screenBgAlt },
  topbar: { minHeight: 70, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, gap: spacing.md, zIndex: 2 },
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  brandDesktop: { width: 238, flexShrink: 0 },
  brandMark: { width: 34, height: 34 },
  brandName: { color: c.brandDeep, fontWeight: "800", fontSize: 15, flexShrink: 1 },
  pageTitle: { color: c.onSurface, fontWeight: "800", fontSize: 17, flex: 1 },
  backButton: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceTertiary },
  topActions: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconButton: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  connection: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  statusDot: { width: 9, height: 9, borderRadius: 5 }, connectionText: { fontSize: 12, fontWeight: "800" },
  lastCheck: { fontSize: 10, color: c.muted, marginTop: 2 },
  installButton: { height: 34, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: 9, backgroundColor: c.brandSecondary },
  installText: { color: c.brandPrimary, fontWeight: "700", fontSize: 12 },
  topAccount: { minHeight: 38, maxWidth: 150, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 4 },
  topAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: c.brandDeep },
  topAvatarText: { color: c.onBrandPrimary, fontWeight: "800" },
  topAccountName: { color: c.onSurface, fontSize: 12, fontWeight: "800", flexShrink: 1 },
  alertBadge: { position: "absolute", top: 1, right: 0, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: c.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  alertBadgeText: { color: c.onError, fontSize: 9, fontWeight: "800" },
  banner: { minHeight: 42, backgroundColor: c.errorBg, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg },
  bannerOnline: { backgroundColor: c.successBg }, bannerText: { color: c.onSurface, fontSize: 12, flex: 1 }, retryText: { color: c.brandPrimary, fontWeight: "800", fontSize: 12 },
  body: { flex: 1, flexDirection: "row", minHeight: 0 },
  sidebar: { width: 254, height: "100%", backgroundColor: c.surface, borderRightWidth: 1, borderRightColor: c.border, justifyContent: "space-between" },
  sidebarScroll: { padding: spacing.md, paddingTop: spacing.lg, gap: spacing.xl }, navGroup: { gap: 4 },
  groupLabel: { color: c.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, paddingHorizontal: spacing.md, paddingBottom: 5 },
  navItem: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, borderRadius: 11 },
  navItemActive: { backgroundColor: c.brandSecondary }, navText: { color: c.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  navTextActive: { color: c.brandDeep, fontWeight: "800" }, pressed: { opacity: 0.7 },
  sidebarFooter: { padding: spacing.md, borderTopWidth: 1, borderTopColor: c.divider, gap: spacing.sm },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xs },
  avatar: { width: 36, height: 36, borderRadius: 12, backgroundColor: c.brandSecondary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "800", color: c.brandDeep }, staffName: { color: c.onSurface, fontWeight: "800", fontSize: 12 },
  staffRole: { color: c.muted, fontSize: 11, marginTop: 1 }, logout: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.sm, borderRadius: 10 },
  logoutText: { color: c.onSurfaceSecondary, fontSize: 13, fontWeight: "700" },
  content: { flex: 1, minWidth: 0, backgroundColor: c.screenBgAlt },
  mobileTitleRow: { height: 38, paddingHorizontal: spacing.lg, justifyContent: "center", backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
  mobileTitle: { color: c.onSurface, fontSize: 16, fontWeight: "800" },
  drawerLayer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row", zIndex: 10 },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: c.overlay },
  drawer: { width: 280, maxWidth: "86%", backgroundColor: c.surface, height: "100%", shadowColor: c.shadow, shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 6, height: 0 }, elevation: 12 },
  drawerHeading: { minHeight: 58, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingLeft: spacing.lg, paddingRight: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
  drawerTitle: { color: c.brandDeep, fontWeight: "800", fontSize: 16 },
  popoverLayer: { position: "absolute", top: 60, right: 0, bottom: 0, left: 0, zIndex: 8 },
  popoverScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  popover: { position: "absolute", right: spacing.md, top: 2, width: 260, maxWidth: "90%", padding: spacing.md, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, shadowColor: c.shadow, shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 10 },
  popoverTitle: { color: c.onSurface, fontWeight: "800", fontSize: 14, marginBottom: 3 },
  popoverSubtitle: { color: c.muted, fontSize: 10.5, lineHeight: 15, marginBottom: spacing.xs },
  popoverItem: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider, marginTop: spacing.sm, paddingTop: spacing.sm },
  popoverQueueIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.brandSecondary },
  popoverItemText: { color: c.onSurface, fontSize: 12.5, fontWeight: "800" },
  popoverItemNote: { color: c.muted, fontSize: 10, marginTop: 2 },
  popoverCount: { color: c.brandPrimary, fontSize: 13, fontWeight: "800" },
  popoverCountMuted: { color: c.muted },
}));

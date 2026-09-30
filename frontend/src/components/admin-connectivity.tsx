import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { isAdminQueryKey } from "@/src/lib/admin-query-keys";

export type AdminConnectionStatus = "checking" | "online" | "offline" | "unavailable";

function browserIsOffline(): boolean {
  return Platform.OS === "web" && typeof navigator !== "undefined" && navigator.onLine === false;
}

function pageIsVisible(): boolean {
  return Platform.OS !== "web" || typeof document === "undefined" || !document.hidden;
}

/** A health check reflects the API, while lastSyncedAt reflects successful admin data reads. */
export function useAdminConnection() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AdminConnectionStatus>(browserIsOffline() ? "offline" : "checking");
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(() => {
    const latest = Math.max(0, ...queryClient.getQueryCache().findAll({ predicate: query => isAdminQueryKey(query.queryKey) }).map(query => query.state.dataUpdatedAt));
    return latest ? new Date(latest) : null;
  });
  const [refreshing, setRefreshing] = useState(false);
  const statusRef = useRef(status);
  const inFlight = useRef<Promise<void> | null>(null);
  const lastFocusRefresh = useRef(0);

  const updateStatus = useCallback((next: AdminConnectionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const refreshAdminData = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ predicate: query => isAdminQueryKey(query.queryKey), refetchType: "active" });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const checkNow = useCallback(async () => {
    if (browserIsOffline()) {
      updateStatus("offline");
      return;
    }
    if (inFlight.current) return inFlight.current;
    const wasDisconnected = statusRef.current === "offline" || statusRef.current === "unavailable";
    if (statusRef.current !== "online") updateStatus("checking");
    const check = (async () => {
      try {
        const response = await api.get<{ status: string }>("/health/ready", false);
        if (response.status !== "ready") throw new Error("API readiness check failed");
        if (browserIsOffline()) {
          updateStatus("offline");
          return;
        }
        setLastCheckedAt(new Date());
        updateStatus("online");
        if (wasDisconnected) await refreshAdminData().catch(() => {});
      } catch {
        updateStatus(browserIsOffline() ? "offline" : "unavailable");
      }
    })();
    inFlight.current = check;
    try {
      await check;
    } finally {
      inFlight.current = null;
    }
  }, [refreshAdminData, updateStatus]);

  const refreshNow = useCallback(async () => {
    await checkNow();
    if (statusRef.current === "online") await refreshAdminData();
  }, [checkNow, refreshAdminData]);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    return cache.subscribe(event => {
      if (event.type !== "updated" || !isAdminQueryKey(event.query.queryKey)) return;
      if (event.query.state.status !== "success" || !event.query.state.dataUpdatedAt) return;
      setLastSyncedAt(new Date(event.query.state.dataUpdatedAt));
    });
  }, [queryClient]);

  useEffect(() => {
    const bootstrap = setTimeout(() => { void checkNow(); }, 0);
    const interval = setInterval(() => {
      if (pageIsVisible()) void checkNow();
    }, 30000);
    if (Platform.OS !== "web" || typeof window === "undefined") return () => { clearTimeout(bootstrap); clearInterval(interval); };

    const onOffline = () => updateStatus("offline");
    const onOnline = () => { void checkNow(); };
    const onReturn = () => {
      if (!pageIsVisible() || Date.now() - lastFocusRefresh.current < 15000) return;
      lastFocusRefresh.current = Date.now();
      void refreshNow();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      clearInterval(interval);
      clearTimeout(bootstrap);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [checkNow, refreshNow, updateStatus]);

  return { status, lastCheckedAt, lastSyncedAt, refreshing, checkNow, refreshNow };
}

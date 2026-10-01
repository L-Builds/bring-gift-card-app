import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";

export type AdminBrowserPreferences = {
  browserNotifications: boolean;
  soundAlerts: boolean;
};

const DEFAULTS: AdminBrowserPreferences = {
  browserNotifications: false,
  soundAlerts: false,
};

const cache = new Map<string, AdminBrowserPreferences>();
const loaded = new Set<string>();
const listeners = new Map<string, Set<(value: AdminBrowserPreferences) => void>>();

function key(userId: string, name: keyof AdminBrowserPreferences) {
  return `bgc_admin_${userId}_${name}`;
}

function publish(userId: string, value: AdminBrowserPreferences) {
  cache.set(userId, value);
  listeners.get(userId)?.forEach((listener) => listener(value));
}

async function load(userId: string) {
  if (!userId || loaded.has(userId)) return cache.get(userId) || DEFAULTS;
  loaded.add(userId);
  const browserNotifications = await storage.getItem(key(userId, "browserNotifications"), DEFAULTS.browserNotifications);
  const soundAlerts = await storage.getItem(key(userId, "soundAlerts"), DEFAULTS.soundAlerts);
  const value = {
    browserNotifications: browserNotifications === true,
    soundAlerts: soundAlerts === true,
  };
  publish(userId, value);
  return value;
}

export function browserNotificationPermission(): "unsupported" | NotificationPermission {
  if (Platform.OS !== "web" || typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function useAdminBrowserPreferences(userId = "") {
  const [preferences, setPreferences] = useState<AdminBrowserPreferences>(() => cache.get(userId) || DEFAULTS);

  useEffect(() => {
    if (!userId) {
      setPreferences(DEFAULTS);
      return;
    }
    const userListeners = listeners.get(userId) || new Set<(value: AdminBrowserPreferences) => void>();
    const listener = (value: AdminBrowserPreferences) => setPreferences(value);
    userListeners.add(listener);
    listeners.set(userId, userListeners);
    void load(userId).then(setPreferences);
    return () => {
      userListeners.delete(listener);
      if (!userListeners.size) listeners.delete(userId);
    };
  }, [userId]);

  const update = useCallback(async (changes: Partial<AdminBrowserPreferences>) => {
    if (!userId) return false;
    const current = cache.get(userId) || await load(userId);
    const next = { ...current, ...changes };
    publish(userId, next);
    const writes = Object.entries(changes).map(([name, value]) => storage.setItem(key(userId, name as keyof AdminBrowserPreferences), !!value));
    const results = await Promise.all(writes);
    return results.every(Boolean);
  }, [userId]);

  const setBrowserNotifications = useCallback(async (enabled: boolean) => {
    if (!enabled) {
      await update({ browserNotifications: false });
      return { enabled: false, permission: browserNotificationPermission() };
    }
    const support = browserNotificationPermission();
    if (support === "unsupported" || Platform.OS !== "web" || typeof window === "undefined") {
      return { enabled: false, permission: "unsupported" as const };
    }
    let permission = support;
    if (permission === "default") permission = await Notification.requestPermission();
    const allowed = permission === "granted";
    await update({ browserNotifications: allowed });
    return { enabled: allowed, permission };
  }, [update]);

  const setSoundAlerts = useCallback(async (enabled: boolean) => {
    await update({ soundAlerts: enabled });
  }, [update]);

  return { preferences, setBrowserNotifications, setSoundAlerts };
}

export function playAdminAlertTone() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  try {
    const ctx = new AudioContextCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 620;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.18);
    oscillator.addEventListener("ended", () => { void ctx.close(); }, { once: true });
  } catch {
    // Sound alerts are optional; browser autoplay restrictions must not affect admin work.
  }
}

export function showAdminBrowserNotification(title: string, body: string) {
  if (Platform.OS !== "web" || typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const notification = new Notification(title, { body, icon: "/pwa-icon-192.png", tag: "bgc-admin-work" });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Browser alerts are optional and should never interrupt the admin workspace.
  }
}

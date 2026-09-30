import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import { usePathname } from "expo-router";
import { useAuth } from "@/src/context/auth";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let pendingInstall: InstallPrompt | null = null;
const listeners = new Set<() => void>();

function publishPrompt(prompt: InstallPrompt | null) {
  pendingInstall = prompt;
  listeners.forEach(listener => listener());
}

/** Browsers without beforeinstallprompt retain their normal menu-based install path. */
export function usePwaInstall() {
  const [canInstall, setCanInstall] = useState(!!pendingInstall);
  useEffect(() => {
    const sync = () => setCanInstall(!!pendingInstall);
    listeners.add(sync);
    sync();
    return () => { listeners.delete(sync); };
  }, []);

  const install = useCallback(async () => {
    const prompt = pendingInstall;
    if (!prompt) return;
    publishPrompt(null);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // Installation is optional; the browser remains usable as a normal tab.
    }
  }, []);

  return { canInstall, install };
}

export function WebPwa() {
  const pathname = usePathname();
  const { isAdmin } = useAuth();
  const isAdminArea = pathname.startsWith("/admin");
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || __DEV__) return;

    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      publishPrompt(event as InstallPrompt);
    };
    const onInstalled = () => publishPrompt(null);
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || __DEV__ || !isAdmin || !isAdminArea) return;

    const register = () => {
      if ("serviceWorker" in navigator && window.isSecureContext) {
        void navigator.serviceWorker.register("/sw.js", { scope: "/admin" }).catch(() => {});
      }
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      window.removeEventListener("load", register);
    };
  }, [isAdmin, isAdminArea]);

  return null;
}

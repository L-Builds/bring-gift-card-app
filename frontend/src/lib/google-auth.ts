import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

WebBrowser.maybeCompleteAuthSession();

const AUTH_BASE = process.env.EXPO_PUBLIC_GOOGLE_AUTH_URL?.trim();

/** Emergent returns `session_id` in the hash fragment (or query). Match the raw string. */
export function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function redirectUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin + "/";
  return Linking.createURL("");
}

/** Remove only `session_id` from the current web URL (after a successful exchange). */
export function cleanWebUrl() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("session_id");
  const hash = url.hash.replace(/^#/, "");
  if (hash) {
    const parts = hash.split("&").filter((p) => !p.startsWith("session_id="));
    url.hash = parts.length ? parts.join("&") : "";
  }
  window.history.replaceState(window.history.state, "", url.toString());
}

/**
 * Starts Google sign-in. On web this navigates away (returns null).
 * On native it resolves with the `session_id` from the callback URL, or null if cancelled.
 */
export async function startGoogleSignIn(): Promise<string | null> {
  if (!AUTH_BASE) throw new Error("Google sign-in is not configured");
  const redirect = redirectUrl();
  const authUrl = `${AUTH_BASE.replace(/\/$/, "")}/?redirect=${encodeURIComponent(redirect)}`;

  if (Platform.OS === "web") {
    window.location.href = authUrl;
    return null;
  }

  let captured: string | null = null;
  const sub = Linking.addEventListener("url", ({ url }) => {
    captured = captured || extractSessionId(url);
  });
  try {
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
    const fromResult = result.type === "success" ? extractSessionId(result.url) : null;
    if (fromResult) return fromResult;
    if (captured) return captured;
    // Android Custom Tabs may return "dismiss" even on success; check the initial URL too.
    return extractSessionId(await Linking.getInitialURL());
  } finally {
    sub.remove();
  }
}

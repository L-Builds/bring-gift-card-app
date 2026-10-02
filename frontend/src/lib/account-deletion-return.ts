import type { Href } from "expo-router";
import { afterAuthHref, normalizeTradeIntent, tradeAuthHref, type TradeIntent } from "@/src/lib/trade-intent";

const GOOGLE_RETURN_KEY = "bring-gift-card:google-account-deletion-return";
const RETURN_TTL_MS = 15 * 60 * 1000;

export function accountDeletionAfterAuthHref(role: string, input: TradeIntent & { return_to?: string }): Href {
  if (role === "customer" && input.return_to === "/delete-account") return "/delete-account";
  return afterAuthHref(role, input);
}

export function accountDeletionLoginHref(input: TradeIntent & { return_to?: string }): Href {
  if (input.return_to === "/delete-account") {
    return { pathname: "/(auth)/login", params: { ...(normalizeTradeIntent(input) ?? {}), return_to: "/delete-account" } };
  }
  return tradeAuthHref("login", input);
}

export function rememberGoogleAccountDeletionReturn(returnTo: string | undefined) {
  if (typeof window === "undefined") return;
  try {
    if (returnTo === "/delete-account") {
      window.sessionStorage.setItem(GOOGLE_RETURN_KEY, String(Date.now()));
    } else {
      window.sessionStorage.removeItem(GOOGLE_RETURN_KEY);
    }
  } catch {
    // Google sign-in can continue when browser storage is unavailable.
  }
}

export function takeGoogleAccountDeletionReturn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const savedAt = window.sessionStorage.getItem(GOOGLE_RETURN_KEY);
    window.sessionStorage.removeItem(GOOGLE_RETURN_KEY);
    const age = Date.now() - Number(savedAt);
    return savedAt !== null && Number.isFinite(age) && age >= 0 && age <= RETURN_TTL_MS;
  } catch {
    return false;
  }
}

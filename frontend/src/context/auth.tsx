import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { queryClient } from "@/src/query-client";
import { setDisplayCurrency } from "@/src/lib/format";
import { ApiError } from "@/src/api/client";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import { api, setToken, clearToken, getToken } from "@/src/api/client";
import { extractSessionId, cleanWebUrl } from "@/src/lib/google-auth";

export type User = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: "customer" | "admin";
  country: string;
  currency: string;
  minor_digits: number;
  market_code: string;
  kyc_status: string;
  notifications_enabled: boolean;
  auth_provider?: string;
  picture?: string;
  has_pin?: boolean;
};

type AuthState = {
  user: User | null;
  balanceKobo: number;
  loading: boolean;
  googleBusy: boolean;
  isGuest: boolean;
  isAdmin: boolean;
  token: string | null;
  login: (identifier: string, password: string, mode?: "email" | "phone") => Promise<User>;
  signup: (v: { full_name: string; email: string; phone: string; password: string; country?: string; market_code?: string; accepted_terms?: boolean; referral_code?: string }) => Promise<User>;
  loginWithGoogle: (sessionId: string) => Promise<User | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

// One-time session ids must be exchanged exactly once (deep link + auth result can both surface it).
const consumedSessionIds = new Set<string>();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [balanceKobo, setBalanceKobo] = useState(0);
  const [loading, setLoading] = useState(true);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [token, setTok] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const res = await api.get<{ user: User; balance_kobo: number }>("/auth/me");
      setDisplayCurrency(res.user.currency || "NGN", res.user.minor_digits ?? 2);
      setUser(res.user);
      setBalanceKobo(res.balance_kobo);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      await queryClient.cancelQueries();
    queryClient.clear();
      setUser(null);
      setBalanceKobo(0);
      await clearToken();
      setTok(null);
    }
  }, []);

  const persist = async (access: string, u: User) => {
    await queryClient.cancelQueries();
    queryClient.clear();
    setDisplayCurrency(u.currency || "NGN", u.minor_digits ?? 2);
    await setToken(access);
    setTok(access);
    setUser(u);
    await loadMe();
  };

  const loginWithGoogle = useCallback(async (sessionId: string) => {
    if (consumedSessionIds.has(sessionId)) return null;
    consumedSessionIds.add(sessionId);
    setGoogleBusy(true);
    try {
      const res = await api.post<{ access_token: string; user: User }>("/auth/session", { session_id: sessionId }, false);
      await persist(res.access_token, res.user);
      cleanWebUrl();
      return res.user;
    } finally {
      setGoogleBusy(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      // Process a Google callback FIRST (web hash/query, or native cold-start deep link).
      let handled = false;
      const source = Platform.OS === "web" && typeof window !== "undefined" ? window.location.href : await Linking.getInitialURL();
      const sid = extractSessionId(source);
      if (sid) {
        try {
          handled = !!(await loginWithGoogle(sid));
        } catch {
          handled = false;
        }
      }
      if (!handled) {
        const t = await getToken();
        setTok(t);
        if (t) { try { await loadMe(); } catch { /* Keep session for a later network retry. */ } }
      }
      setLoading(false);
    })();
    if (Platform.OS === "web") return;
    const sub = Linking.addEventListener("url", ({ url }) => {
      const s = extractSessionId(url);
      if (s) loginWithGoogle(s).catch(() => {});
    });
    return () => sub.remove();
  }, [loadMe, loginWithGoogle]);

  const login = useCallback(async (identifier: string, password: string, mode: "email" | "phone" = "email") => {
    const body = mode === "phone" ? { phone: identifier, password } : { email: identifier, password };
    const res = await api.post<{ access_token: string; user: User }>("/auth/login", body, false);
    await persist(res.access_token, res.user);
    return res.user;
  }, []);

  const signup = useCallback(async (v: any) => {
    const res = await api.post<{ access_token: string; user: User }>("/auth/signup", v, false);
    await persist(res.access_token, res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    await clearToken();
    await queryClient.cancelQueries();
    queryClient.clear();
    setDisplayCurrency("NGN", 2);
    setTok(null);
    setUser(null);
    setBalanceKobo(0);
  }, []);

  const refresh = useCallback(async () => {
    if (await getToken()) await loadMe();
  }, [loadMe]);

  return (
    <AuthContext.Provider
      value={{
        user,
        balanceKobo,
        loading,
        googleBusy,
        isGuest: !user,
        isAdmin: user?.role === "admin",
        token,
        login,
        signup,
        loginWithGoogle,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

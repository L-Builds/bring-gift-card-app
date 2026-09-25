import React, { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { useToast } from "@/src/components/toast";

type Notif = { id: string; title: string; body: string; type: string; ref_id: string; created_at: string };
type Poll = { notifications: Notif[]; server_time: string };

const POLL_MS = 8000;

function toneFor(n: Notif): "success" | "error" | "info" {
  const t = n.title.toLowerCase();
  if (/(approved|paid|verified|credited)/.test(t)) return "success";
  if (/(rejected|attention|failed)/.test(t)) return "error";
  return "info";
}

/**
 * Live in-app alerts: polls the notification feed while a customer is signed in and
 * surfaces new trade / withdrawal / support/security events instantly as tappable toasts, refreshing
 * the affected screens (trades, wallet, transactions, balance) in the background.
 */
export function LiveAlertsProvider({ children }: { children: React.ReactNode }) {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const cursor = useRef<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!user) {
      cursor.current = null;
      return;
    }

    const tick = async () => {
      if (inFlight.current || AppState.currentState !== "active") return;
      inFlight.current = true;
      try {
        const q = cursor.current ? `?ts=${encodeURIComponent(cursor.current)}` : "";
        const res = await api.get<Poll>(`/notifications/since${q}`);
        const items = (res.notifications ?? []).filter((n) => n.type !== "kyc");
        cursor.current = items.length ? items[items.length - 1].created_at : cursor.current ?? res.server_time;
        if (!items.length) return;

        qc.invalidateQueries({ queryKey: ["notif-unread"] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
        qc.invalidateQueries({ queryKey: ["transactions"] });
        qc.invalidateQueries({ queryKey: ["my-trades"] });
        qc.invalidateQueries({ queryKey: ["wallet"] });
        qc.invalidateQueries({ queryKey: ["support-tickets"] });
        for (const n of items) {
          if (n.type === "trade" && n.ref_id) qc.invalidateQueries({ queryKey: ["trade", n.ref_id] });
          if (n.type === "support" && n.ref_id) qc.invalidateQueries({ queryKey: ["support-ticket", n.ref_id] });
        }
        refresh().catch(() => {});

        const latest = items[items.length - 1];
        const extra = items.length > 1 ? ` (+${items.length - 1} more)` : "";
        toast.show(`${latest.title}: ${latest.body}${extra}`, toneFor(latest), {
          actionLabel: "View",
          onPress: () => {
            if (latest.type === "trade" && latest.ref_id) router.push(`/trade/${latest.ref_id}`);
            else if (latest.type === "withdrawal") router.push("/wallet");
            else if (latest.type === "support" && latest.ref_id) router.push(`/support/${latest.ref_id}`);
            else if (latest.type === "security") router.push("/security/pin");
            else router.push("/notifications");
          },
        });
      } catch {
        // network hiccup — try again on the next tick
      } finally {
        inFlight.current = false;
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") tick();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return <>{children}</>;
}

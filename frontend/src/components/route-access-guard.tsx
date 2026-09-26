import React, { useEffect } from "react";
import { useRouter, useSegments } from "expo-router";
import { useAuth } from "@/src/context/auth";

function guestRouteIsPublic(segments: string[]) {
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "index")) return true;
  if (segments[0] === "legal") return true;
  if (segments[0] === "(auth)") return true;
  if (segments[0] === "(tabs)" && (!segments[1] || segments[1] === "index")) return true;
  if (segments.length === 1 && (segments[0] === "support" || segments[0] === "trading-guidelines")) return true;
  return false;
}

export function RouteAccessGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const rawSegments = useSegments();
  const segments = rawSegments as string[];
  const { loading, isGuest, isAdmin } = useAuth();

  const publicForGuest = guestRouteIsPublic(segments);
  const adminArea = segments[0] === "admin";
  const deferredKycRoute = segments[0] === "kyc" || (segments[0] === "admin" && segments[1] === "kyc");
  const blockGuest = !loading && isGuest && !publicForGuest;
  const blockCustomerFromAdmin = !loading && !isGuest && !isAdmin && adminArea;
  const blockDeferredKyc = !loading && !isGuest && deferredKycRoute;

  useEffect(() => {
    if (loading) return;
    if (blockGuest) {
      router.replace("/(auth)/login");
      return;
    }
    if (blockCustomerFromAdmin) {
      router.replace("/(tabs)");
      return;
    }
    if (blockDeferredKyc) router.replace(isAdmin ? "/admin" : "/(tabs)/profile");
  }, [blockCustomerFromAdmin, blockDeferredKyc, blockGuest, isAdmin, loading, router]);

  if (loading && !publicForGuest) return null;
  if (blockGuest || blockCustomerFromAdmin || blockDeferredKyc) return null;
  return <>{children}</>;
}

import React, { useEffect } from "react";
import { useRouter, useSegments } from "expo-router";
import { useAuth } from "@/src/context/auth";
import { canVisitAdminRoute } from "@/src/lib/staff-access";

function guestRouteIsPublic(segments: string[]) {
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "index")) return true;
  if (segments[0] === "legal") return true;
  if (segments[0] === "account-deleted") return true;
  if (segments[0] === "(auth)") return true;
  if (segments[0] === "(tabs)" && (!segments[1] || segments[1] === "index" || segments[1] === "rates")) return true;
  if (segments[0] === "card") return true;
  if (segments.length === 1 && (segments[0] === "support" || segments[0] === "trading-guidelines")) return true;
  return false;
}

export function RouteAccessGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const rawSegments = useSegments();
  const segments = rawSegments as string[];
  const { loading, isGuest, isAdmin, user } = useAuth();

  const publicForGuest = guestRouteIsPublic(segments);
  const adminArea = segments[0] === "admin";
  const deferredKycRoute = segments[0] === "kyc" || (segments[0] === "admin" && segments[1] === "kyc");
  const blockGuest = !loading && isGuest && !publicForGuest;
  const accountDeletionRoute = segments[0] === "delete-account";
  const blockCustomerFromAdmin = !loading && !isGuest && !isAdmin && adminArea;
  const blockWorkerFromAdminRoute = !loading && !isGuest && adminArea && isAdmin && !canVisitAdminRoute(user, segments[1] || "index");
  const blockDeferredKyc = !loading && !isGuest && deferredKycRoute;

  useEffect(() => {
    if (loading) return;
    if (blockGuest) {
      router.replace(accountDeletionRoute
        ? { pathname: "/(auth)/login", params: { return_to: "/delete-account" } }
        : "/(auth)/login");
      return;
    }
    if (blockCustomerFromAdmin) {
      router.replace("/(tabs)");
      return;
    }
    if (blockWorkerFromAdminRoute) {
      router.replace("/admin");
      return;
    }
    if (blockDeferredKyc) router.replace(isAdmin ? "/admin" : "/(tabs)/profile");
  }, [accountDeletionRoute, blockCustomerFromAdmin, blockDeferredKyc, blockGuest, blockWorkerFromAdminRoute, isAdmin, loading, router]);

  if (loading && !publicForGuest) return null;
  if (blockGuest || blockCustomerFromAdmin || blockWorkerFromAdminRoute || blockDeferredKyc) return null;
  return <>{children}</>;
}

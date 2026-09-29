import type { User } from "@/src/context/auth";

export type StaffScope = "trades" | "withdrawals" | "support" | "customers";

export const STAFF_SCOPES: { key: StaffScope; label: string; description: string }[] = [
  { key: "trades", label: "Trades", description: "Review and process submitted gift cards" },
  { key: "withdrawals", label: "Withdrawals", description: "Review and process payout requests" },
  { key: "support", label: "Support", description: "Read and reply to customer tickets" },
  { key: "customers", label: "Customers", description: "Review customer account activity" },
];

export function canManageStaff(user: User | null): boolean {
  return user?.role === "admin" && user.staff_role !== "worker";
}

export function canManageSettings(user: User | null): boolean {
  return user?.role === "admin" && user.staff_role !== "worker";
}

export function canWorkIn(user: User | null, scope: StaffScope): boolean {
  if (user?.role !== "admin") return false;
  return user.staff_role !== "worker" || !!user.staff_permissions?.includes(scope);
}

export function canVisitAdminRoute(user: User | null, route: string): boolean {
  if (user?.role !== "admin") return false;
  if (user.staff_role !== "worker") return true;
  if (!route || route === "index") return true;
  const scope: Record<string, StaffScope> = {
    trade: "trades", trades: "trades", withdrawals: "withdrawals",
    support: "support", customer: "customers", customers: "customers",
  };
  const needed = scope[route];
  return !!needed && !!user.staff_permissions?.includes(needed);
}

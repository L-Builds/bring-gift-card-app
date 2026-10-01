const ADMIN_QUERY_KEYS = new Set(["payout-providers", "withdrawal-provider-options", "readiness", "denomination-history"]);

export function isAdminQueryKey(queryKey: readonly unknown[]): boolean {
  const first = queryKey[0];
  return typeof first === "string" && (first.startsWith("admin-") || ADMIN_QUERY_KEYS.has(first));
}

export function isPublicQueryAffectedByAdminWrite(path: string, queryKey: readonly unknown[]): boolean {
  const first = queryKey[0];
  if (typeof first !== "string") return false;
  if (path.startsWith("/admin/brands") || path.startsWith("/admin/card-rates")) {
    return ["brand", "brands", "brand-categories", "rates", "card-rates", "quote"].includes(first);
  }
  if (path.startsWith("/admin/markets")) return ["markets", "card-rates", "quote"].includes(first);
  if (path.startsWith("/admin/legal")) return first === "legal";
  if (path.startsWith("/admin/payout-")) return ["payout-options", "payout-banks"].includes(first);
  return false;
}

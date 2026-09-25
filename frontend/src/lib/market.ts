import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { formatMoney } from "./format";
export type Market = { code: string; name: string; currency: string; minor_digits: number; is_active: boolean };
export type CardRate = { id: string; brand_id: string; market_code: string; face_value: number; payout_minor: number; version: number; is_active: boolean };
export function useCardRates() {
  const { user } = useAuth();
  const market = user?.market_code || "NG";
  return useQuery({ queryKey: ["card-rates", market], queryFn: () => api.get<{ rates: CardRate[]; market: Market | null }>(`/card-rates?market_code=${market}`, false), refetchInterval: 15000 });
}
export function rateLabel(brandId: string, data?: { rates: CardRate[]; market: Market | null }) {
  const rate = data?.rates.find(r => r.brand_id === brandId);
  return rate && data?.market ? `$${rate.face_value} → ${formatMoney(rate.payout_minor, data.market.currency, data.market.minor_digits)}` : "Rate not available";
}

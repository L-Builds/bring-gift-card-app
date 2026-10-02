import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { formatMoney } from "./format";
export type Market = { code: string; name: string; currency: string; minor_digits: number; is_active: boolean };
export type HeadlineRate = {
  id: string;
  brand_id: string;
  market_code: string;
  rate_minor_per_unit: number;
  version: number;
  is_active: boolean;
  archived_at?: string | null;
};
export type DetailedRate = {
  id: string;
  brand_id: string;
  market_code: string;
  card_country: string;
  submission_type: "physical" | "ecode";
  rate_minor_per_unit: number;
  version: number;
  is_active: boolean;
  archived_at?: string | null;
};
export type CardRate = {
  id: string;
  brand_id: string;
  market_code: string;
  card_country: string;
  face_value: number;
  payout_minor: number;
  rate_minor_per_usd?: number | null;
  submission_type: "any" | "physical" | "ecode";
  range_min?: number | null;
  range_max?: number | null;
  version: number;
  is_active: boolean;
  is_headline: boolean;
  archived_at?: string | null;
};
export function useCardRates() {
  const { user } = useAuth();
  const market = user?.market_code || "NG";
  return useQuery({ queryKey: ["card-rates", market], queryFn: () => api.get<{ rates: CardRate[]; market: Market | null }>(`/card-rates?market_code=${market}`, false), refetchInterval: 15000 });
}
export function useHeadlineRates() {
  const { user } = useAuth();
  const market = user?.market_code || "NG";
  return useQuery({
    queryKey: ["headline-rates", market],
    queryFn: () => api.get<{ headline_rates: HeadlineRate[]; market: Market | null }>(`/headline-rates?market_code=${encodeURIComponent(market)}`, false),
    refetchInterval: 15000,
  });
}
export function useDetailedRates(brandId: string) {
  const { user } = useAuth();
  const market = user?.market_code || "NG";
  return useQuery({
    queryKey: ["detailed-rates", brandId, market],
    queryFn: () => api.get<{ detailed_rates: DetailedRate[]; market: Market | null }>(`/detailed-rates?brand_id=${encodeURIComponent(brandId)}&market_code=${encodeURIComponent(market)}`, false),
    enabled: !!brandId && brandId !== "all",
    refetchInterval: 15000,
  });
}
export function rateLabel(brandId: string, data?: { rates: CardRate[]; market: Market | null }) {
  const rate = data?.rates.find(r => r.brand_id === brandId);
  return rate && data?.market ? `$${rate.face_value} → ${formatMoney(rate.payout_minor, data.market.currency, data.market.minor_digits)}` : "Rate not available";
}

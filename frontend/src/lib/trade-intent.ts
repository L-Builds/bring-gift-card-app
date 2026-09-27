import type { Href } from "expo-router";

export type TradeIntent = {
  brand_id?: string;
  card_value_usd?: string;
  quantity?: string;
};

export function normalizeTradeIntent(input: TradeIntent): TradeIntent | null {
  const brandId = typeof input.brand_id === "string" ? input.brand_id.trim() : "";
  if (!brandId || !/^[a-zA-Z0-9_-]{1,128}$/.test(brandId)) return null;

  const intent: TradeIntent = { brand_id: brandId };
  const value = Number(input.card_value_usd);
  if (typeof input.card_value_usd === "string" && Number.isInteger(value) && value > 0 && value <= 1_000_000) {
    intent.card_value_usd = String(value);
    const quantity = Number(input.quantity);
    if (typeof input.quantity === "string" && Number.isInteger(quantity) && quantity >= 1 && quantity <= 100) {
      intent.quantity = String(quantity);
    }
  }
  return intent;
}

export function tradeAuthHref(screen: "login" | "signup", input: TradeIntent): Href {
  return { pathname: screen === "login" ? "/(auth)/login" : "/(auth)/signup", params: normalizeTradeIntent(input) ?? {} };
}

export function tradeHref(input: TradeIntent): Href {
  return { pathname: "/(tabs)/trade", params: normalizeTradeIntent(input) ?? {} };
}

export function afterAuthHref(role: string, input: TradeIntent): Href {
  if (role === "admin") return "/admin";
  const intent = normalizeTradeIntent(input);
  return intent ? tradeHref(intent) : "/(tabs)";
}

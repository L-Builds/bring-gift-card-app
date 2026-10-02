// Money is stored as integer minor units of the account currency. Never do
// authoritative math on the client; only display.

let currentCurrency = "NGN";
let currentDigits = 2;
export function setDisplayCurrency(currency: string, digits: number) { currentCurrency = currency; currentDigits = digits; }
export function currencyMark(currency: string): string { return currency === "NGN" ? "₦" : currency; }
export function formatMoney(minor: number, currency = currentCurrency, digits = currentDigits, opts: { decimals?: number; showSign?: boolean } = {}): string {
  const amount = (minor || 0) / 10 ** digits;
  const decimals = opts.decimals ?? digits;
  if (currency === "NGN") {
    const number = new Intl.NumberFormat("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Math.abs(amount));
    const sign = amount < 0 ? "-" : opts.showSign && amount > 0 ? "+" : "";
    return `${sign}₦${number}`;
  }
  return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "symbol", minimumFractionDigits: decimals, maximumFractionDigits: decimals, signDisplay: opts.showSign ? "exceptZero" : "auto" }).format(amount);
}
// Compatibility name for existing screens; values are minor units of the account currency.
export function formatNaira(minor: number, opts: { decimals?: number; showSign?: boolean } = {}): string { return formatMoney(minor, currentCurrency, currentDigits, opts); }
export function toMinor(value: string, digits = currentDigits): number | null {
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > digits) return null;
  const result = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

export function formatUsd(usd: number): string {
  return `$${usd}`;
}

export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      " • " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

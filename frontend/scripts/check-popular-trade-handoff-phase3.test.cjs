const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const project = path.resolve(root, "..");
const readFront = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const readBack = (relative) => fs.readFileSync(path.join(project, "backend", relative), "utf8");

test("Popular Home rows hand off directly to Trade with the selected brand", () => {
  const home = readFront("app/(tabs)/index.tsx");
  assert.match(home, /import \{ tradeAuthHref, tradeHref \} from "@\/src\/lib\/trade-intent"/);
  assert.match(home, /const openPopularTrade = \(brandId: string\) => \{/);
  assert.match(home, /const intent = \{ brand_id: brandId \}/);
  assert.match(home, /isGuest \? tradeAuthHref\("login", intent\) : tradeHref\(intent\)/);
  assert.match(home, /onPress=\{\(\) => openPopularTrade\(b\.id\)\}/);
  assert.doesNotMatch(home, /onPress=\{\(\) => router\.push\(`\/card\/\$\{b\.id\}`\)\}/);
});

test("Trade consumes brand_id and preselects the matching catalog card", () => {
  const trade = readFront("app/(tabs)/trade.tsx");
  assert.match(trade, /useLocalSearchParams<\{ brand_id\?: string;/);
  assert.match(trade, /const selected = data\.brands\.find\(\(b\) => b\.id === brand_id\)/);
  assert.match(trade, /setBrand\(selected\)/);
  assert.match(trade, /setSubcategory\(""\)/);
  assert.match(trade, /setCountry\(""\)/);
});

test("Guest trade intent survives email login, signup, and Google web sign-in", () => {
  const login = readFront("app/(auth)/login.tsx");
  const signup = readFront("app/(auth)/signup.tsx");
  const google = readFront("src/lib/google-auth.ts");
  const splash = readFront("app/index.tsx");
  const intent = readFront("src/lib/trade-intent.ts");

  assert.match(login, /const tradeIntent = useLocalSearchParams<TradeIntent>\(\)/);
  assert.match(login, /router\.replace\(afterAuthHref\(u\.role, tradeIntent\)\)/);
  assert.match(login, /tradeAuthHref\("signup", tradeIntent\)/);
  assert.match(signup, /const tradeIntent = useLocalSearchParams<TradeIntent>\(\)/);
  assert.match(signup, /router\.replace\(afterAuthHref\(u\.role, tradeIntent\)\)/);
  assert.match(signup, /tradeAuthHref\("login", tradeIntent\)/);
  assert.match(google, /rememberGoogleTradeIntent\(tradeIntent\)/);
  assert.match(splash, /takeGoogleTradeIntent\(\)/);
  assert.match(splash, /user && intent \? tradeHref\(intent\)/);
  assert.match(intent, /const GOOGLE_TRADE_INTENT_TTL_MS = 15 \* 60 \* 1000/);
});

test("Popular ordering, max-eight rule, active-market bonus currency, and admin editing remain wired", () => {
  const server = readBack("server.py");
  const admin = readFront("app/admin/catalog.tsx");

  assert.match(server, /sort\("position", 1\)\.to_list\(8\)/);
  assert.match(server, /Popular Gift Cards can contain at most 8 cards/);
  assert.match(server, /"code": market_code, "is_active": True/);
  assert.match(server, /@api\.post\("\/admin\/popular-cards\/reorder"\)/);
  assert.match(server, /@api\.patch\("\/admin\/popular-cards\/\{brand_id\}"\)/);
  assert.match(server, /@api\.delete\("\/admin\/popular-cards\/\{brand_id\}"\)/);

  assert.match(admin, /popularRows\.length} \/ 8 cards/);
  assert.match(admin, /movePopularCard\(index, -1\)/);
  assert.match(admin, /movePopularCard\(index, 1\)/);
  assert.match(admin, /Bonus currency/);
  assert.match(admin, /activeMarkets\.map/);
  assert.match(admin, /Save Popular Settings/);
  assert.match(admin, /Remove from Popular/);
});

test("Home keeps the locked mobile Popular layout and conditional bonus rendering", () => {
  const home = readFront("app/(tabs)/index.tsx");
  assert.match(home, /<Text style=\{styles\.sectionTitle\}>Popular Gift Cards<\/Text>/);
  assert.match(home, /item\.bonus\?\.enabled \?/);
  assert.match(home, /\+ \{currencyAmount\(item\.bonus\.amount_minor/);
  assert.match(home, /\$\{item\.bonus\.min_card_value_usd\} card upward/);
  assert.doesNotMatch(home, /No bonus|Bonus unavailable|bonus disabled/i);
  assert.doesNotMatch(home.slice(home.indexOf("{popularCards.map"), home.indexOf("        <Pressable onPress={gate", home.indexOf("{popularCards.map"))), /chevron-forward/);
  assert.match(home, /brandRow: \{ flexDirection: "row", alignItems: "center"/);
  assert.match(home, /brandPriceBlock: \{ alignItems: "flex-end"/);
});

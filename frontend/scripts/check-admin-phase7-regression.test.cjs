const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const adminLayout = read('frontend/app/admin/_layout.tsx');
const staffAccess = read('frontend/src/lib/staff-access.ts');
const tradeDetail = read('frontend/app/admin/trade/[id].tsx');
const withdrawals = read('frontend/app/admin/withdrawals.tsx');
const customers = read('frontend/app/admin/customers.tsx');
const support = read('frontend/app/admin/support.tsx');
const kyc = read('frontend/app/admin/kyc.tsx');
const catalog = read('frontend/app/admin/catalog.tsx');
const rates = read('frontend/app/admin/rates.tsx');
const markets = read('frontend/app/admin/markets.tsx');
const staff = read('frontend/app/admin/staff.tsx');
const settings = read('frontend/app/admin/settings.tsx');
const connectivity = read('frontend/src/components/admin-connectivity.tsx');
const pwa = read('frontend/src/components/web-pwa.tsx');
const preferences = read('frontend/src/lib/admin-preferences.ts');
const queryClient = read('frontend/src/query-client.ts');
const server = read('backend/server.py');
const production = read('backend/production.py');
const staffTests = read('backend/tests/test_staff_roles.py');
const securityTests = read('backend/tests/test_admin_security.py');
const catalogTests = read('backend/tests/test_catalog_logo.py');
const productionTests = read('backend/tests/test_production.py');

test('General Manager Manager and Worker access rules remain permission driven', () => {
  assert.match(staffAccess, /user\.staff_role !== "worker" \|\| !!user\.staff_permissions\?\.includes\(scope\)/);
  assert.match(staffAccess, /if \(!route \|\| route === "index" \|\| route === "settings"\) return true/);
  assert.match(adminLayout, /visible: \(u\) => canWorkIn\(u, "trades"\)/);
  assert.match(adminLayout, /visible: canManageStaff/);
  assert.match(server, /STAFF_ROLES = \{"general_manager", "manager", "worker"\}/);
  assert.match(server, /require_staff_scope\("customers"\)/);
  assert.match(staffTests, /test_staff_hierarchy_password_rule_and_scope_revocation/);
  assert.match(staffTests, /test_every_admin_route_has_server_dependency/);
});

test('trade review image viewer and existing approve reject need-info behavior remain wired', () => {
  assert.match(tradeDetail, /\/admin\/trades\/\$\{id\}\/approve/);
  assert.match(tradeDetail, /\/admin\/trades\/\$\{id\}\/reject/);
  assert.match(tradeDetail, /\/admin\/trades\/\$\{id\}\/need-info/);
  assert.match(tradeDetail, /contentFit="contain"/);
  assert.match(tradeDetail, /`Image \${viewerIndex \+ 1} of \${data\.image_paths\.length}`/);
  assert.match(tradeDetail, /rotate/);
  assert.match(tradeDetail, /desktopWorkspace = viewportWidth >= 1024/);
  assert.match(server, /@api\.post\("\/admin\/trades\/\{trade_id\}\/approve"\)/);
  assert.match(server, /@api\.post\("\/admin\/trades\/\{trade_id\}\/reject"\)/);
  assert.match(server, /@api\.post\("\/admin\/trades\/\{trade_id\}\/need-info"\)/);
});

test('daily operations retain their existing server-backed workflows', () => {
  assert.match(withdrawals, /\/admin\/withdrawals\?status=/);
  assert.match(withdrawals, /\/admin\/withdrawals\/\$\{id\}\/\$\{path\}/);
  assert.match(withdrawals, /\/admin\/withdrawals\/\$\{rejectId\}\/reject/);
  assert.match(customers, /\/admin\/users\?q=/);
  assert.match(support, /\/admin\/support\?status=/);
  assert.match(kyc, /\/admin\/kyc\?status=/);
  assert.match(server, /@api\.get\("\/admin\/users"\)/);
  assert.match(server, /@api\.get\("\/admin\/support"\)/);
  assert.match(server, /@api\.get\("\/admin\/kyc"\)/);
  assert.match(server, /path\.startswith\("\/api\/kyc"\) or path\.startswith\("\/api\/admin\/kyc"\)/);
});

test('catalog supports create edit logo replace-remove while preserving publication safety', () => {
  assert.match(catalog, /Add Gift Card/);
  assert.match(catalog, /Edit Gift Card/);
  assert.match(catalog, /Replace/);
  assert.match(catalog, /Remove/);
  assert.match(server, /@api\.post\("\/admin\/brands"\)/);
  assert.match(server, /@api\.patch\("\/admin\/brands\/\{brand_id\}"\)/);
  assert.match(server, /@api\.delete\("\/admin\/brands\/\{brand_id\}\/logo"\)/);
  assert.match(server, /@api\.get\("\/brands\/\{brand_id\}\/logo"\)/);
  assert.match(catalogTests, /test_public_catalog_only_lists_tradable_cards/);
  assert.match(catalogTests, /test_logo_normalized_and_served_without_exposing_private_upload/);
});

test('rates markets and staff continue to use the existing management endpoints', () => {
  assert.match(rates, /CatalogRateManager|Catalog/);
  assert.match(markets, /\/admin\/markets/);
  assert.match(staff, /\/admin\/staff/);
  assert.match(production, /@api\.get\("\/admin\/card-rates"\)/);
  assert.match(production, /@api\.post\("\/admin\/card-rates"\)/);
  assert.match(production, /@api\.delete\("\/admin\/card-rates\/\{rate_id\}"\)/);
  assert.match(production, /@api\.post\("\/admin\/markets"\)/);
  assert.match(server, /@api\.post\("\/admin\/staff"\)/);
  assert.match(server, /@api\.patch\("\/admin\/staff\/\{staff_id\}"\)/);
});

test('password change session invalidation settings and notification controls remain protected', () => {
  assert.match(settings, /\/auth\/password\/change/);
  assert.match(settings, /\/auth\/sessions\/revoke-others/);
  assert.match(settings, /\/auth\/admin-notifications/);
  assert.match(settings, /canManageSettings\(user\)/);
  assert.match(server, /password\.endswith\("@admin"\)/);
  assert.match(server, /@api\.post\("\/auth\/password\/change"\)/);
  assert.match(server, /"\$inc": \{"token_version": 1\}/);
  assert.match(server, /@api\.post\("\/auth\/sessions\/revoke-others"\)/);
  assert.match(securityTests, /test_admin_can_change_own_password_and_keep_current_session/);
  assert.match(securityTests, /test_admin_can_revoke_other_sessions_without_logging_out_current_device/);
});

test('online offline refresh browser notifications and install behavior stay connected', () => {
  assert.match(queryClient, /refetchInterval: 15000/);
  assert.match(connectivity, /navigator\.onLine === false/);
  assert.match(connectivity, /window\.addEventListener\("offline"/);
  assert.match(connectivity, /window\.addEventListener\("online"/);
  assert.match(connectivity, /refreshNow/);
  assert.match(pwa, /beforeinstallprompt/);
  assert.match(pwa, /navigator\.serviceWorker\.register\("\/sw\.js", \{ scope: "\/admin" \}\)/);
  assert.match(preferences, /Notification/);
  assert.match(adminLayout, /showAdminBrowserNotification/);
});

test('desktop remains primary while mobile fallback and sticky review stay intact', () => {
  assert.match(adminLayout, /desktop = width >= 1024/);
  assert.match(adminLayout, /compact = width < 800/);
  assert.match(settings, /twoColumns = width >= 900/);
  assert.match(tradeDetail, /desktopWorkspace = viewportWidth >= 1024/);
  assert.match(tradeDetail, /reviewColumnSticky: \{ position: "sticky"/);
});

test('backend acceptance files still cover finance support staff security and catalog protections', () => {
  assert.match(productionTests, /admin\/trades/);
  assert.match(productionTests, /admin\/withdrawals/);
  assert.match(productionTests, /support_attachment_access_is_ticket_scoped/);
  assert.match(staffTests, /worker_auth/);
  assert.match(securityTests, /Current password is incorrect|wrong_current/);
  assert.match(catalogTests, /brand_logo|logo/);
});

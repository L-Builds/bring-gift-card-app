# Phase 6 — Trade Integration + Migration + Full Verification

## Scope completed

Phase 6 cuts new Trade pricing over to the simplified current-rate model established in Phases 1–5.

- All Cards / Popular main display price remains sourced from `headline_rates`.
- Individual card country/type pricing remains sourced from `detailed_rates`.
- New Trade quotes now require an exact active `Card + payout market + card country + Physical/Code` detailed-rate row.
- Payout is `card value × rate per unit × quantity`.
- Trade submission locks the detailed-rate row and rejects a stale rate version.
- Trade country/type availability is derived from current detailed rates; there is no legacy country or denomination fallback.
- Legacy `card_rates` rows remain available for historical/admin compatibility but are not consulted for new quotes.
- Existing historical trade snapshots are not rewritten or deleted.

## Migration

`013_trade_rate_cutover.sql` records the runtime cutover checkpoint without destructive data changes. The schema already required for headline/detailed rates was created in migration 012. Migration 013 adds table documentation and advances `SCHEMA_VERSION` to `013_trade_rate_cutover`, so application startup requires migrations through the cutover.

The migration contains no `DELETE`, `DROP`, `TRUNCATE`, or rewrite of legacy `card_rates` history.

## Verification performed in this workspace

- Frontend regression suite: **92/92 passed**.
- Actual `Production.quote` execution with a fake repository that raises if legacy `card_rates` is accessed: **passed**.
  - Verified exact country normalization.
  - Verified detailed-rate lookup.
  - Verified row-lock request.
  - Verified `rate per unit × card value × quantity` payout.
- Phase 1–6 schema/history static checks: **passed**.
- Backend Python source compilation: **passed**.
- Changed TypeScript/TSX syntax transpilation: **passed**.
- Existing responsive/admin/permissions regression checks included in the 92/92 run: **passed**.
- Added a PostgreSQL end-to-end Phase 6 acceptance test covering headline, Popular, All Cards discovery, detailed rates, quote math, stale-rate rejection, trade creation, country removal, and history preservation.

## Verification not possible in this workspace

- PostgreSQL-backed pytest could not execute because `TEST_DATABASE_URL` / a disposable PostgreSQL test database is not available. The shared pytest harness fails at import without that variable; production data was not used as a test target.
- Full dependency-backed TypeScript typecheck and Expo web build could not execute because `node_modules` is not included in the project. An `npm ci` attempt did not complete; the partial install was removed. The build consequently reports missing `expo/package.json`, and the full typecheck reports missing React/Expo modules/base config. Changed TS/TSX files were syntax-checked independently.
- No live-device/browser visual acceptance run was possible for mobile layout. Existing static responsive regression checks passed.

## Phase boundary

No later redesign or unrelated feature work was started. This phase only connects and verifies the approved rate system through Trade.

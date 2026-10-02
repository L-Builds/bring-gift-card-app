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

## Verification after the 2 October 2026 stabilization

- The configured backend PostgreSQL suite passed **87 tests** on a disposable local database after the rate-page, trade-display, and naira-symbol amendments. Four existing FastAPI `on_event` deprecation warnings remain.
- Frontend `npm run typecheck`, `npm run check:web` (**93/93**), and `npm run build:web` passed. The web export uses the same-origin `/api` route.
- In a local browser at a **320 px** viewport, a test-only API fixture showed All Cards, the left country rail, both Physical/Code controls, and the selected per-unit rate without clipping. Switching to Code changed the displayed amount. The fixture amounts were never added to production or seed data.
- Migrations `011`–`013` applied transactionally to a Neon clone. The cloned latest API passed customer and General Manager login/authorization and rate/catalog reads. A separate live deployment report records the production cutover.
- The Phase 6 database acceptance test covers headline/Popular discovery, detailed-rate quote math, stale-rate rejection, trade creation, country removal, historical snapshots, and accurate `is_tradable` state when detailed rates are removed.

## Remaining verification and release decision

- The local browser fixture did not test a complete authenticated Trade submission, the admin editor visually, external payout providers, email/Google integrations, or real mobile devices.
- Running `pytest tests` bypasses `pytest.ini` and collects older files outside the configured suite. Those files use synchronous calls against an async HTTP fixture, require an independent server on port 8000, or need optional Mongo tooling. They fail in this local setup; the configured `python -m pytest` suite above passes. No production code was changed to satisfy those older harness assumptions.
- The legacy Apple US rows have conflicting per-unit amounts, so safe migration does not create an approved simplified Physical/Code detailed rate. Apple trading remains unavailable under the new model until management publishes the actual Physical and Code rates. No example payout value is seeded.
- The legacy `card_value_usd` field and `$` face-value review remain for all card countries. Non-US card value currency semantics were not defined by the Phase 6 examples; resolve them before enabling those card-country rates.

## Phase boundary

No later redesign or unrelated feature work was started. This phase only connects and verifies the approved rate system through Trade.

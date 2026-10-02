# Phase 1 — Rate Model Cleanup

## Scope completed

This phase changes only the underlying current-rate model and the NGN customer-facing currency symbol behavior. It does **not** build the Phase 2 headline-rate admin editor, Phase 3 detailed-rate admin workspace, Phase 4 All Cards redesign, Phase 5 individual-card redesign, or Phase 6 trade integration.

## New current-rate model

- `headline_rates` is the independent simple headline-rate store. It has one rate per card + payout market and contains no card denomination, range, country, or submission-type dependency.
- `detailed_rates` is the independent detailed-rate store: `Card → Country → Physical/Code → Rate per unit`. It contains no denomination or range columns.
- Existing `card_rates` rows are retained as the legacy denomination/range model because existing trades and the current pre-Phase-6 trade flow still reference that contract.

## Migration behavior

Migration `012_rate_model_cleanup.sql`:

1. Creates the two new rate tables.
2. Backfills a headline only from an explicit active legacy headline with an exact per-unit value.
3. Backfills a detailed Card/Country/Physical-or-Code row only when every active legacy row in that exact group agrees on one per-unit rate.
4. Leaves ambiguous legacy groups unconfigured rather than selecting or inventing a rate.
5. Does not update, delete, or rewrite any legacy `card_rates` row.

The Apple values in older seed/reference files are not converted into new business rules when their denomination rows disagree. They remain preserved in the legacy table until management intentionally configures the simplified detailed rate in the later admin phase.

## Currency display

The database continues to store Nigeria's ISO currency code as `NGN`. Customer-facing formatting now requests the narrow NGN symbol so displayed amounts use `₦` instead of the text `NGN`.

## Compatibility boundary

The existing customer/admin rate screens and trade matcher remain on the legacy contract in this phase so working functionality is not redesigned or prematurely moved into later phases. The new tables are the schema foundation that Phases 2–6 will adopt one at a time.

## Verification in this handoff

Passed:

- Python syntax compilation for the affected backend modules.
- Static schema checks confirming the new headline and detailed tables have no denomination/range columns.
- Migration-preservation checks confirming migration 012 contains no `UPDATE`, `DELETE`, or `DROP` operation against legacy `card_rates` rows.
- Legacy rate-selection compatibility smoke check.
- Frontend source/regression checks: **81/81 passed**.
- NGN display-symbol check: `₦1,138.41` is produced instead of `NGN 1,138.41`.

Not run in this workspace:

- The migration was not executed against Neon or another PostgreSQL database because no test/production database URL was provided to this workspace.
- The full PostgreSQL-backed backend pytest suite was therefore not run.
- Full TypeScript typecheck/build was not completed because project dependencies were not present locally; an attempted dependency install did not complete. The source-only frontend regression suite did complete and passed 81/81.

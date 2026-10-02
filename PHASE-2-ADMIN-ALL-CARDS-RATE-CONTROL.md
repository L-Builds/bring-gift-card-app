# Phase 2 — Admin All Cards Rate Control

## Scope completed

This phase adds only the simple admin control for the independent headline rate created in Phase 1 and connects Popular Gift Cards to that same headline-rate source. It does **not** build the Phase 3 detailed-rate admin workspace, Phase 4 customer All Cards redesign, Phase 5 individual-card redesign, or Phase 6 trade integration.

## Admin headline-rate control

On Admin → Rates, the selected card and payout market now have one simple editor:

- **All Cards Display Rate**
- **Base:** fixed at `$1`
- **Payout:** one editable amount in the selected payout market currency (for Nigeria this displays `₦`)
- **Save:** upserts one `headline_rates` row for that card + payout market

Saving the same card + payout market updates the existing headline row and increments its version instead of creating another maintained price.

## Single source for Popular Gift Cards

Popular Gift Cards now reads its main price from `headline_rates`. The Popular configuration still stores only placement and its optional bonus settings. Bonus amount, bonus market, and minimum card value remain separate from the main rate.

## Compatibility boundary

The existing legacy denomination/range editor and trade matcher remain in place for current trading compatibility until their later phases. The legacy rate editor no longer exposes the "Use as All Cards display rate" control, so management does not maintain the main customer-facing price in two places.

Existing legacy `card_rates.is_headline` data is preserved; this phase does not delete historical or compatibility rows.

## Verification targets

- Admin headline GET/POST endpoints use `headline_rates`.
- Re-saving the same card + market updates one row rather than creating duplicate headline prices.
- Popular admin/public endpoints read `headline_rates`.
- Home Popular Gift Cards renders `rate_minor_per_unit` from the independent headline record.
- Optional Popular bonus remains separate.
- Legacy trade-rate UI remains available but can no longer set the All Cards headline price.

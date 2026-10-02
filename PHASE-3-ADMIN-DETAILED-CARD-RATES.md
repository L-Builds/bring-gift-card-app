# Phase 3 — Admin Detailed Card Rates

This phase changes only the admin management path for the Phase 1 `detailed_rates` model.

## Implemented

- Admin Rates now has a dedicated Detailed Card Rates workspace below the existing All Cards Display Rate.
- Countries are card-specific and payout-market-specific. No country is automatically added to every card.
- Management can add a country/region code, then save one per-unit rate for each submission type the card supports:
  - Physical → rate per unit
  - Code (`ecode`) → rate per unit
- Management can disable or re-enable a configured country. The action applies to that country's current Physical/Code detailed-rate rows together.
- Management can remove a configured country. Removal archives its current detailed-rate rows so they disappear from the admin country list without deleting legacy trade-rate history.
- The old denomination/range editor is no longer exposed in the Admin Rates workspace. Its backend APIs and legacy `card_rates` records remain intact for the current pre-Phase-6 trade flow and historical compatibility.

## Deliberately not changed

- Customer All Cards layout.
- Individual customer gift-card rate page.
- Trade quote/payout selection.
- Legacy `card_rates` data or historical trade snapshots.
- Popular Gift Card bonus behavior.
- Phase 2 headline-rate behavior.

## Verification notes

See the delivery report for the tests that were executed in this workspace and any environment-dependent tests that could not run.

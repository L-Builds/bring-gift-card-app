# Phase 4 — Customer All Cards Page

## Scope completed

This phase changes only the customer **Rates → All Cards** section. It does **not** start the Phase 5 individual-card rates redesign or Phase 6 trade integration.

## All Cards presentation

Each All Cards row now contains only:

- Card logo
- Card name
- One headline rate formatted as `$1 = <payout-market amount>`

The row no longer displays the country/rate count summary, `Display rate`, a `View rates` label, or Popular Gift Card bonus content. The page subtitle no longer says `Payouts shown in NGN for Nigeria` (or the equivalent market-specific technical wording).

## Rate source

All Cards now reads the independent `headline_rates` model created in Phase 1 and managed by the Phase 2 admin editor. It does not derive its displayed price from legacy denomination rows or `card_rates.is_headline`. This keeps All Cards and Popular Gift Cards on the same main-rate source while Popular bonus remains separate.

Card discovery/navigation remains on the existing pre-Phase-6 compatibility path so this phase does not alter trade availability or prematurely move the individual-card/trade flows.

## Compatibility boundary

The existing individual-card country tabs, denomination/range table, and Trade flow remain unchanged for their later phases. Legacy `card_rates` data is preserved.

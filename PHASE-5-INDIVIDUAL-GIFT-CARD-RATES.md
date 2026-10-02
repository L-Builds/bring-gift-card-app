# Phase 5 — Individual Gift Card Rates Page

## Scope completed

- Customer individual-card rate view now reads the Phase 3 `detailed_rates` model.
- Countries configured by management are shown vertically on the left.
- Physical / Code is a two-state toggle on the right.
- The selected country and selected type resolve to one `Rate per unit` value.
- Disabled, archived, or unconfigured detailed-rate rows are not exposed by the public detailed-rate endpoint.
- `General`, country/rate counts, card-value columns, range labels, and denomination lists are not shown on the individual-card view.

## Intentionally unchanged

- All Cards continues to use the independent Phase 2 headline rate.
- Popular Gift Cards and its bonus behavior are unchanged.
- Admin Detailed Card Rates remains the Phase 3 management source.
- Trade quoting/submission still uses the legacy `card_rates` path and was not integrated with `detailed_rates` in this phase. That remains Phase 6 work.
- No database migration was added or changed.

## Verification boundary

Static/frontend regression checks verify the intended customer layout and source separation. Backend Python syntax is compiled. Database-backed API tests require `TEST_DATABASE_URL`; if that variable is unavailable, those tests cannot be claimed as executed.

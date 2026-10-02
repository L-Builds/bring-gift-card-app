-- Phase 6 trade-rate cutover marker.
--
-- No historical pricing rows are rewritten or deleted here. The schema needed by
-- the simplified model already exists from 012_rate_model_cleanup. This migration
-- deliberately records the production cutover point so runtime deployments cannot
-- start on code that prices new trades from detailed_rates unless the database has
-- also applied every checked-in migration through this phase.
--
-- Historical trades keep their immutable snapshots and any legacy card_rates ids.
-- New quotes/trades use detailed_rates: Card + Country + Physical/Code + rate per unit.

COMMENT ON TABLE detailed_rates IS 'Current live trade pricing source: Card + Country + Physical/Code + one rate per unit.';
COMMENT ON TABLE headline_rates IS 'Current simple headline pricing source for All Cards and Popular Gift Cards; separate from trade pricing.';
COMMENT ON TABLE card_rates IS 'Legacy denomination/range pricing retained for historical compatibility and legacy admin history; not used for new quotes after Phase 6.';
COMMENT ON TABLE trades IS 'Immutable trade snapshots; historical rows may reference legacy card_rates ids while Phase 6+ rows reference detailed_rates ids.';

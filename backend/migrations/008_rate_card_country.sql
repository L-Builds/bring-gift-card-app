-- Separate the gift-card country/region from the customer's payout market.
-- Existing rows remain valid as "General" rules until management assigns a
-- specific card country/region. Historical trade snapshots are untouched.
ALTER TABLE card_rates ADD COLUMN card_country text NOT NULL DEFAULT '';

DROP INDEX IF EXISTS card_rates_rule_unique;
DROP INDEX IF EXISTS card_rates_rule_lookup;

CREATE UNIQUE INDEX card_rates_rule_unique ON card_rates (
  brand_id,
  market_code,
  card_country,
  face_value,
  submission_type,
  COALESCE(range_min, -1),
  COALESCE(range_max, -1)
);

CREATE INDEX card_rates_rule_lookup ON card_rates (
  brand_id, market_code, card_country, face_value, submission_type, is_active
);


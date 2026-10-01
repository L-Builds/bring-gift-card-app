-- Extend denomination rates into company rate rules without changing historical
-- trade snapshots. Existing rows remain legacy "any" rules with no range.
ALTER TABLE card_rates ADD COLUMN submission_type text;
ALTER TABLE card_rates ADD COLUMN range_min bigint;
ALTER TABLE card_rates ADD COLUMN range_max bigint;
ALTER TABLE card_rates ADD COLUMN rate_minor_per_usd bigint;
ALTER TABLE card_rates ADD COLUMN archived_at timestamptz;

UPDATE card_rates SET submission_type = 'any' WHERE submission_type IS NULL;
ALTER TABLE card_rates ALTER COLUMN submission_type SET DEFAULT 'any';
ALTER TABLE card_rates ALTER COLUMN submission_type SET NOT NULL;

-- Preserve existing payout_minor exactly. Populate the per-$1 rate only where
-- the historical total payout divides evenly by the face value.
UPDATE card_rates
SET rate_minor_per_usd = payout_minor / face_value
WHERE rate_minor_per_usd IS NULL
  AND face_value > 0
  AND payout_minor > 0
  AND (payout_minor % face_value) = 0;

ALTER TABLE card_rates DROP CONSTRAINT card_rates_denomination_unique;
ALTER TABLE card_rates ADD CONSTRAINT card_rates_submission_type_valid CHECK (
  submission_type IN ('any', 'physical', 'ecode')
);
ALTER TABLE card_rates ADD CONSTRAINT card_rates_range_valid CHECK (
  (range_min IS NULL AND range_max IS NULL)
  OR
  (range_min IS NOT NULL AND range_max IS NOT NULL AND range_min >= 0 AND range_max >= range_min)
);
ALTER TABLE card_rates ADD CONSTRAINT card_rates_rate_per_usd_positive CHECK (
  rate_minor_per_usd IS NULL OR rate_minor_per_usd > 0
);

CREATE UNIQUE INDEX card_rates_rule_unique ON card_rates (
  brand_id,
  market_code,
  face_value,
  submission_type,
  COALESCE(range_min, -1),
  COALESCE(range_max, -1)
);

CREATE INDEX card_rates_rule_lookup ON card_rates (
  brand_id, market_code, face_value, submission_type, is_active
);

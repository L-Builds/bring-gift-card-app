-- Phase 5: admin-selected headline rates plus exact trade-rule integration.
-- Headline is presentation metadata only; it points at an existing active rate
-- rather than duplicating or recalculating any company rate.
ALTER TABLE card_rates ADD COLUMN is_headline boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX card_rates_headline_unique
ON card_rates (brand_id, market_code)
WHERE is_headline;

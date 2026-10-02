-- Phase 1: permanently separate the simple headline rate from detailed trading rates.
--
-- The existing card_rates table is deliberately retained unchanged as the legacy
-- denomination/range model. Existing trades reference those rows by rate_id and
-- keep their immutable rate snapshots, so this migration never updates or deletes
-- historical card_rates records.
--
-- New model:
--   headline_rates: one simple per-unit display rate per card + payout market.
--   detailed_rates: Card -> Country -> Physical/Code -> Rate per unit.
--
-- Neither new table has face-value, denomination, or range columns.

CREATE TABLE headline_rates (
    _key TEXT NOT NULL,
    extra JSONB NOT NULL,
    id TEXT NOT NULL,
    brand_id TEXT NOT NULL,
    market_code TEXT NOT NULL,
    rate_minor_per_unit BIGINT NOT NULL,
    version BIGINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (_key),
    CONSTRAINT headline_rates_brand_fk FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
    CONSTRAINT headline_rates_market_fk FOREIGN KEY (market_code) REFERENCES markets(code),
    CONSTRAINT headline_rates_card_market_unique UNIQUE (brand_id, market_code),
    CONSTRAINT headline_rates_positive CHECK (rate_minor_per_unit > 0 AND version > 0)
);

CREATE UNIQUE INDEX headline_rates_id_unique ON headline_rates (id);
CREATE INDEX headline_rates_market_active ON headline_rates (market_code, is_active);

CREATE TABLE detailed_rates (
    _key TEXT NOT NULL,
    extra JSONB NOT NULL,
    id TEXT NOT NULL,
    brand_id TEXT NOT NULL,
    market_code TEXT NOT NULL,
    card_country TEXT NOT NULL,
    submission_type TEXT NOT NULL,
    rate_minor_per_unit BIGINT NOT NULL,
    version BIGINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (_key),
    CONSTRAINT detailed_rates_brand_fk FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
    CONSTRAINT detailed_rates_market_fk FOREIGN KEY (market_code) REFERENCES markets(code),
    CONSTRAINT detailed_rates_country_present CHECK (btrim(card_country) <> ''),
    CONSTRAINT detailed_rates_submission_type_valid CHECK (submission_type IN ('physical', 'ecode')),
    CONSTRAINT detailed_rates_positive CHECK (rate_minor_per_unit > 0 AND version > 0),
    CONSTRAINT detailed_rates_card_country_type_unique UNIQUE (brand_id, market_code, card_country, submission_type)
);

CREATE UNIQUE INDEX detailed_rates_id_unique ON detailed_rates (id);
CREATE INDEX detailed_rates_lookup ON detailed_rates (brand_id, market_code, card_country, submission_type, is_active);

-- Backfill the separate headline model only from an explicit legacy headline.
-- A legacy row must have an exact per-unit rate; no value is guessed.
INSERT INTO headline_rates (
    _key, extra, id, brand_id, market_code, rate_minor_per_unit,
    version, is_active, created_at, updated_at, archived_at
)
SELECT
    'headline:' || r.brand_id || ':' || r.market_code,
    jsonb_build_object('backfilled_from', 'card_rates', 'legacy_rate_id', r.id),
    'headline:' || r.brand_id || ':' || r.market_code,
    r.brand_id,
    r.market_code,
    COALESCE(
        r.rate_minor_per_usd,
        CASE
            WHEN r.face_value > 0 AND r.payout_minor > 0 AND (r.payout_minor % r.face_value) = 0
                THEN r.payout_minor / r.face_value
            ELSE NULL
        END
    ),
    GREATEST(COALESCE(r.version, 1), 1),
    TRUE,
    COALESCE(r.updated_at, now()),
    COALESCE(r.updated_at, now()),
    NULL
FROM card_rates r
WHERE r.is_headline = TRUE
  AND r.is_active = TRUE
  AND r.archived_at IS NULL
  AND COALESCE(
        r.rate_minor_per_usd,
        CASE
            WHEN r.face_value > 0 AND r.payout_minor > 0 AND (r.payout_minor % r.face_value) = 0
                THEN r.payout_minor / r.face_value
            ELSE NULL
        END
      ) IS NOT NULL
ON CONFLICT (brand_id, market_code) DO NOTHING;

-- Backfill a detailed rate only when all active legacy denomination/range rows
-- for that exact Card + Country + Physical/Code combination agree on one rate.
-- Ambiguous groups are intentionally left for management to configure later;
-- this migration never chooses one old denomination rate over another.
WITH normalized AS (
    SELECT
        r.brand_id,
        r.market_code,
        btrim(upper(r.card_country)) AS card_country,
        r.submission_type,
        COALESCE(
            r.rate_minor_per_usd,
            CASE
                WHEN r.face_value > 0 AND r.payout_minor > 0 AND (r.payout_minor % r.face_value) = 0
                    THEN r.payout_minor / r.face_value
                ELSE NULL
            END
        ) AS rate_minor_per_unit,
        GREATEST(COALESCE(r.version, 1), 1) AS version
    FROM card_rates r
    WHERE r.is_active = TRUE
      AND r.archived_at IS NULL
      AND btrim(COALESCE(r.card_country, '')) <> ''
      AND r.submission_type IN ('physical', 'ecode')
), unambiguous AS (
    SELECT
        brand_id,
        market_code,
        card_country,
        submission_type,
        MIN(rate_minor_per_unit) AS rate_minor_per_unit,
        MAX(version) AS version,
        COUNT(*) AS legacy_row_count,
        COUNT(DISTINCT rate_minor_per_unit) AS distinct_rate_count
    FROM normalized
    WHERE rate_minor_per_unit IS NOT NULL
    GROUP BY brand_id, market_code, card_country, submission_type
    HAVING COUNT(rate_minor_per_unit) = COUNT(*)
       AND COUNT(DISTINCT rate_minor_per_unit) = 1
)
INSERT INTO detailed_rates (
    _key, extra, id, brand_id, market_code, card_country, submission_type,
    rate_minor_per_unit, version, is_active, created_at, updated_at, archived_at
)
SELECT
    'detail:' || brand_id || ':' || market_code || ':' || card_country || ':' || submission_type,
    jsonb_build_object('backfilled_from', 'card_rates', 'legacy_row_count', legacy_row_count),
    'detail:' || brand_id || ':' || market_code || ':' || card_country || ':' || submission_type,
    brand_id,
    market_code,
    card_country,
    submission_type,
    rate_minor_per_unit,
    version,
    TRUE,
    now(),
    now(),
    NULL
FROM unambiguous
ON CONFLICT (brand_id, market_code, card_country, submission_type) DO NOTHING;

COMMENT ON TABLE headline_rates IS 'Simple card headline rates for All Cards and Popular Gift Cards; independent of denomination trading rules.';
COMMENT ON TABLE detailed_rates IS 'Current detailed trading-rate model: Card + Country + Physical/Code + one rate per unit.';
COMMENT ON TABLE card_rates IS 'Legacy denomination/range rate rows retained for current compatibility and historical trade references until later integration phases.';

-- Phase 1: dedicated Popular Gift Cards collection and optional bonus controls.
-- Popular cards reference existing catalog brands; they do not duplicate card or rate data.
-- Main displayed rate remains linked to the existing admin-selected headline rate.

CREATE TABLE popular_cards (
    _key TEXT NOT NULL,
    extra JSONB NOT NULL,
    brand_id TEXT NOT NULL,
    bonus_market_code TEXT,
    position BIGINT NOT NULL,
    bonus_amount_minor BIGINT,
    min_card_value_usd BIGINT,
    bonus_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (_key),
    CONSTRAINT popular_cards_brand_fk FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
    CONSTRAINT popular_cards_bonus_market_fk FOREIGN KEY (bonus_market_code) REFERENCES markets(code),
    CONSTRAINT popular_cards_position_range CHECK (position BETWEEN 1 AND 8),
    CONSTRAINT popular_cards_bonus_amount_positive CHECK (bonus_amount_minor IS NULL OR bonus_amount_minor > 0),
    CONSTRAINT popular_cards_min_card_value_positive CHECK (min_card_value_usd IS NULL OR min_card_value_usd > 0),
    CONSTRAINT popular_cards_bonus_complete CHECK (
        NOT bonus_enabled OR (
            bonus_market_code IS NOT NULL AND bonus_market_code <> '' AND
            bonus_amount_minor IS NOT NULL AND bonus_amount_minor > 0
        )
    ),
    CONSTRAINT popular_cards_brand_unique UNIQUE (brand_id),
    CONSTRAINT popular_cards_position_unique UNIQUE (position)
);

CREATE INDEX popular_cards_order ON popular_cards (position);

-- Preserve any existing Popular selections, but enforce the new maximum of 8.
WITH ranked AS (
    SELECT id AS brand_id,
           row_number() OVER (ORDER BY sort_order NULLS LAST, name, id) AS position
    FROM brands
    WHERE is_popular = TRUE AND archived_at IS NULL
), kept AS (
    SELECT brand_id, position FROM ranked WHERE position <= 8
)
INSERT INTO popular_cards (
    _key, extra, brand_id, bonus_market_code, position,
    bonus_amount_minor, min_card_value_usd, bonus_enabled, created_at, updated_at
)
SELECT
    'popular_' || brand_id,
    '{}'::jsonb,
    brand_id,
    NULL,
    position,
    NULL,
    NULL,
    FALSE,
    now(),
    now()
FROM kept;

-- If an older build had more than eight is_popular flags, only the first eight
-- remain in the dedicated collection so the public Home contract stays bounded.
UPDATE brands b
SET is_popular = EXISTS (SELECT 1 FROM popular_cards p WHERE p.brand_id = b.id)
WHERE b.is_popular = TRUE;

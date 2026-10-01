-- Phase 6: seed the user-supplied Apple / iTunes United States rates for the
-- Nigeria payout market. Amounts are integer kobo per US dollar.
--
-- The approved Phase 5 matcher treats range_min/range_max as the trade's total
-- face value (card value × quantity) and deliberately rejects equally specific
-- overlapping active rules. The supplied reference contains overlapping rows.
-- Per the Phase 6 instruction, ambiguous rows are NOT guessed or activated.
-- The explicit Apple All Cards display rate in the supplied reference is
-- ₦1,151.76/$1, so the matching $50 Physical 400–500 row is retained and used
-- as the headline while its overlapping 350–500 row remains unconfigured.
--
-- Supplied rows intentionally left unconfigured until their extra condition is
-- clarified:
--   $50 ecode 300–500 @ ₦1,077.39/$1 — omitted: overlaps the supplied $50 Code 100–500 rule.
--   $50 physical 0–50 @ ₦1,119.34/$1 — omitted: overlaps the supplied $50 Physical 50–51 rule at total value $50.
--   $50 ecode 100–500 @ ₦1,010.65/$1 — omitted: overlaps the supplied $50 Code 100–200 and 300–500 rules.
--   $50 physical 50–51 @ ₦1,109.81/$1 — omitted: overlaps the supplied $50 Physical 0–50 rule at total value $50.
--   $50 physical 350–500 @ ₦1,113.62/$1 — omitted: overlaps the supplied headline $50 Physical 400–500 rule.
--   $50 ecode 100–200 @ ₦1,069.76/$1 — omitted: overlaps the supplied $50 Code 100–500 rule.
--   $10 physical 0–10 @ ₦1,081.20/$1 — omitted: overlaps the supplied $10 Physical 10–20 rule at total value $10.
--   $10 physical 10–20 @ ₦1,067.86/$1 — omitted: overlaps the supplied $10 Physical 0–10 rule at total value $10.
--   $5 physical 10–45 @ ₦1,083.11/$1 — omitted: overlaps other supplied $5 Physical ranges.
--   $5 physical 10–95 @ ₦1,083.11/$1 — omitted: overlaps other supplied $5 Physical ranges.
--   $5 physical 55–70 @ ₦1,088.83/$1 — omitted: overlaps other supplied $5 Physical ranges.
--   $5 physical 30–45 @ ₦1,088.83/$1 — omitted: overlaps other supplied $5 Physical ranges.
--   $5 physical 55–75 @ ₦1,088.83/$1 — omitted: overlaps other supplied $5 Physical ranges.
--   $5 physical 30–80 @ ₦1,086.92/$1 — omitted: overlaps other supplied $5 Physical ranges.
--   $5 physical 255–295 @ ₦1,086.92/$1 — omitted: overlaps the supplied $5 Physical 255–495 rule.
--   $5 physical 10–96 @ ₦1,058.50/$1 — omitted: overlaps other supplied $5 Physical ranges.
--   $5 physical 255–495 @ ₦1,102.18/$1 — omitted: overlaps the supplied $5 Physical 255–295 rule.

DO $$
DECLARE
    apple_id text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM markets WHERE code = 'NG') THEN
        RAISE EXCEPTION 'Nigeria market (NG) must exist before seeding Apple US rates';
    END IF;

    SELECT id INTO apple_id
    FROM brands
    WHERE lower(coalesce(slug, '')) = 'apple-itunes'
       OR lower(coalesce(name, '')) IN ('apple / itunes', 'apple/itunes', 'apple itunes', 'apple', 'apple card', 'itunes')
    ORDER BY CASE WHEN lower(coalesce(slug, '')) = 'apple-itunes' THEN 0 ELSE 1 END, sort_order NULLS LAST, id
    LIMIT 1;

    IF apple_id IS NULL THEN
        RAISE EXCEPTION 'Apple / iTunes catalog card must exist before seeding Apple US rates';
    END IF;

    -- This is the first approved live card-rate set, so publish Apple and keep it
    -- in the previously agreed Popular group. Preserve any other configured card
    -- countries while ensuring US and both supported submission types are present.
    UPDATE brands
    SET is_active = TRUE,
        is_popular = TRUE,
        archived_at = NULL,
        extra = jsonb_set(
            jsonb_set(
                COALESCE(extra, '{}'::jsonb),
                '{countries}',
                CASE
                    WHEN COALESCE(extra->'countries', '[]'::jsonb) @> '["US"]'::jsonb
                        THEN COALESCE(extra->'countries', '[]'::jsonb)
                    ELSE COALESCE(extra->'countries', '[]'::jsonb) || '["US"]'::jsonb
                END,
                TRUE
            ),
            '{submission_types}',
            '["physical","ecode"]'::jsonb,
            TRUE
        )
    WHERE id = apple_id;

    -- Headline is admin/presentation metadata. Clear any old Apple/NG headline
    -- before assigning the explicit ₦1,151.76 supplied display rate below.
    UPDATE card_rates
    SET is_headline = FALSE, updated_at = now()
    WHERE brand_id = apple_id AND market_code = 'NG' AND is_headline = TRUE;

    WITH supplied(face_value, range_min, range_max, submission_type, rate_minor_per_usd, is_headline) AS (
        VALUES
        (100, 300, 500, 'ecode', 107739, FALSE),
        (50, 400, 500, 'physical', 115176, TRUE),
        (50, 100, 150, 'physical', 111553, FALSE),
        (50, 250, 251, 'physical', 107167, FALSE),
        (50, 200, 201, 'physical', 111171, FALSE),
        (25, 0, 25, 'physical', 105832, FALSE),
        (20, NULL, NULL, 'ecode', 104879, FALSE),
        (20, 0, 20, 'physical', 108883, FALSE),
        (15, 0, 15, 'physical', 108120, FALSE),
        (10, NULL, NULL, 'ecode', 104879, FALSE),
        (10, 80, 90, 'physical', 108883, FALSE),
        (10, 10, 20, 'ecode', 101065, FALSE),
        (5, 25, 80, 'ecode', 101065, FALSE),
        (5, 105, 145, 'physical', 109837, FALSE),
        (5, 155, 195, 'physical', 109837, FALSE),
        (5, 205, 240, 'physical', 109837, FALSE),
        (5, 105, 495, 'ecode', 105260, FALSE),
        (1, 105, 245, 'physical', 108883, FALSE)
    )
    INSERT INTO card_rates (
        _key, extra, id, brand_id, market_code, card_country, submission_type,
        face_value, payout_minor, rate_minor_per_usd, range_min, range_max,
        version, is_active, is_headline, updated_at, archived_at
    )
    SELECT
        'apple_us_' || face_value || '_' || submission_type || '_' ||
            COALESCE(range_min::text, 'fixed') || '_' || COALESCE(range_max::text, 'fixed'),
        '{"seed":"apple_us_phase6","source":"user_supplied_reference"}'::jsonb,
        'apple_us_' || face_value || '_' || submission_type || '_' ||
            COALESCE(range_min::text, 'fixed') || '_' || COALESCE(range_max::text, 'fixed'),
        apple_id,
        'NG',
        'US',
        submission_type,
        face_value,
        face_value * rate_minor_per_usd,
        rate_minor_per_usd,
        range_min,
        range_max,
        1,
        TRUE,
        is_headline,
        now(),
        NULL
    FROM supplied
    ON CONFLICT (
        brand_id, market_code, card_country, face_value, submission_type,
        (COALESCE(range_min, -1)), (COALESCE(range_max, -1))
    ) DO UPDATE SET
        payout_minor = EXCLUDED.payout_minor,
        rate_minor_per_usd = EXCLUDED.rate_minor_per_usd,
        is_active = TRUE,
        is_headline = EXCLUDED.is_headline,
        archived_at = NULL,
        updated_at = now(),
        version = card_rates.version + 1,
        extra = card_rates.extra || EXCLUDED.extra;
END $$;

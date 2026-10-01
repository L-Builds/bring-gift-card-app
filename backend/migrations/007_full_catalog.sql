-- Phase 2: preload the agreed Bring Gift Card catalog as inactive management records.
-- No rates are created here and no seeded card is published to customers until
-- management explicitly activates it and a usable payout rule exists.
ALTER TABLE brands ADD COLUMN archived_at TIMESTAMPTZ;

WITH desired(name, slug, category, color, aliases, sort_order) AS (
    VALUES
        ('Apple / iTunes', 'apple-itunes', 'Entertainment', '#111111', ARRAY['apple / itunes','apple/itunes','apple itunes','apple','itunes']::text[], 1),
        ('Steam', 'steam', 'Gaming', '#1B2838', ARRAY['steam']::text[], 2),
        ('Razer Gold', 'razer-gold', 'Gaming', '#C89B2C', ARRAY['razer gold','razer']::text[], 3),
        ('Amazon', 'amazon', 'Shopping', '#FF9900', ARRAY['amazon']::text[], 4),
        ('Xbox', 'xbox', 'Gaming', '#107C10', ARRAY['xbox']::text[], 5),
        ('eBay', 'ebay', 'Shopping', '#E53238', ARRAY['ebay']::text[], 6),
        ('Google Play', 'google-play', 'Entertainment', '#34A853', ARRAY['google play']::text[], 7),
        ('PlayStation', 'playstation', 'Gaming', '#006FCD', ARRAY['playstation','play station']::text[], 8),
        ('Sephora', 'sephora', 'Beauty', '#111111', ARRAY['sephora']::text[], 9),
        ('Vanilla', 'vanilla', 'Payments', '#D91F2B', ARRAY['vanilla','vanilla visa']::text[], 10),
        ('Visa', 'visa', 'Payments', '#1A1F71', ARRAY['visa']::text[], 11),
        ('American Express', 'american-express', 'Payments', '#006FCF', ARRAY['american express','amex']::text[], 12),
        ('Walmart', 'walmart', 'Shopping', '#0071CE', ARRAY['walmart','wal-mart']::text[], 13),
        ('Target', 'target', 'Shopping', '#CC0000', ARRAY['target']::text[], 14),
        ('Nike', 'nike', 'Fashion', '#111111', ARRAY['nike']::text[], 15),
        ('Nordstrom', 'nordstrom', 'Fashion', '#111111', ARRAY['nordstrom']::text[], 16),
        ('Macy''s', 'macys', 'Shopping', '#E21D2E', ARRAY['macy''s','macys','macy']::text[], 17),
        ('Foot Locker', 'foot-locker', 'Fashion', '#E31B23', ARRAY['foot locker','footlocker']::text[], 18),
        ('Best Buy', 'best-buy', 'Shopping', '#0046BE', ARRAY['best buy','bestbuy']::text[], 19),
        ('GameStop', 'gamestop', 'Gaming', '#E2231A', ARRAY['gamestop','game stop']::text[], 20),
        ('Roblox', 'roblox', 'Gaming', '#111111', ARRAY['roblox']::text[], 21),
        ('Mastercard', 'mastercard', 'Payments', '#EB001B', ARRAY['mastercard','master card']::text[], 22),
        ('Paysafecard', 'paysafecard', 'Payments', '#00457C', ARRAY['paysafecard','paysafe card']::text[], 23),
        ('Netflix', 'netflix', 'Entertainment', '#E50914', ARRAY['netflix']::text[], 24),
        ('Adidas', 'adidas', 'Fashion', '#111111', ARRAY['adidas']::text[], 25),
        ('Kohl''s', 'kohls', 'Shopping', '#111111', ARRAY['kohl''s','kohls','kohl']::text[], 26),
        ('Saks', 'saks', 'Fashion', '#111111', ARRAY['saks','saks fifth avenue']::text[], 27),
        ('Ulta', 'ulta', 'Beauty', '#E86A54', ARRAY['ulta','ulta beauty']::text[], 28),
        ('OffGamers', 'offgamers', 'Gaming', '#F47A20', ARRAY['offgamers','off gamers']::text[], 29),
        ('Netspend Visa', 'netspend-visa', 'Payments', '#D8272F', ARRAY['netspend visa','netspend']::text[], 30),
        ('One4all', 'one4all', 'Shopping', '#D8272F', ARRAY['one4all','one 4 all']::text[], 31)
)
INSERT INTO brands (
    _key, extra, id, name, slug, category, color, rate_kobo_per_usd,
    sort_order, is_active, is_popular, created_at, logo_path, archived_at
)
SELECT
    'catalog_seed_' || d.slug,
    jsonb_build_object(
        'countries', '[]'::jsonb,
        'subcategories', '[]'::jsonb,
        'submission_types', '["physical","ecode"]'::jsonb,
        'catalog_seed', true
    ),
    'catalog_' || replace(d.slug, '-', '_'),
    d.name,
    d.slug,
    d.category,
    d.color,
    0,
    d.sort_order,
    false,
    false,
    now(),
    NULL,
    NULL
FROM desired d
WHERE NOT EXISTS (
    SELECT 1
    FROM brands b
    WHERE lower(coalesce(b.slug, '')) = d.slug
       OR lower(coalesce(b.name, '')) = ANY(d.aliases)
);

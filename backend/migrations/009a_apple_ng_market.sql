-- The Apple US rate seed in 010 needs the approved Nigeria payout market.
-- New installations run all migrations before bootstrap_markets.py; install
-- only this required market and preserve any existing management settings.
INSERT INTO markets (_key, extra, code, name, currency, minor_digits, is_active)
VALUES ('market:NG', '{}'::jsonb, 'NG', 'Nigeria', 'NGN', 2, TRUE)
ON CONFLICT DO NOTHING;

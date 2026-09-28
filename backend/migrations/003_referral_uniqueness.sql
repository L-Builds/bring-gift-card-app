-- Keep historical referral codes unchanged. Resolve any pre-existing duplicate
-- codes with the business owner before applying this migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users
    WHERE referral_code IS NOT NULL AND referral_code <> ''
    GROUP BY upper(referral_code)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate referral codes exist; reconcile them before applying 003_referral_uniqueness';
  END IF;
END $$;

CREATE UNIQUE INDEX users_referral_code_ci_unique ON users (upper(referral_code))
  WHERE referral_code IS NOT NULL AND referral_code <> '';

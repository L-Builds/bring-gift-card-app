-- A shared user-row lock serializes all ledger writers, including direct SQL.
CREATE FUNCTION bgc_guard_ledger_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wallet_currency text;
BEGIN
  SELECT COALESCE(currency, 'NGN') INTO wallet_currency FROM users WHERE id = NEW.user_id FOR UPDATE;
  IF NOT FOUND OR NEW.currency <> wallet_currency THEN
    RAISE EXCEPTION 'Ledger currency or owner does not match wallet' USING ERRCODE = '23514';
  END IF;
  IF NEW.type IN ('WITHDRAWAL_DEBIT', 'WITHDRAWAL_REVERSAL') AND NOT EXISTS (
    SELECT 1 FROM withdrawals WHERE id = NEW.ref_id AND user_id = NEW.user_id
      AND currency = NEW.currency AND amount_kobo = abs(NEW.amount_kobo)
  ) THEN
    RAISE EXCEPTION 'Withdrawal ledger reference mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW.type = 'TRADE_CREDIT' AND NOT EXISTS (
    SELECT 1 FROM trades WHERE id = NEW.ref_id AND user_id = NEW.user_id AND currency = NEW.currency
  ) THEN
    RAISE EXCEPTION 'Trade ledger reference mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_insert_guard BEFORE INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION bgc_guard_ledger_insert();

CREATE FUNCTION bgc_guard_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COALESCE(sum(amount_kobo),0) FROM ledger WHERE user_id = NEW.user_id) < 0 THEN
    RAISE EXCEPTION 'Wallet balance cannot become negative' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_nonnegative AFTER INSERT ON ledger DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bgc_guard_balance();

CREATE FUNCTION bgc_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Ledger entries are immutable; post a compensating entry' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger FOR EACH ROW EXECUTE FUNCTION bgc_append_only();

CREATE FUNCTION bgc_wallet_currency_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (COALESCE(OLD.currency,'NGN') IS DISTINCT FROM COALESCE(NEW.currency,'NGN')
      OR COALESCE(OLD.minor_digits,2) IS DISTINCT FROM COALESCE(NEW.minor_digits,2))
     AND EXISTS (SELECT 1 FROM ledger WHERE user_id = OLD.id) THEN
    RAISE EXCEPTION 'A funded wallet currency and precision are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_wallet_currency BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION bgc_wallet_currency_immutable();

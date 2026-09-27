-- Initial PostgreSQL schema. Generated once from reviewed SQLAlchemy metadata; never edit after applying.


CREATE TABLE abuse_counters (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	count BIGINT, 
	expires_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key)
)

;

CREATE INDEX abuse_counters_expiry ON abuse_counters (expires_at);


CREATE TABLE audit (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	actor TEXT, 
	action TEXT, 
	target TEXT, 
	version BIGINT, 
	at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key)
)

;

CREATE INDEX audit_action_date ON audit (action, at DESC);


CREATE TABLE brands (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT NOT NULL, 
	name TEXT, 
	slug TEXT, 
	category TEXT, 
	color TEXT, 
	rate_kobo_per_usd BIGINT, 
	sort_order BIGINT, 
	is_active BOOLEAN, 
	is_popular BOOLEAN, 
	created_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key)
)

;

CREATE INDEX brands_active_order ON brands (is_active, sort_order);

CREATE UNIQUE INDEX brands_id_unique ON brands (id);


CREATE TABLE legal (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT NOT NULL, 
	version BIGINT, 
	updated_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key)
)

;

CREATE UNIQUE INDEX legal_id_unique ON legal (id);


CREATE TABLE markets (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	code TEXT NOT NULL, 
	name TEXT, 
	currency TEXT NOT NULL, 
	minor_digits BIGINT NOT NULL, 
	is_active BOOLEAN, 
	PRIMARY KEY (_key), 
	UNIQUE (code), 
	CONSTRAINT markets_precision CHECK (minor_digits BETWEEN 0 AND 3)
)

;


CREATE TABLE payout_providers (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT NOT NULL, 
	adapter TEXT, 
	label TEXT, 
	enabled BOOLEAN, 
	PRIMARY KEY (_key)
)

;

CREATE UNIQUE INDEX payout_providers_id_unique ON payout_providers (id);


CREATE TABLE rate_changes (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT, 
	brand_id TEXT, 
	at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key)
)

;

CREATE INDEX rate_changes_brand_date ON rate_changes (brand_id, at DESC);

CREATE UNIQUE INDEX rate_changes_id_unique ON rate_changes (id);


CREATE TABLE settings (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT NOT NULL, 
	PRIMARY KEY (_key)
)

;

CREATE UNIQUE INDEX settings_id_unique ON settings (id);


CREATE TABLE users (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT NOT NULL, 
	email TEXT NOT NULL, 
	phone TEXT, 
	full_name TEXT, 
	role TEXT, 
	currency TEXT, 
	market_code TEXT, 
	referral_code TEXT, 
	referred_by TEXT, 
	kyc_status TEXT, 
	minor_digits BIGINT, 
	money_revision BIGINT, 
	token_version BIGINT, 
	pin_failed BIGINT, 
	disabled BOOLEAN, 
	notifications_enabled BOOLEAN, 
	created_at TIMESTAMP WITH TIME ZONE, 
	last_login_at TIMESTAMP WITH TIME ZONE, 
	pin_set_at TIMESTAMP WITH TIME ZONE, 
	pin_locked_until TIMESTAMP WITH TIME ZONE, 
	terms_accepted_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key), 
	CONSTRAINT users_precision CHECK (minor_digits BETWEEN 0 AND 3)
)

;

CREATE INDEX users_created ON users (created_at DESC);

CREATE UNIQUE INDEX users_email_unique ON users (email);

CREATE UNIQUE INDEX users_id_unique ON users (id);

CREATE UNIQUE INDEX users_phone_unique ON users (phone) WHERE phone > '';

CREATE INDEX users_referral ON users (referral_code);

CREATE INDEX users_referred_by ON users (referred_by);


CREATE TABLE card_rates (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT NOT NULL, 
	brand_id TEXT NOT NULL, 
	market_code TEXT NOT NULL, 
	face_value BIGINT NOT NULL, 
	payout_minor BIGINT NOT NULL, 
	version BIGINT NOT NULL, 
	is_active BOOLEAN, 
	updated_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key), 
	CONSTRAINT card_rates_denomination_unique UNIQUE (brand_id, market_code, face_value), 
	FOREIGN KEY(brand_id) REFERENCES brands (id), 
	FOREIGN KEY(market_code) REFERENCES markets (code), 
	CONSTRAINT card_rates_positive CHECK (face_value > 0 AND payout_minor > 0 AND version > 0)
)

;

CREATE UNIQUE INDEX card_rates_id_unique ON card_rates (id);

CREATE INDEX card_rates_market_active ON card_rates (market_code, is_active);


CREATE TABLE kyc_submissions (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT, 
	user_id TEXT, 
	status TEXT, 
	created_at TIMESTAMP WITH TIME ZONE, 
	updated_at TIMESTAMP WITH TIME ZONE, 
	reviewed_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key), 
	FOREIGN KEY(user_id) REFERENCES users (id)
)

;

CREATE INDEX kyc_owner_date ON kyc_submissions (user_id, created_at DESC);

CREATE INDEX kyc_status ON kyc_submissions (status);

CREATE UNIQUE INDEX kyc_submissions_id_unique ON kyc_submissions (id);


CREATE TABLE ledger (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT NOT NULL, 
	user_id TEXT NOT NULL, 
	dedup_key TEXT NOT NULL, 
	type TEXT NOT NULL, 
	currency TEXT NOT NULL, 
	ref_type TEXT, 
	ref_id TEXT, 
	amount_kobo BIGINT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	CONSTRAINT ledger_dedup_unique UNIQUE (dedup_key), 
	CONSTRAINT ledger_sign CHECK ((type <> 'WITHDRAWAL_DEBIT' OR amount_kobo < 0) AND (type NOT IN ('TRADE_CREDIT','WITHDRAWAL_REVERSAL') OR amount_kobo > 0))
)

;

CREATE UNIQUE INDEX ledger_id_unique ON ledger (id);

CREATE INDEX ledger_owner_date ON ledger (user_id, created_at DESC);

CREATE UNIQUE INDEX ledger_reference_unique ON ledger (type, ref_type, ref_id) WHERE ref_id IS NOT NULL AND ref_id != '';


CREATE TABLE notifications (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT, 
	user_id TEXT, 
	type TEXT, 
	ref_id TEXT, 
	read BOOLEAN, 
	created_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key), 
	FOREIGN KEY(user_id) REFERENCES users (id)
)

;

CREATE UNIQUE INDEX notifications_id_unique ON notifications (id);

CREATE INDEX notifications_owner_date ON notifications (user_id, created_at DESC);


CREATE TABLE password_resets (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT, 
	user_id TEXT, 
	token_hash TEXT, 
	used BOOLEAN, 
	expires_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	UNIQUE (token_hash)
)

;

CREATE INDEX password_resets_expiry ON password_resets (expires_at);

CREATE UNIQUE INDEX password_resets_id_unique ON password_resets (id);


CREATE TABLE payout_accounts (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT NOT NULL, 
	user_id TEXT NOT NULL, 
	currency TEXT, 
	payout_provider_id TEXT, 
	bank_code TEXT, 
	account_number TEXT, 
	verified BOOLEAN, 
	created_at TIMESTAMP WITH TIME ZONE, 
	deleted_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key), 
	FOREIGN KEY(user_id) REFERENCES users (id)
)

;

CREATE UNIQUE INDEX payout_accounts_id_unique ON payout_accounts (id);

CREATE INDEX payout_accounts_owner ON payout_accounts (user_id, deleted_at);


CREATE TABLE support_tickets (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT NOT NULL, 
	user_id TEXT NOT NULL, 
	status TEXT, 
	subject TEXT, 
	customer_name TEXT, 
	customer_email TEXT, 
	ref TEXT, 
	ref_label TEXT, 
	unread_for_customer BIGINT, 
	unread_for_admin BIGINT, 
	created_at TIMESTAMP WITH TIME ZONE, 
	updated_at TIMESTAMP WITH TIME ZONE, 
	last_message_at TIMESTAMP WITH TIME ZONE, 
	resolved_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key), 
	FOREIGN KEY(user_id) REFERENCES users (id)
)

;

CREATE UNIQUE INDEX support_tickets_id_unique ON support_tickets (id);

CREATE INDEX support_tickets_owner_date ON support_tickets (user_id, last_message_at DESC);

CREATE INDEX support_tickets_queue ON support_tickets (status, last_message_at DESC);


CREATE TABLE trades (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT NOT NULL, 
	user_id TEXT NOT NULL, 
	brand_id TEXT, 
	order_id TEXT, 
	status TEXT NOT NULL, 
	currency TEXT NOT NULL, 
	market_code TEXT, 
	rate_id TEXT, 
	submission_type TEXT, 
	card_value_usd BIGINT, 
	quantity BIGINT, 
	rate_kobo_per_usd BIGINT, 
	expected_payout_kobo BIGINT, 
	approved_payout_kobo BIGINT, 
	minor_digits BIGINT, 
	rate_version BIGINT, 
	unit_payout_minor BIGINT, 
	payout_minor BIGINT, 
	credited BOOLEAN, 
	created_at TIMESTAMP WITH TIME ZONE, 
	updated_at TIMESTAMP WITH TIME ZONE, 
	reviewed_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	FOREIGN KEY(brand_id) REFERENCES brands (id), 
	CONSTRAINT trades_status CHECK (status IN ('DRAFT','PENDING_REVIEW','NEED_MORE_INFO','APPROVED','REJECTED')), 
	CONSTRAINT trades_positive CHECK (expected_payout_kobo > 0 AND (approved_payout_kobo IS NULL OR approved_payout_kobo > 0))
)

;

CREATE UNIQUE INDEX trades_id_unique ON trades (id);

CREATE INDEX trades_owner_date ON trades (user_id, created_at DESC);

CREATE INDEX trades_queue ON trades (status, created_at DESC);


CREATE TABLE upload_sessions (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT NOT NULL, 
	user_id TEXT NOT NULL, 
	path TEXT, 
	size BIGINT NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (_key), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	CONSTRAINT upload_session_size CHECK (size > 0 AND size <= 12582912)
)

;

CREATE INDEX upload_sessions_expiry ON upload_sessions (expires_at);

CREATE UNIQUE INDEX upload_sessions_id_unique ON upload_sessions (id);


CREATE TABLE uploads (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	path TEXT NOT NULL, 
	user_id TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key), 
	UNIQUE (path), 
	FOREIGN KEY(user_id) REFERENCES users (id)
)

;


CREATE TABLE support_messages (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT, 
	ticket_id TEXT, 
	sender TEXT, 
	created_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key), 
	FOREIGN KEY(ticket_id) REFERENCES support_tickets (id)
)

;

CREATE UNIQUE INDEX support_messages_id_unique ON support_messages (id);

CREATE INDEX support_messages_ticket_date ON support_messages (ticket_id, created_at);


CREATE TABLE upload_parts (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	session_id TEXT NOT NULL, 
	part BIGINT NOT NULL, 
	data BYTEA NOT NULL, 
	sha256 TEXT NOT NULL, 
	PRIMARY KEY (_key), 
	FOREIGN KEY(session_id) REFERENCES upload_sessions (id) ON DELETE CASCADE, 
	UNIQUE (session_id, part), 
	CONSTRAINT upload_part_limit CHECK (part BETWEEN 0 AND 3 AND octet_length(data) <= 3145728)
)

;


CREATE TABLE withdrawals (
	_key TEXT NOT NULL, 
	extra JSONB NOT NULL, 
	id TEXT NOT NULL, 
	user_id TEXT NOT NULL, 
	payout_account_id TEXT, 
	request_key TEXT, 
	status TEXT NOT NULL, 
	currency TEXT NOT NULL, 
	provider_id TEXT, 
	provider_reference TEXT, 
	amount_kobo BIGINT NOT NULL, 
	minor_digits BIGINT, 
	created_at TIMESTAMP WITH TIME ZONE, 
	updated_at TIMESTAMP WITH TIME ZONE, 
	paid_at TIMESTAMP WITH TIME ZONE, 
	last_reconciled_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (_key), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	FOREIGN KEY(payout_account_id) REFERENCES payout_accounts (id), 
	CONSTRAINT withdrawals_request_unique UNIQUE (user_id, request_key), 
	CONSTRAINT withdrawals_positive CHECK (amount_kobo > 0), 
	CONSTRAINT withdrawals_status CHECK (status IN ('PENDING','PROCESSING','PAID','REJECTED','REVERSED','CANCELLED'))
)

;

CREATE UNIQUE INDEX withdrawals_id_unique ON withdrawals (id);

CREATE INDEX withdrawals_owner_date ON withdrawals (user_id, created_at DESC);

CREATE UNIQUE INDEX withdrawals_provider_reference ON withdrawals (provider_id, provider_reference) WHERE provider_reference IS NOT NULL;

CREATE INDEX withdrawals_queue ON withdrawals (status, created_at DESC);

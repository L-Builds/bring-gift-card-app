"""Versioned relational schema. JSONB holds only optional/nested API metadata.

Amounts, ownership, identity, status, idempotency and indexed query fields have
typed SQL columns. No MongoDB client, BSON storage or database emulation service.
"""
from sqlalchemy import (MetaData, Table, Column, Text, BigInteger, Boolean, LargeBinary,
                        DateTime, CheckConstraint, ForeignKeyConstraint, Index, UniqueConstraint, func)
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData()
TABLES = {}


def table(name, strings='', integers='', booleans='', dates='', required=(), constraints=()):
    fields = [Column('_key', Text, primary_key=True), Column('extra', JSONB, nullable=False)]
    for spec, kind in [(strings, Text), (integers, BigInteger), (booleans, Boolean), (dates, DateTime(timezone=True))]:
        fields += [Column(k, kind, nullable=k not in required) for k in spec.split()]
    result = Table(name, metadata, *fields, *constraints)
    TABLES[name] = result
    if 'id' in result.c:
        Index(name + '_id_unique', result.c.id, unique=True)
    return result


users = table('users', 'id email phone full_name role staff_role currency market_code referral_code referred_by kyc_status',
              'minor_digits money_revision token_version pin_failed', 'disabled notifications_enabled',
              'created_at last_login_at pin_set_at pin_locked_until terms_accepted_at', required=('id', 'email'),
              constraints=(CheckConstraint("minor_digits BETWEEN 0 AND 3", name='users_precision'),))
Index('users_email_unique', users.c.email, unique=True)
Index('users_phone_unique', users.c.phone, unique=True, postgresql_where=users.c.phone > '')
Index('users_referral', users.c.referral_code)
Index('users_referral_code_ci_unique', func.upper(users.c.referral_code), unique=True,
      postgresql_where=(users.c.referral_code.is_not(None) & (users.c.referral_code != '')))
Index('users_referred_by', users.c.referred_by)
Index('users_created', users.c.created_at.desc())

markets = table('markets', 'code name currency', 'minor_digits', 'is_active', required=('code','currency','minor_digits'),
                constraints=(UniqueConstraint('code'), CheckConstraint('minor_digits BETWEEN 0 AND 3', name='markets_precision')))
brands = table('brands', 'id name slug category color logo_path', 'rate_kobo_per_usd sort_order', 'is_active is_popular', 'created_at archived_at', required=('id',))
Index('brands_active_order', brands.c.is_active, brands.c.sort_order)

popular_cards = table('popular_cards', 'brand_id bonus_market_code',
    'position bonus_amount_minor min_card_value_usd', 'bonus_enabled', 'created_at updated_at',
    required=('brand_id','position'), constraints=(
        ForeignKeyConstraint(['brand_id'], ['brands.id'], ondelete='CASCADE'),
        ForeignKeyConstraint(['bonus_market_code'], ['markets.code']),
        UniqueConstraint('brand_id', name='popular_cards_brand_unique'),
        UniqueConstraint('position', name='popular_cards_position_unique'),
        CheckConstraint('position BETWEEN 1 AND 8', name='popular_cards_position_range'),
        CheckConstraint('bonus_amount_minor IS NULL OR bonus_amount_minor > 0', name='popular_cards_bonus_amount_positive'),
        CheckConstraint('min_card_value_usd IS NULL OR min_card_value_usd > 0', name='popular_cards_min_card_value_positive'),
        CheckConstraint("NOT bonus_enabled OR (bonus_market_code IS NOT NULL AND bonus_market_code <> '' AND bonus_amount_minor IS NOT NULL AND bonus_amount_minor > 0)", name='popular_cards_bonus_complete')))

card_rates = table('card_rates', 'id brand_id market_code card_country submission_type',
    'face_value payout_minor rate_minor_per_usd range_min range_max version', 'is_active is_headline', 'updated_at archived_at',
    required=('id','brand_id','market_code','submission_type','face_value','payout_minor','version'), constraints=(
        ForeignKeyConstraint(['brand_id'], ['brands.id']), ForeignKeyConstraint(['market_code'], ['markets.code']),
        CheckConstraint("submission_type IN ('any','physical','ecode')", name='card_rates_submission_type_valid'),
        CheckConstraint('(range_min IS NULL AND range_max IS NULL) OR (range_min IS NOT NULL AND range_max IS NOT NULL AND range_min >= 0 AND range_max >= range_min)', name='card_rates_range_valid'),
        CheckConstraint('rate_minor_per_usd IS NULL OR rate_minor_per_usd > 0', name='card_rates_rate_per_usd_positive'),
        CheckConstraint('face_value > 0 AND payout_minor > 0 AND version > 0', name='card_rates_positive')))
Index('card_rates_rule_unique', card_rates.c.brand_id, card_rates.c.market_code, card_rates.c.card_country, card_rates.c.face_value,
      card_rates.c.submission_type, func.coalesce(card_rates.c.range_min, -1), func.coalesce(card_rates.c.range_max, -1), unique=True)
Index('card_rates_market_active', card_rates.c.market_code, card_rates.c.is_active)
Index('card_rates_rule_lookup', card_rates.c.brand_id, card_rates.c.market_code, card_rates.c.card_country, card_rates.c.face_value,
      card_rates.c.submission_type, card_rates.c.is_active)

# Phase 1 rate model cleanup. These are the new current-rate stores. The legacy
# card_rates table above remains intact for historical compatibility. Live trade
# pricing has cut over to detailed_rates; historical trades may still reference
# legacy card_rates ids and keep immutable pricing snapshots.
headline_rates = table('headline_rates', 'id brand_id market_code',
    'rate_minor_per_unit version', 'is_active', 'created_at updated_at archived_at',
    required=('id','brand_id','market_code','rate_minor_per_unit','version','is_active'), constraints=(
        ForeignKeyConstraint(['brand_id'], ['brands.id'], ondelete='CASCADE'),
        ForeignKeyConstraint(['market_code'], ['markets.code']),
        UniqueConstraint('brand_id','market_code', name='headline_rates_card_market_unique'),
        CheckConstraint('rate_minor_per_unit > 0 AND version > 0', name='headline_rates_positive')))
Index('headline_rates_market_active', headline_rates.c.market_code, headline_rates.c.is_active)

detailed_rates = table('detailed_rates', 'id brand_id market_code card_country submission_type',
    'rate_minor_per_unit version', 'is_active', 'created_at updated_at archived_at',
    required=('id','brand_id','market_code','card_country','submission_type','rate_minor_per_unit','version','is_active'), constraints=(
        ForeignKeyConstraint(['brand_id'], ['brands.id'], ondelete='CASCADE'),
        ForeignKeyConstraint(['market_code'], ['markets.code']),
        UniqueConstraint('brand_id','market_code','card_country','submission_type', name='detailed_rates_card_country_type_unique'),
        CheckConstraint("btrim(card_country) <> ''", name='detailed_rates_country_present'),
        CheckConstraint("submission_type IN ('physical','ecode')", name='detailed_rates_submission_type_valid'),
        CheckConstraint('rate_minor_per_unit > 0 AND version > 0', name='detailed_rates_positive')))
Index('detailed_rates_lookup', detailed_rates.c.brand_id, detailed_rates.c.market_code, detailed_rates.c.card_country,
      detailed_rates.c.submission_type, detailed_rates.c.is_active)

trades = table('trades', 'id user_id brand_id order_id status currency market_code rate_id submission_type',
    'card_value_usd quantity rate_kobo_per_usd expected_payout_kobo approved_payout_kobo minor_digits rate_version unit_payout_minor payout_minor',
    'credited', 'created_at updated_at reviewed_at', required=('id','user_id','status','currency'), constraints=(
        ForeignKeyConstraint(['user_id'], ['users.id']), ForeignKeyConstraint(['brand_id'], ['brands.id']),
        CheckConstraint("status IN ('DRAFT','PENDING_REVIEW','NEED_MORE_INFO','APPROVED','REJECTED')", name='trades_status'),
        CheckConstraint('expected_payout_kobo > 0 AND (approved_payout_kobo IS NULL OR approved_payout_kobo > 0)', name='trades_positive')))
Index('trades_owner_date', trades.c.user_id, trades.c.created_at.desc())
Index('trades_queue', trades.c.status, trades.c.created_at.desc())

payout_accounts = table('payout_accounts', 'id user_id currency payout_provider_id bank_code account_number',
    booleans='verified', dates='created_at deleted_at', required=('id','user_id'),
    constraints=(ForeignKeyConstraint(['user_id'], ['users.id']),))
Index('payout_accounts_owner', payout_accounts.c.user_id, payout_accounts.c.deleted_at)
withdrawals = table('withdrawals', 'id user_id payout_account_id request_key status currency provider_id provider_reference',
    'amount_kobo minor_digits', dates='created_at updated_at paid_at last_reconciled_at', required=('id','user_id','amount_kobo','status','currency'),
    constraints=(ForeignKeyConstraint(['user_id'], ['users.id']), ForeignKeyConstraint(['payout_account_id'], ['payout_accounts.id']),
        UniqueConstraint('user_id','request_key', name='withdrawals_request_unique'),
        CheckConstraint('amount_kobo > 0', name='withdrawals_positive'),
        CheckConstraint("status IN ('PENDING','PROCESSING','PAID','REJECTED','REVERSED','CANCELLED')", name='withdrawals_status')))
Index('withdrawals_owner_date', withdrawals.c.user_id, withdrawals.c.created_at.desc())
Index('withdrawals_queue', withdrawals.c.status, withdrawals.c.created_at.desc())
Index('withdrawals_provider_reference', withdrawals.c.provider_id, withdrawals.c.provider_reference, unique=True,
      postgresql_where=withdrawals.c.provider_reference.is_not(None))

ledger = table('ledger', 'id user_id dedup_key type currency ref_type ref_id', 'amount_kobo', dates='created_at',
    required=('id','user_id','dedup_key','amount_kobo','type','currency'), constraints=(
        ForeignKeyConstraint(['user_id'], ['users.id']), UniqueConstraint('dedup_key', name='ledger_dedup_unique'),
        CheckConstraint("(type <> 'WITHDRAWAL_DEBIT' OR amount_kobo < 0) AND (type NOT IN ('TRADE_CREDIT','WITHDRAWAL_REVERSAL') OR amount_kobo > 0)", name='ledger_sign')))
Index('ledger_owner_date', ledger.c.user_id, ledger.c.created_at.desc())
Index('ledger_reference_unique', ledger.c.type, ledger.c.ref_type, ledger.c.ref_id, unique=True,
      postgresql_where=(ledger.c.ref_id.is_not(None) & (ledger.c.ref_id != '')))

notifications = table('notifications', 'id user_id type ref_id', booleans='read', dates='created_at',
    constraints=(ForeignKeyConstraint(['user_id'], ['users.id']),))
Index('notifications_owner_date', notifications.c.user_id, notifications.c.created_at.desc())
support_tickets = table('support_tickets', 'id user_id status subject customer_name customer_email ref ref_label',
    'unread_for_customer unread_for_admin', dates='created_at updated_at last_message_at resolved_at', required=('id','user_id'),
    constraints=(ForeignKeyConstraint(['user_id'], ['users.id']),))
Index('support_tickets_owner_date', support_tickets.c.user_id, support_tickets.c.last_message_at.desc())
Index('support_tickets_queue', support_tickets.c.status, support_tickets.c.last_message_at.desc())
support_messages = table('support_messages', 'id ticket_id sender', dates='created_at',
    constraints=(ForeignKeyConstraint(['ticket_id'], ['support_tickets.id']),))
Index('support_messages_ticket_date', support_messages.c.ticket_id, support_messages.c.created_at)
uploads = table('uploads', 'path user_id', dates='created_at', required=('path','user_id'),
    constraints=(UniqueConstraint('path'), ForeignKeyConstraint(['user_id'], ['users.id'])))
password_resets = table('password_resets', 'id user_id token_hash', booleans='used', dates='expires_at created_at',
    constraints=(ForeignKeyConstraint(['user_id'], ['users.id']), UniqueConstraint('token_hash')))
Index('password_resets_expiry', password_resets.c.expires_at)
abuse_counters = table('abuse_counters', integers='count', dates='expires_at')
Index('abuse_counters_expiry', abuse_counters.c.expires_at)
kyc_submissions = table('kyc_submissions', 'id user_id status', dates='created_at updated_at reviewed_at',
    constraints=(ForeignKeyConstraint(['user_id'], ['users.id']),))
Index('kyc_owner_date', kyc_submissions.c.user_id, kyc_submissions.c.created_at.desc())
Index('kyc_status', kyc_submissions.c.status)
rate_changes = table('rate_changes', 'id brand_id', dates='at')
Index('rate_changes_brand_date', rate_changes.c.brand_id, rate_changes.c.at.desc())
audit = table('audit', 'actor action target', integers='version', dates='at')
Index('audit_action_date', audit.c.action, audit.c.at.desc())
payout_providers = table('payout_providers', 'id adapter label', booleans='enabled', required=('id',))
settings = table('settings', 'id', required=('id',))
legal = table('legal', 'id', integers='version', dates='updated_at', required=('id',))

upload_sessions = table('upload_sessions', 'id user_id path', integers='size', dates='expires_at', required=('id','user_id','size','expires_at'),
    constraints=(ForeignKeyConstraint(['user_id'], ['users.id']), CheckConstraint('size > 0 AND size <= 12582912', name='upload_session_size')))
Index('upload_sessions_expiry', upload_sessions.c.expires_at)
upload_parts = Table('upload_parts', metadata,
    Column('_key', Text, primary_key=True), Column('extra', JSONB, nullable=False),
    Column('session_id', Text, nullable=False), Column('part', BigInteger, nullable=False),
    Column('data', LargeBinary, nullable=False), Column('sha256', Text, nullable=False),
    ForeignKeyConstraint(['session_id'], ['upload_sessions.id'], ondelete='CASCADE'),
    UniqueConstraint('session_id','part'), CheckConstraint('part BETWEEN 0 AND 3 AND octet_length(data) <= 3145728',name='upload_part_limit'))
TABLES['upload_parts']=upload_parts

SCHEMA_VERSION = '013_trade_rate_cutover'

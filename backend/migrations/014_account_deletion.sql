-- Record a single durable, authenticated customer account-deletion request.
-- Financial records retain their user_id foreign keys. No existing rows are
-- changed by this migration.
CREATE TABLE account_deletion_requests (
    _key TEXT PRIMARY KEY,
    extra JSONB NOT NULL,
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT account_deletion_requests_user_unique UNIQUE (user_id),
    CONSTRAINT account_deletion_requests_status CHECK (status IN ('pending_review', 'completed'))
);

CREATE UNIQUE INDEX account_deletion_requests_id_unique ON account_deletion_requests(id);
CREATE INDEX account_deletion_requests_status_date
    ON account_deletion_requests(status, created_at DESC);

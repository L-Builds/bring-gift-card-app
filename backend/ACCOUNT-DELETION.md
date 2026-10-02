# Customer account deletion operations

The customer must be signed in to request deletion. The customer Profile action
and the browser-accessible `/delete-account` page call the same authenticated
`POST /api/account-deletion` endpoint. The request requires the exact `DELETE`
confirmation and the current password when the account has a password hash.
Admin and staff accounts are rejected. One durable request is kept per customer.

## What completion means

The account is disabled, every JWT is revoked with `token_version`, and the
customer name, email, phone, profile picture, password hash, PIN hash, referral
code and referral links are removed or replaced with non-deliverable values.
Saved payout methods are disabled and their reusable bank name/number fields
are cleared. Reset tokens, in-app notifications and incomplete upload sessions
are removed. Financially linked support ticket display names, email and message
previews are scrubbed.

Trade, withdrawal and append-only ledger rows stay intact. Withdrawal
destination snapshots, transaction references, linked trade images and codes,
identity records with an explicitly documented retention decision, financially
linked support messages, audit events and the deletion request record may still
contain personal or sensitive information needed for accounting, disputes,
fraud prevention, security or lawful retention. They are not represented as
erased. Object storage files remain private and the former customer cannot
sign in to retrieve them. Storage provider backups may have their own expiry.

## Pending requests

Managers and the General Manager use `GET /api/admin/account-deletion` for the
queue and `GET /api/admin/account-deletion/{reference}/review` for evidence.
Workers cannot use these management endpoints.

1. Resolve active trades (`DRAFT`, `PENDING_REVIEW`, `NEED_MORE_INFO`) through the
   existing trade process. Resolve pending/processing withdrawals and all open
   support conversations through their existing workflows. A remaining wallet
   balance must be withdrawn or otherwise resolved through an authorized,
   ledger-recorded financial action.
   Account deletion never writes a balancing entry.
2. Any KYC submission blocks automatic completion. A manager reviews the
   records and documents a specific lawful/security retention reason via
   `POST /api/admin/account-deletion/{reference}/kyc-review` with
   `{ "decision": "retain", "records_reviewed": true, "reason": "..." }`.
   Verification screens are paused, so this requires authorized manual review
   of the identity records and private files outside the paused screen. The
   manager attests to that review and the actor, reason and time are audited.
   If the records cannot be reviewed or retention is not justified,
   leave the request pending and arrange a separate reviewed deletion of those
   records and private files. This endpoint does not erase identity data.
3. Support tickets without a concrete trade or withdrawal reference require
   privacy review. Close a ticket through the existing Support workflow if it
   is ready to remove. Then a manager may explicitly select that ticket in
   `POST /api/admin/account-deletion/{reference}/cleanup` with
   `{ "confirmation": "REVIEWED", "upload_paths": [], "ticket_ids": ["..."] }`.
   This removes the ticket, its messages and any attached private files that
   are not also linked to retained evidence. A ticket on legal/security hold
   stays pending until the hold is reviewed.
4. Uploaded files not linked to retained trade or support evidence block
   completion. Review each path, then select it in the same cleanup endpoint.
   Cleanup verifies S3 object removal with `HEAD` before removing its database
   row. A storage failure returns an error and leaves the request pending.
   The managed-object-storage fallback has no verified delete API and returns
   503; staff must arrange provider cleanup and verify it before retrying.
5. Call `POST /api/admin/account-deletion/{reference}/finalize` when the
   blockers are cleared. It rechecks every blocker under the customer's wallet
   row lock. The cleanup route also completes automatically if it clears the
   final blocker.

Do not delete trade/withdrawal evidence, ledger rows, or payment history to
make a request appear complete. The request status and reason are visible to
the signed-in customer through `GET /api/account-deletion` until completion;
completed accounts cannot authenticate again.

A payment provider may reverse a previously paid withdrawal after account
closure. Reconcile that event in the append-only ledger, then arrange a
documented return of funds through the authorized finance process. The closed
account must not be silently re-enabled or its ledger rewritten.

## Deployment order

Apply checked-in migration `014_account_deletion.sql` using the existing
owner-only `scripts/migrate.py` process and direct Neon URL. It adds an empty
request table without rewriting customer or financial rows. Production runtime
grants include that table. Only after migration success, deploy API code with
`SCHEMA_VERSION=014_account_deletion`; startup refuses an old schema. Deploy the
frontend after the API is ready. Do not run migration against production until
the release operator has confirmed the target Neon project and schema.

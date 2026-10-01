# Bring Gift Card — Phase 7 Full Admin Regression Verification

Verification target: **Phase 6 — Responsive + Interaction Consistency** master ZIP.

This phase is verification-only. No admin shell, customer flow, financial behavior, permissions model, or production business logic was redesigned.

## Scope verified

- General Manager / Manager / Worker access model
- Trade review and Trade Details workspace
- Private trade image viewer
- Approve / Reject / Need Information wiring
- Withdrawals
- Customers
- Support
- KYC / Verification access wiring
- Catalog create/edit and logo replace/remove
- Rates
- Markets
- Staff creation and permissions
- Self-service password change
- Session invalidation / log out other sessions
- Settings and company-configuration visibility
- Admin notifications
- Online/offline state and refresh behavior
- Admin PWA install behavior
- Desktop/mobile responsive implementation
- Existing frontend regression checks
- Backend Python source compilation
- Frontend TypeScript/TSX syntax parsing
- Availability of database-backed backend acceptance coverage

## Passed in this environment

### Frontend/admin regression suite

`npm run check:web` passed **53/53** tests.

That includes all previous regression coverage plus the Phase 7 focused checks for:

- role-driven General Manager / Manager / Worker navigation and server protection
- trade review endpoints and private evidence viewer
- withdrawals, customers, support and KYC route wiring
- Catalog create/edit/logo replace/remove behavior
- Rates, Markets and Staff management endpoints
- password/session/notification Settings wiring
- 15-second automatic admin data refresh
- browser online/offline handling and manual refresh
- browser notifications and admin-scoped PWA install
- desktop-first layout, mobile fallback and sticky Trade review panel
- presence of backend acceptance tests for finance, support, staff, security and catalog protections

### Source compilation / parsing

- Backend Python syntax compilation: **31/31 files passed**.
- Frontend TypeScript/TSX syntax transpilation: **81/81 files passed**.

These are syntax-level checks. They do not replace the full project TypeScript typecheck or Expo production build.

## Role/access review

The current implementation keeps the existing staff hierarchy as the source of truth:

- **General Manager**: management access, including Manager/Worker administration.
- **Manager**: management access but existing backend tests protect the General Manager and other Managers from unauthorized Manager-level changes.
- **Worker**: only assigned operational scopes (`trades`, `withdrawals`, `support`, `customers`).

The frontend navigation is permission-driven, and the backend uses `require_admin`, `require_staff`, and scoped staff dependencies. The checked-in backend acceptance test also asserts that every `/api/admin` route has a server-side authorization dependency.

## Workflow review

### Trades

Confirmed existing UI/API wiring for:

- Approve
- Reject
- Need Information
- approved payout input
- private authenticated evidence loading
- full-screen image viewing with contain/zoom/rotate/previous/next
- desktop two-column Trade workspace
- sticky desktop review panel
- mobile single-column fallback

No OCR was introduced.

### Withdrawals / Customers / Support

Confirmed the polished operations pages still target the existing backend routes and preserve the established withdrawal actions, customer detail navigation, support inbox/detail workflow and permission scopes.

### KYC / Verification

The KYC admin routes are still protected by the `customers` worker scope in the backend. However, the current application intentionally has a global middleware boundary returning **404 `KYC is deferred in v1.1.0`** for customer and admin KYC API paths.

Therefore KYC permission wiring was inspected, but a live KYC review workflow is **not active in this release** and was not executed here.

### Catalog / Rates / Markets / Staff

Confirmed current wiring for:

- Catalog create/edit
- logo upload/replace/remove backend path
- public logo endpoint without exposing private storage keys
- Active/Popular publication protection tests
- denomination rate CRUD endpoints
- market management endpoints
- staff create/update endpoints and permission rules

## Password and session security review

Confirmed current frontend/backend wiring for:

- current-password verification
- admin password suffix rule (`@admin`) and minimum length
- self-service password change
- token-version increment on password rotation
- old-session invalidation
- fresh token returned to keep the current browser signed in
- log out other sessions
- self-service admin notification preference

The database-backed tests for these flows are present, but could not be executed without a disposable PostgreSQL test database.

## Database-backed backend tests — not executed here

The normal `backend/pytest.ini` acceptance suite currently contains **52 test functions** across:

- `test_production.py`
- `test_postgres.py`
- `test_staff_roles.py`
- `test_admin_security.py`
- `test_catalog_logo.py`

There are **112 checked-in backend test functions** in total when historical/phase/migration suites are counted.

`pytest --collect-only` was attempted. Collection stops immediately because this environment does not provide `TEST_DATABASE_URL` (`KeyError: TEST_DATABASE_URL`). No production database was substituted because the test suite requires a disposable database/schema.

**Result:** database-backed backend tests remain required in staging/CI; they are not claimed as passed here.

## Full frontend typecheck / production build — not completed here

The supplied ZIP correctly contains no `node_modules`.

`npm ci` was attempted but dependency installation timed out in this environment. A partial install was not treated as valid.

Subsequent attempts showed environment/dependency failures:

- `npm run typecheck`: missing React/Expo/type-definition packages and `expo/tsconfig.base`.
- `npm run build:web`: `expo/package.json` unavailable because Expo was not successfully installed.

The partial `node_modules` directory is removed from the delivered ZIP.

**Result:** the full TypeScript typecheck and Expo production build are not claimed as passed in this environment. Run them in the normal development/staging environment with a successful `npm ci`.

## Desktop/mobile rendering

Responsive behavior is covered by the source regression suite, including desktop breakpoints, mobile drawer fallback, keyboard-sensitive sheets, sticky Trade review, private image viewer sizing and input-focus rules.

A real browser render at desktop/tablet/phone widths was not launched because a production/local Expo build could not be produced without the dependencies above.

## Migration checkpoint

Phase 7 creates **no new database migration**.

The checked-in backend schema currently expects:

`SCHEMA_VERSION = '005_brand_logos'`

and migrations `001` through `005` are present. Any deployment database must have migration `005_brand_logos` applied before this backend is considered schema-current. This verification environment did **not** connect to Neon or another database, so the actual production/staging migration state was not verified here.

## Environment checkpoint

Phase 7 introduces **no new environment variables**.

Existing production configuration still depends on the project’s documented values, including the database/JWT/CORS/app URL and the configured private-storage path used for evidence and Catalog logos. SMTP, Google sign-in and payout provider values remain feature/provider-specific as documented in the project; Phase 7 did not change them.

## Verification-only changes in Phase 7

No product behavior was changed.

1. `frontend/scripts/check-admin-phase7-regression.test.cjs`
   - Added focused cross-phase admin regression assertions.

2. `frontend/package.json`
   - Added the Phase 7 regression file to `npm run check:web`.

3. `PHASE-7-ADMIN-REGRESSION.md`
   - Added this verification record.

## Final status

### Passed here

- `npm run check:web`: **53/53**
- backend Python syntax: **31/31**
- frontend TS/TSX syntax parsing: **81/81**
- Phase 7 focused regression tests: **9/9** (included in the 53 total)

### Not executable / not fully verified here

- PostgreSQL-backed backend acceptance suite: missing disposable `TEST_DATABASE_URL`
- full frontend TypeScript typecheck: dependencies could not be installed
- Expo production web build: dependencies could not be installed
- real browser desktop/tablet/mobile visual run: no local build available
- live KYC workflow: intentionally deferred by current middleware
- actual deployed database migration state: no database connection was used

### Required release/staging commands

In the normal isolated test/staging environment:

```powershell
cd frontend
npm ci
npm run typecheck
npm run build:web
npm run check:web

cd ..\backend
python -m pip install -r requirements-dev.txt
$env:TEST_DATABASE_URL='postgresql://DISPOSABLE-TEST-DATABASE'
python -m pytest
```

Use only a disposable PostgreSQL test database for the backend suite, never production.

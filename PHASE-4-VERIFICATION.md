# Bring Gift Card — Phase 4 Verification

Verification target: **Phase 3 — Preferences + Admin Controls** master ZIP.

## Scope checked

- General Manager access
- Manager access
- Worker scope restrictions
- Self-service password changes
- Session invalidation / log out other sessions
- Production/company settings access
- Desktop/mobile admin responsiveness
- PWA/install configuration
- Connectivity and refresh behavior
- Frontend web checks
- Backend source compilation and acceptance-suite coverage

## Passed in this environment

### Web / admin regression checks

`npm run check:web` passed **16/16** checks.

This covers:

- production/staging web proxy configuration
- PWA manifest and icon sizes
- admin-only PWA/service-worker scope
- service worker exclusion of API/authenticated requests
- clean web input focus behavior
- desktop-first admin shell plus mobile drawer fallback
- Settings one/two-column responsive structure
- management-only Company Configuration visibility
- browser online/offline handling
- automatic refresh configuration
- Change Password and Log out Other Sessions wiring

### Source compilation / syntax

- Python source compilation passed for **31 backend Python files**.
- TypeScript/TSX syntax transpilation passed for **81 non-declaration frontend TypeScript files**.
- Focused source assertions passed **14/14** for staff hierarchy, password/session rotation, company-setting protection, responsive breakpoints, connectivity, and PWA scope.

### Role/security implementation review

Verified from the current implementation and its regression tests:

- **General Manager** has full management access.
- **Manager** has management access but cannot create or modify another Manager or the General Manager.
- **Worker** access is limited to explicitly assigned work scopes (`trades`, `withdrawals`, `support`, `customers`).
- Workers can open personal Settings, but Company Configuration stays hidden and management APIs reject Worker access.
- Admin passwords must be at least 12 characters and end with `@admin`.
- Change Password verifies the current password, rejects password reuse, increments `token_version`, invalidates previous sessions, and returns a fresh token so the current browser remains signed in.
- Log out Other Sessions verifies the current password, increments `token_version`, invalidates older sessions, and returns a fresh token for the current browser.
- Markets, rates, payout-provider, legal/readiness, catalog, staff, and similar company-management endpoints continue to use management-level server protection.

### Responsive / live admin implementation review

- Desktop sidebar is enabled at `>= 1024px`.
- Smaller screens use the admin drawer/menu instead of forcing the desktop sidebar.
- Compact top-bar behavior is enabled below `800px`.
- Settings changes between one and two columns at `900px`.
- Admin data uses a 15-second default React Query refresh interval.
- API connectivity is checked periodically and on browser return/focus.
- Browser `online` / `offline` events drive the visible connection state and reconnect banner.
- The installable admin PWA is scoped to `/admin`, not to the customer app.

## Verification-only changes made in Phase 4

No customer/admin product behavior was redesigned or changed.

Only verification coverage was tightened:

1. `backend/pytest.ini`
   - Added `tests/test_admin_security.py` to the default PostgreSQL acceptance suite.
   - The default backend suite now contains **52 test functions** across production, PostgreSQL, staff-role, admin-security, and catalog-logo coverage.

2. `frontend/package.json`
   - Added the focused Phase 4 admin regression file to `npm run check:web`.

3. `frontend/scripts/check-admin-phase4.test.cjs`
   - Added five source-level regression checks for responsiveness, role visibility, connectivity, PWA scope, and password/session Settings wiring.

4. `PHASE-4-VERIFICATION.md`
   - Added this verification record.

## Could not be fully executed here

### PostgreSQL backend integration suite

The backend test command was attempted, but collection stopped because this environment does not provide the required disposable `TEST_DATABASE_URL`.

Therefore the **52 PostgreSQL-backed acceptance tests were not executed here**, and I am not claiming they passed in this environment.

### Full frontend typecheck and production build

The frontend package does not include `node_modules`, which is correct for the project ZIP. I attempted dependency installation, but this environment cannot resolve external package registries.

As a result:

- `npm run typecheck` could not run with the project dependency/type set and failed on missing React/Expo/type packages.
- `npm run build:web` could not run because Expo is not installed locally in this environment.

These are environment/dependency-availability failures; they are **not claimed as successful build/typecheck results**.

### Live browser rendering

A local web build could not be produced because dependencies could not be installed, so desktop/mobile rendering was not visually launched here. Responsiveness was verified from the implementation and the added regression checks only.

## Required final release verification outside this environment

Before calling the Phase 1–3 Settings work fully release-verified, run the normal project checks in the existing isolated test/staging environment where dependencies and a disposable PostgreSQL database are available:

- `npm ci`
- `npm run typecheck`
- `npm run build:web`
- `npm run check:web`
- backend `pytest` with a disposable `TEST_DATABASE_URL`
- live General Manager / Manager / Worker browser checks at desktop and mobile widths


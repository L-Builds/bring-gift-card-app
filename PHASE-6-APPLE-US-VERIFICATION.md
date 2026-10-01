# Phase 6 — Apple US seed and verification

## Source handling

The Apple/iTunes US rate rows in migration `010_apple_us_rates.sql` were transcribed from the user-supplied Apple US rate screenshots. No outside rate source was used. The supplied All Cards view explicitly shows **₦1,151.76/$1** for Apple, so the matching `$50 Physical / $400–$500` rule is the single headline display rate. The visible `+ ₦1` text in the reference was not configured because its meaning was not defined.

The approved Phase 5 matching model treats a range as **total face value = card value × quantity**. Under that model some supplied rows overlap at the same card value/type and would make quoting ambiguous. Per the Phase 6 instruction, those rows were left unconfigured rather than guessed.

## Configured Apple US rules

Payout market: **Nigeria (NG / NGN)**  
Gift-card country: **United States (US)**

| Card value | Range | Type | Rate | Headline |
|---:|---:|---|---:|---|
| $100 | $300–$500 | Code | ₦1,077.39/$1 | No |
| $50 | $400–$500 | Physical | ₦1,151.76/$1 | Yes |
| $50 | $100–$150 | Physical | ₦1,115.53/$1 | No |
| $50 | $250–$251 | Physical | ₦1,071.67/$1 | No |
| $50 | $200–$201 | Physical | ₦1,111.71/$1 | No |
| $25 | $0–$25 | Physical | ₦1,058.32/$1 | No |
| $20 | Fixed | Code | ₦1,048.79/$1 | No |
| $20 | $0–$20 | Physical | ₦1,088.83/$1 | No |
| $15 | $0–$15 | Physical | ₦1,081.20/$1 | No |
| $10 | Fixed | Code | ₦1,048.79/$1 | No |
| $10 | $80–$90 | Physical | ₦1,088.83/$1 | No |
| $10 | $10–$20 | Code | ₦1,010.65/$1 | No |
| $5 | $25–$80 | Code | ₦1,010.65/$1 | No |
| $5 | $105–$145 | Physical | ₦1,098.37/$1 | No |
| $5 | $155–$195 | Physical | ₦1,098.37/$1 | No |
| $5 | $205–$240 | Physical | ₦1,098.37/$1 | No |
| $5 | $105–$495 | Code | ₦1,052.60/$1 | No |
| $1 | $105–$245 | Physical | ₦1,088.83/$1 | No |

Configured rules: **18**. Apple is published as **Active** and **Popular** because this is the first approved live Apple rate set and Apple was already agreed as a Popular card.

## Supplied rows intentionally left unconfigured

| Card value | Range | Type | Supplied rate | Reason |
|---:|---:|---|---:|---|
| $50 | $300–$500 | Code | ₦1,077.39/$1 | overlaps the supplied $50 Code 100–500 rule |
| $50 | $0–$50 | Physical | ₦1,119.34/$1 | overlaps the supplied $50 Physical 50–51 rule at total value $50 |
| $50 | $100–$500 | Code | ₦1,010.65/$1 | overlaps the supplied $50 Code 100–200 and 300–500 rules |
| $50 | $50–$51 | Physical | ₦1,109.81/$1 | overlaps the supplied $50 Physical 0–50 rule at total value $50 |
| $50 | $350–$500 | Physical | ₦1,113.62/$1 | overlaps the supplied headline $50 Physical 400–500 rule |
| $50 | $100–$200 | Code | ₦1,069.76/$1 | overlaps the supplied $50 Code 100–500 rule |
| $10 | $0–$10 | Physical | ₦1,081.20/$1 | overlaps the supplied $10 Physical 10–20 rule at total value $10 |
| $10 | $10–$20 | Physical | ₦1,067.86/$1 | overlaps the supplied $10 Physical 0–10 rule at total value $10 |
| $5 | $10–$45 | Physical | ₦1,083.11/$1 | overlaps other supplied $5 Physical ranges |
| $5 | $10–$95 | Physical | ₦1,083.11/$1 | overlaps other supplied $5 Physical ranges |
| $5 | $55–$70 | Physical | ₦1,088.83/$1 | overlaps other supplied $5 Physical ranges |
| $5 | $30–$45 | Physical | ₦1,088.83/$1 | overlaps other supplied $5 Physical ranges |
| $5 | $55–$75 | Physical | ₦1,088.83/$1 | overlaps other supplied $5 Physical ranges |
| $5 | $30–$80 | Physical | ₦1,086.92/$1 | overlaps other supplied $5 Physical ranges |
| $5 | $255–$295 | Physical | ₦1,086.92/$1 | overlaps the supplied $5 Physical 255–495 rule |
| $5 | $10–$96 | Physical | ₦1,058.50/$1 | overlaps other supplied $5 Physical ranges |
| $5 | $255–$495 | Physical | ₦1,102.18/$1 | overlaps the supplied $5 Physical 255–295 rule |

Unconfigured ambiguous rows: **17**. They remain documented here so none of the supplied information is lost. They should only be activated after the missing distinguishing condition is defined or the rate model is explicitly changed.

## Deployment requirement

Apply checked-in migrations with the normal direct Neon migration process before deploying the matching backend. This phase adds:

- `010_apple_us_rates.sql`

No new environment variable is required.

## Verification checklist

The Phase 6 verification run should cover:

- Catalog add/edit/delete/archive and logo upload/replace/remove regression checks
- Active/inactive and Popular behavior
- Apple US exact configured seed values and headline rate
- All Cards uses the admin-selected headline rate rather than calculating the highest rate
- Apple detailed rate presentation and US country selection
- Physical vs Code presentation
- Trade exact-rule lookup and payout calculation regression checks
- General Manager / Manager / Worker permission regressions
- Desktop admin / mobile customer source regression checks
- Python compilation and pure rate-selection tests
- Frontend web regression suite
- Full frontend typecheck/build and PostgreSQL-backed tests when dependencies and `TEST_DATABASE_URL` are available

## Actual verification results in this workspace

Passed:

- Frontend/web/admin source regression suite: **68/68** (`npm run check:web`).
- Backend Python syntax compilation: **36/36 Python files compiled**.
- Frontend TS/TSX syntax transpilation: **81/81 non-declaration files passed**.
- Pure Phase 6 Apple seed checks: **4/4 passed**.
- Pure exact rate-selection checks: **4/4 passed**, including total-face-value range matching and ambiguous-overlap rejection.

Could not be completed here:

- PostgreSQL-backed backend suite: collection stops because `TEST_DATABASE_URL` is not available. No production database was used as a substitute.
- Migration `010` could therefore not be executed against a disposable PostgreSQL/Neon test database in this workspace. It remains a deployment prerequisite.
- `npm ci` timed out before dependencies could be installed.
- Full `npm run typecheck` consequently fails at missing Expo/React/React Native modules and `expo/tsconfig.base`, before a meaningful project typecheck can run.
- Full `npm run build:web` consequently cannot load `expo/package.json`.

No live Neon/Vercel data was modified during this phase.

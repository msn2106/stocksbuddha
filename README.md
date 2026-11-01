# Stocks Buddha

Clean incremental rebuild of the reference application in `../website`. Current slice: **S0.2 — tenant-owned website architecture**, following the initial S0.1 public landing pages. This is a local development preview, not a production research service.

## Run

Use Node **24.22.0** (`nvm use`) and npm **11.19.1**, then:

```sh
npm ci
npm run dev
```

Open [Stocks Buddha](http://localhost:3000/ra/stocksbuddha), [Alpha demo](http://localhost:3000/ra/alpha), or [Beta demo](http://localhost:3000/ra/beta). `/` redirects to Stocks Buddha. The former `/ra/stocks-buddha` address redirects permanently to `/ra/stocksbuddha`, preserving the query string. Unknown/reserved tenant slugs and unsupported routes return HTTP 404, not another tenant’s content.

```sh
npm run typecheck
npm test
npm run build
DATABASE_MODE=fixtures ALLOW_PUBLIC_PREVIEW=true npm start # public preview without a DB
# First time only:
npx playwright install chromium
npm run test:e2e
npm run format:check
```

The production build and development server both render public content and tenant metadata on the server, then hydrate the same validated data in React. One Nest/Express Node process serves the public website API, account authentication and protected workspace routes. Backend configuration is documented in `backend/.env.example`; copy it to ignored `backend/.env` for local use, or provide values through the process environment. Development and production startup read that optional local file. `PORT` defaults to `3000`; `HOST` defaults to `127.0.0.1`. Set `HOST=0.0.0.0` in a future hosted environment if required by its runtime.

Sentry captures browser/React and server failures in separate projects, with performance tracing and source-map uploads. The app currently runs locally only. See [Sentry setup](docs/SENTRY.md) for frontend/backend development and production variables, build tokens, sampling, and the preparation needed before deploying on Hostinger or another Node platform. Monitoring initializes only when a DSN is configured.

## Before committing

In Codex, run `$precommit-check` to review lint, formatting, types, unit tests, coverage, JSDoc and README/documentation accuracy. Run `$precommit-fix` to repair failures, add meaningful tests/JSDoc and update stale docs, then rerun the check. Repository skills live in `.agents/skills/`.

From a terminal at the repository root:

```sh
npm run precommit:check
npm run precommit:fix # applies lint/format fixes; reports remaining manual repairs
```

The gate checks staged, unstaged and untracked changes. Each changed executable source file must have **strictly more than 90%** line, statement, function and branch coverage from unit tests; exactly 90% fails. This is a whole-file threshold, including unchanged lines in modified files. Named functions/classes and their methods, constructors, accessors and function-valued properties need meaningful JSDoc. Tests, declaration files, erased type-only modules and the explicitly identified tool configuration files do not require their own coverage/JSDoc; application files such as `src/config.ts` remain included. Reports are generated in ignored `coverage/precommit/`. Unit tests and type checks run across the repository; lint/format checks target changed files.

Review and stage intended changes yourself. To enable the included Git hook in this checkout:

```sh
npm run hooks:install
```

This sets `core.hooksPath` to `.githooks` (check an existing custom hook setup before replacing it). The hook runs `npm run precommit:check -- --staged` and blocks on failures. Staged checks require tracked working files to match the index and no untracked code/config, so the tested code matches the commit. Fixes never stage or commit automatically. The hook performs automated checks; the Codex skill additionally reviews README/docs for obsolete commands, invalid snippets, incorrect behavior descriptions and broken local references. Complete that review before committing.

## Testing

```sh
npm run test:unit        # recursive Node tests, including React DOM/SSR/hydration
npm run test:integration # real HTTP/Git/local-registry boundaries
npm test                # both suites
npm run test:coverage    # whole-repo unit coverage; >90% per file and metric
npm run verify          # security, format, lint, coverage, integration, build, E2E
```

The frontend uses jsdom and Testing Library for component interactions. Backend tests cover policies, adapters, in-memory HTTP handlers and injected startup boundaries; separate integration tests use real ephemeral HTTP servers. Shared contracts have their own schema/locale/serialization suite. Node discovers nested `.test`/`.spec` files, including `.tsx`, across all workspaces. Playwright remains responsible for real browser layout and accessibility behavior. See [testing architecture and maintenance](docs/TESTING.md).

## Monorepo structure

This repository uses npm workspaces with one root lockfile and a shared dependency installation. Run the commands above from the repository root.

```text
stocksbuddha/
├── frontend/                 # @ra/frontend — React, styles, Vite, HTML and SSR renderer
│   ├── src/
│   └── dist/                 # Generated client/ and server/ builds
├── backend/                  # @ra/backend — Nest/Express API and tenant resolution
│   ├── src/tenancy/           # Request resolution and asynchronous repository contracts
│   ├── src/tenants/           # Tenant profiles and seed adapter
│   ├── src/websites/          # Website revisions, tenant-localized seeds and adapter
│   ├── src/access/            # Membership/capability policy for authenticated workspace access
│   ├── tests/                # Tenant unit tests
│   ├── .env.example
│   └── dist/                 # Generated Node server
├── packages/
│   └── contracts/            # @ra/contracts — shared public schemas, types and serialization
├── database/
│   ├── migrations/           # Reviewed TypeORM schema migrations
│   └── seeds/                # Repeatable dev-only preview seeds
├── scripts/                  # Repo-wide verification and future operational scripts
├── docs/                     # Requirements, architecture and delivery evidence
├── tests/e2e/                # Cross-workspace browser acceptance
├── package.json              # Workspace registration and top-level commands
└── package-lock.json         # Single dependency lockfile
```

The frontend imports only `@ra/contracts`, never backend modules. Tenant records and path resolution belong to the backend. The shared contracts package contains public shapes, validation and safe serialization; no tenant registry or database access. Both build pipelines bundle this internal TypeScript package, so the production server does not execute raw workspace TypeScript.

`npm run build` checks all workspaces and database code, builds frontend client/SSR assets and the backend, then builds the standalone migration CLI and manifest. `npm start` launches the backend, which serves the frontend on the same origin. Build outputs stay inside their owning packages and `database/dist/`. Server paths resolve from the module location and work when invoked from either the root or the backend workspace.

Useful focused commands:

```sh
npm run build --workspace @ra/frontend
npm run build --workspace @ra/backend
npm test --workspace @ra/backend
npm run typecheck --workspace @ra/contracts
npm run verify
```

`npm run dev` runs the backend with Vite middleware and React hot reload. The browser acceptance server uses port **3100**, separate from the normal preview on port **3000**, and always starts a fresh production server. `npm run verify` performs dependency policy/audit checks, formatting, lint, whole-repository unit coverage, integration tests, the production build/type checks, and browser tests in sequence. The checked-in GitHub Actions workflow runs this same command.

See [multi-tenant architecture](docs/ARCHITECTURE.md), [database ownership](database/README.md), [repository scripts](scripts/README.md), and [S0.1 evidence](docs/S0.1.md).

## Dependency security policy

**Use npm only.** The root `package.json` declares `packageManager: npm@11.19.1`, enforces npm `>=11.19.1 <12`, and all workspaces share one committed `package-lock.json`. Do not add Yarn, pnpm, Bun, or nested lockfiles.

The checked-in [.npmrc](.npmrc) sets:

- `min-release-age=7`: npm excludes registry versions published less than seven days ago when resolving new dependencies, including transitive dependencies. No release-age exclusions are configured. [Official npm configuration reference](https://docs.npmjs.com/cli/v11/using-npm/config/#min-release-age).
- `save-exact=true`: new dependencies are saved as exact versions. All repository-owned dependency declarations and overrides must use exact versions, including local workspace references such as `@ra/contracts: 0.1.0`.
- `engine-strict=true`, `package-lock=true`, and auditing at every vulnerability severity.

Install from the repository root, using workspace targeting where needed:

```sh
npm ci
npm install package-name --workspace @ra/frontend
npm install --save-dev package-name --workspace @ra/backend
npm run security:check
npm run verify
```

`npm ci` reproduces the committed lockfile; `npm install` resolves additions/updates under the age policy. Review and commit both manifests and lockfile after dependency changes. Exact direct versions do not pin transitive dependencies by themselves; the lockfile does.

The root `preinstall` hook checks npm selection, exact versions, one-lockfile ownership, and effective inherited configuration. `npm run security:check` runs the policy check and `npm audit` for every workspace **and the root**, including production, development and optional dependencies. It fails on any reported vulnerability and on audit/network errors. This check is also the first step of `npm run verify`.

Do not bypass the policy with release-age exclusions, `--before`, a relaxed age setting, `--ignore-scripts`, `--force`, or another package manager in normal installs. npm command-line/environment overrides and skipped lifecycle hooks can bypass repository defaults; these controls are guardrails, not an immutable security boundary. If an urgent security fix is younger than seven days, surface the conflict and review it explicitly rather than silently relaxing the policy. Do not use `npm audit fix --force`.

**Historical audit baseline, 31 October 2026:** the lockfile had zero known vulnerabilities before the pre-commit tooling dependencies were added. This is not an audit result for the current lockfile. Re-run the audit whenever dependencies change and before release; a clean audit does not detect every malicious or previously unknown package issue.

**Audit result, 1 November 2026:** the full root/workspace audit reports 17 moderate findings through the tooling and Sentry `glob` and `minimatch` dependency chains. The first patched releases (`glob@14.0.2`, `minimatch@11.0.1`) were published on 27 October and do not yet meet the seven-day floor. `npm run verify` currently stops at the audit; do not interpret passing unit, integration, build or browser checks as a passing security audit. No release-age exception or audit bypass has been added.

The affected paths include `@sentry/node` / `@sentry/vite-plugin → @sentry/bundler-plugins → glob`, `c8 → test-exclude → glob/minimatch`, `eslint → minimatch` (also through `@eslint/config-array`), and `typescript-eslint → @typescript-eslint/typescript-estree → minimatch`. The advisories cover [minimatch versions below 11.0.1](https://github.com/advisories/GHSA-g3hv-75wg-m249) and [glob versions 9.0.0 through 14.0.1](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4); downgrading within the existing supported dependency ranges does not resolve them.

Registry publication timestamps make `glob@14.0.2` eligible on **4 November 2026 at 03:37:00.325 IST** and `minimatch@11.0.1` eligible at **03:56:03.755 IST** that day. These are the earliest fixed versions, not a validated upgrade recommendation. After both times, recheck advisories and release timestamps, select exact versions, regenerate the root lockfile with the unchanged age policy, and validate compatibility with `npm run verify`. Both fixes cross major versions relative to the installed packages, so overrides require compatibility testing. Until then, clearing the audit requires replacing the affected tooling and validating equivalent lint and per-file coverage checks; no dependency-only remediation currently satisfies the seven-day policy.

## Database foundation

MariaDB persistence uses TypeORM/mysql2 with ten foundation tables, locked migrations, an execution ledger/attempt history and repeatable dev preview seeds. Docker runs the local database and DbGate browser client; the application remains one Node process. Start both tools with `docker compose --env-file backend/.env up -d --wait`, then open [DbGate](http://localhost:8082) and log in as `stocksbuddha` with your local `DB_PASSWORD`. DbGate is local-only; use migrations for schema changes and Beekeeper for deployed dev/prod. Follow [database setup](database/README.md), [reviewed schema](docs/DATABASE_DESIGN.md) and [implementation/recovery notes](docs/DATABASE_IMPLEMENTATION.md).

`DATABASE_MODE=mariadb` selects real adapters and fails closed on unavailable schema; development without configuration keeps fixture previews. Production defaults to MariaDB. Migrations run explicitly during release, never on application startup. `GET /api/ready` checks persistence separately from process liveness. Email/password sessions, membership-protected workspace routes and audited membership APIs are mounted in MariaDB mode. Users remain global: `auth_users.signup_tenant_id` records first signup origin, `auth_sessions.login_tenant_id` records session origin, and `audit_events` retains signup/login history. Migration `1793491200009` adds this provenance without granting access or assigning existing users. See [legacy-user backfill queries](database/queries/backfill-auth-tenant-context.sql). Set `AUTH_SECRET` and `AUTH_BASE_URL` before starting it; fixture previews keep authentication unavailable. See [authentication setup, routes and limits](docs/AUTHENTICATION.md). Editor endpoints remain future work.

## Accessibility and languages

The website supports English/Hindi through the visible language links (`?lang=en` / `?lang=hi`), including server-rendered content and metadata. Display preferences offer larger text up to 200%, high contrast, reduced motion and reset. Body copy defaults to 18px; controls and disclosures use at least 16px. Language and display preferences are remembered when browser cookies/storage are available.

Shared UI translations live in `frontend/src/locales/en.json` and `hi.json`, with stable keys such as `nav.subscribe`. Tenant-owned website copy lives separately under `backend/src/websites/seeds/<tenant>/<locale>.json`. Each website selects its enabled/default languages, approved template, ordered sections and branding. Beta demonstrates a different template and section order. Validation requires complete enabled translations; language preferences stay tenant-specific. See [translation maintenance](docs/I18N.md) and [architecture](docs/ARCHITECTURE.md).

Playwright covers translation, keyboard focus, dialog behavior, persistence, text enlargement, responsive reflow and axe accessibility scans. See [accessibility implementation and verification](docs/ACCESSIBILITY.md). Hindi financial/legal text still needs RA approval, and professional accessibility auditing plus the real accessibility contact/grievance channel remain launch requirements. Automated tests are not compliance certification.

## Boundaries

Tenant profiles and localized publications can use either validated source fixtures or MariaDB adapters. Database mode includes persistent revisions, tenant constraints, migrations and internal authenticated tenant operations. The public website API remains read-only. Tenant account pages (`/ra/<slug>/login` and `/ra/<slug>/signup`) and protected workspace overviews (`/ra/<slug>/workspace`) share the public React design system; membership APIs enforce a separate authenticated boundary. No editor/payment flow or deployed infrastructure is introduced. No customer records are seeded. Public responses exclude private membership/authentication data.

Stocks Buddha details reproduce the owner’s supplied brand, legal name and registration string; verification and approved content remain prerequisites for launch. Alpha and Beta are explicitly synthetic and use no registration credentials. The monogram and portrait area are placeholders. No invented pricing, testimonials, performance results, or research recommendations appear.

All preview pages use `noindex` and `no-store`. Google Fonts are optional network enhancements with local serif/sans fallbacks. Revisit font self-hosting and the content security policy before production. Path tenancy separates resolution, not browser origins; workspace authorization checks persistent sessions and current memberships on every private request; future business endpoints must enforce their capabilities too.

The public access policy and internal database operations are tested separately. Internal operations validate stored sessions, permissions and transaction concurrency; authentication and workspace membership routes are mounted in MariaDB mode. Next: verification/recovery delivery, administrator MFA, invitations and the owner editor/API using this foundation. The reference project remains intact. No deployment or changes to the existing Hostinger site are included.

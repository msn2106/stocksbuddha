# Stocks Buddha

Clean incremental rebuild of the reference application in `../website`. Current slice: **tenant-owned investor onboarding, KYC, plans and agreement-before-payment checkout**, built on the S0.2 website architecture. This is a local development preview, not a production research service.

## Run

Use Node **24.22.0** (`nvm use`) and npm **11.19.1**, then:

```sh
npm ci
npm run dev
```

Open the [StocksBuddha platform website](http://localhost:3000/). RA websites remain available at [Stocks Buddha](http://localhost:3000/ra/stocksbuddha), [Alpha demo](http://localhost:3000/ra/alpha), and [Beta demo](http://localhost:3000/ra/beta). The former `/ra/stocks-buddha` address redirects permanently to `/ra/stocksbuddha`, preserving the query string. Unknown/reserved tenant slugs and unsupported routes return HTTP 404, not another tenant’s content.

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

Private documents use Google Drive for file bytes and MariaDB for tenant-scoped metadata, integrity hashes and audit events. The three RA folders are provisioned in `stocksbuddha@gmail.com`; backend OAuth authorization enables runtime access. New uploads use readable RA folder names, `General/` for RA files and `Customer/<membership UUID>/` for customer files, with RA evidence in `ForYouByRA/`. Immutable tenant metadata identifies each RA folder even when its display name changes. Owner, RA and customer workspaces include Documents upload/download pages. See [Google Drive setup and access rules](docs/GOOGLE_DRIVE.md) before enabling uploads.

Sentry captures browser/React and server failures in separate projects, with performance tracing and source-map uploads. The app currently runs locally only. See [Sentry setup](docs/SENTRY.md) for frontend/backend development and production variables, build tokens, sampling, and the preparation needed before deploying on Hostinger or another Node platform. Monitoring initializes only when a DSN is configured.

## Investor onboarding

Investors now see KYC, plan/MITC and payment steps on their dashboard. RA Admins manage **Users**, subscription plans, discount codes and reviewed agreement settings. KYC uses manual KFIN review with retained evidence; agreement consent/signing precedes Cashfree payment. Private Drive archives hold the canonical agreement and commercial invoice/receipt, with durable email retries. Recommendation lists/downloads require current verified KYC, an active paid period and archived agreement evidence; historical agreements/receipts remain available to active members. RA Admins can inspect payment/delivery jobs and request retries in onboarding. Background failures and queues older than an hour emit sanitized Sentry events. Storage uploads use recoverable leases, with Drive requests outside database transactions. Apply migrations through `1794182400000` before starting this version. See [setup, routes and operating limits](docs/INVESTOR_ONBOARDING.md) and [SEBI RA review and production blockers](docs/SEBI_RA_REVIEW.md). Development skips are explicit and prohibited in production; live signing/payments remain disabled until the documented activation review is complete.

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

`npm run dev` runs the backend with Vite middleware and React hot reload. The terminal prints the StocksBuddha platform website URL first, followed by the Stocks Buddha RA website URL. The browser acceptance server uses port **3100**, separate from the normal preview on port **3000**, and always starts a fresh production server. `npm run verify` performs dependency policy/audit checks, formatting, lint, whole-repository unit coverage, integration tests, the production build/type checks, and browser tests in sequence. The checked-in GitHub Actions workflow runs this same command.

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

The independent **Critical dependency audit** CI job runs `npm run security:audit:critical` on every push and pull request. It audits the committed lockfile across the root and all workspaces, explicitly including development and optional dependencies, without installing project dependencies or running their lifecycle scripts. It fails when the critical vulnerability count is greater than zero, or when the audit cannot complete. Lower-severity findings remain visible but do not fail this dedicated job; the existing full audit still rejects them. Requiring this job before merging also requires GitHub branch protection or a ruleset.

**Audit result, 9 November 2026:** the full root/workspace audit reports **zero vulnerabilities** after exact overrides to `glob@14.0.3` and `minimatch@11.0.3`. Their registry publication dates (28 October 2026) satisfy the unchanged seven-day release-age policy. These transitive major-version overrides require lint, coverage, build and integration compatibility checks whenever updated. Re-run the audit before release; it cannot detect every malicious or unknown package issue.

Do not bypass the policy with release-age exclusions, `--before`, a relaxed age setting, `--ignore-scripts`, `--force`, or another package manager in normal installs. Do not use `npm audit fix --force`.

## Platform website and RA routes

The root `/` is the StocksBuddha platform brand website, with English/Hindi content, demo enquiries by email and separate sign-in entry points for investors, RA teams and platform administration. It does not inherit the Stocks Buddha RA's identity or registration. Each RA keeps its public website at `/ra/<slug>`, including `/ra/stocksbuddha`, and its membership-protected workspace at `/ra/<slug>/workspace`. Platform-owner administration stays at `/workspace`. Generic `/login` and `/signin` now lead to the platform's RA access section; `/signup` leads to demo enquiries. Organisation onboarding remains owner-managed and invitation-based. **One email has one role per RA:** Subscriber and organisation staff (RA Admin, Analyst, Support) are mutually exclusive. Staff cannot sign up, enrol or enter the subscriber dashboard with that email in the same RA; subscribers cannot be invited into a staff role. Use a different email for the other role. The same global identity can have different roles in different RAs. See [role exclusivity, messages and security boundaries](docs/ROLE_EXCLUSIVITY.md). See [platform website, routes and indexing](docs/PLATFORM_WEBSITE.md).

All pages remain non-indexable by default. An explicit production-only `BRAND_SITE_INDEXABLE=true` setting enables indexing for the root platform page; RA websites, authentication, workspaces, previews and errors retain their restrictions. No live hosting or DNS changes are included.

## Database foundation

MariaDB persistence uses TypeORM/mysql2 with twenty-one tables including private document metadata and migration metadata, locked migrations, an execution ledger/attempt history and repeatable dev preview seeds. Docker runs the local database and DbGate browser client; the application remains one Node process. Start both tools with `docker compose --env-file backend/.env up -d --wait`, then open [DbGate](http://localhost:8082) and log in as `stocksbuddha` with your local `DB_PASSWORD`. DbGate is local-only; use migrations for schema changes and Beekeeper for deployed dev/prod. Follow [database setup](database/README.md), [reviewed schema](docs/DATABASE_DESIGN.md) and [implementation/recovery notes](docs/DATABASE_IMPLEMENTATION.md).

`DATABASE_MODE=mariadb` selects real adapters and fails closed on unavailable schema; development without configuration keeps fixture previews. Production defaults to MariaDB. Migrations run explicitly during release, never on application startup. `GET /api/ready` checks persistence separately from process liveness. Email/password sessions, membership-protected workspace routes and audited membership APIs are mounted in MariaDB mode. Users remain global: `auth_users.signup_tenant_id` records first signup origin, `auth_sessions.login_tenant_id` records session origin, and `audit_events` retains signup/login history. Migration `1793491200009` adds this provenance without granting access or assigning existing users. See [legacy-user backfill queries](database/queries/backfill-auth-tenant-context.sql). Set `AUTH_SECRET` and `AUTH_BASE_URL` before starting it; fixture previews keep authentication unavailable. See [authentication setup, routes and limits](docs/AUTHENTICATION.md). Owner-only editor endpoints now provide draft saving, private preview and atomic publication; see [the website editor](docs/WEBSITE_EDITOR.md).

## Accessibility and languages

The website supports English/Hindi through the visible language links (`?lang=en` / `?lang=hi`), including server-rendered content and metadata. Display preferences offer larger text up to 200%, high contrast, reduced motion and reset. Body copy defaults to 18px; controls and disclosures use at least 16px. Language and display preferences are remembered when browser cookies/storage are available.

Shared UI translations live in `frontend/src/locales/en.json` and `hi.json`, with stable keys such as `nav.subscribe`. Tenant-owned website copy lives separately under `backend/src/websites/seeds/<tenant>/<locale>.json`. Each website selects its enabled/default languages, approved template, ordered sections and branding. Beta demonstrates a different template and section order. Validation requires complete enabled translations; language preferences stay tenant-specific. See [translation maintenance](docs/I18N.md) and [architecture](docs/ARCHITECTURE.md).

Playwright covers translation, keyboard focus, dialog behavior, persistence, text enlargement, responsive reflow and axe accessibility scans. See [accessibility implementation and verification](docs/ACCESSIBILITY.md). Hindi financial/legal text still needs RA approval, and professional accessibility auditing plus the real accessibility contact/grievance channel remain launch requirements. Automated tests are not compliance certification.

## Boundaries

Tenant profiles and localized publications can use either validated source fixtures or MariaDB adapters. Database mode includes persistent revisions, tenant constraints, migrations and internal authenticated tenant operations. The public website API remains read-only. Tenant account pages (`/ra/<slug>/login` and `/ra/<slug>/signup`) and protected investor (`/ra/<slug>/account`) / organisation (`/ra/<slug>/workspace`) shells share the public React design system; membership APIs enforce a separate authenticated boundary. RA owners can edit and preview saved drafts at `/ra/<slug>/workspace/website`, then publish atomically. A gated Cashfree checkout and document-delivery flow is implemented; no deployed infrastructure or live merchant provisioning is introduced. No customer records are seeded. Public responses exclude private membership/authentication data.

Stocks Buddha details reproduce the owner’s supplied brand, legal name and registration string; verification and approved content remain prerequisites for launch. Alpha and Beta are explicitly synthetic and use no registration credentials. The monogram and portrait area are placeholders. No invented pricing, testimonials, performance results, or research recommendations appear.

All preview pages use `noindex` and `no-store`; only the platform homepage has an explicit production indexing opt-in. Google Fonts are optional network enhancements with local serif/sans fallbacks. Revisit font self-hosting and the content security policy before production. Path tenancy separates resolution, not browser origins; workspace authorization checks persistent sessions and current memberships on every private request; future business endpoints must enforce their capabilities too.

The public access policy and internal database operations are tested separately. Internal operations validate stored sessions, permissions and transaction concurrency; authentication and workspace membership routes are mounted in MariaDB mode. Hostinger SMTP-backed verification/recovery, shared MariaDB authentication limits and explicit trusted-proxy configuration are available; see [authentication setup](docs/AUTHENTICATION.md). Production requires an active Hostinger mailbox and authenticated SMTP credentials. Platform-owner setup, personalised RA Admin/team invitations with prefilled, single-step account setup (the invite verifies new accounts), RA Admin-only team invitation resend/cancellation and organisation access revocation are available (run migration `1793491200012` before starting this version); see [organisation access and bootstrap](docs/ORGANISATION_ACCESS.md). The owner editor/API now uses this foundation; administrator MFA remains future work. The reference project remains intact. No deployment or changes to the existing Hostinger site are included.

Platform-owner email verification and password recovery use `/workspace/verify-email`, `/workspace/forgot-password` and `/workspace/reset-password`, independently of RA login pages. For an existing account, verify through the platform page, explicitly bootstrap the verified owner, then sign in at `/workspace/login` with its existing password. Verification and recovery never assign roles. See [owner setup and organisation access](docs/ORGANISATION_ACCESS.md).

Authentication mail (verification, password reset and organisation invitations) uses **Hostinger SMTP** through Nodemailer. Configure `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_USER`, `SMTP_PASSWORD` and matching `AUTH_EMAIL_FROM` in ignored `backend/.env`, then restart the server. Use the mailbox password rather than the hPanel password. See [SMTP setup, observed account limits and delivery troubleshooting](docs/AUTHENTICATION.md#hostinger-account-capacity-and-setup). No email-provider API key is required.

### RA website editor

In MariaDB mode, an RA Admin (tenant `owner` with `website:edit`) sees **Edit website** in the organisation workspace. Platform ownership alone, analyst/support membership and investor access do not grant editor access. Fixtures remain read-only.

The editor supports website identity/contact details, fonts and theme colours, English/Hindi content, navigation labels/order, section ordering and optional section additions/removal, section layouts, hosted HTTPS images with bilingual alternative text, and footer layout/copy. Hero stays first and required research/investor sections cannot be removed. This is a configuration editor for the approved landing components; it does not accept arbitrary HTML or custom components, and image files must already be hosted.

**Save draft** preserves partial content without changing the live site. Complete enabled translations, save, then use **Preview** to inspect the private saved revision on desktop/mobile. **Publish website** confirms and atomically switches the public revision. Saves carry optimistic versions and retry keys; concurrent edits/publications return a conflict without replacing local edits. Copy needed changes before reloading on conflict. No published site or another tenant's content is used to fill a new organisation's draft.

The private API is `GET/POST /api/workspaces/<slug>/website`; POST accepts `action` (`save`, `publish` or explicit `rebase`), draft `id`, `version`, a UUID `Idempotency-Key`, and (for saves/rebases) `snapshot`. Tenant identity comes from the route and fresh session membership; mutations require a matching Origin. Preview is `GET /ra/<slug>/workspace/website/preview?lang=en|hi`, owner-authorized and non-cacheable. [Editor details](docs/WEBSITE_EDITOR.md).

# Testing architecture

Run all commands from the repository root unless targeting a workspace explicitly.

| Command                    | Responsibility                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`        | Isolated logic, React DOM interactions, SSR/hydration, in-memory HTTP handlers and tooling with controlled adapters    |
| `npm run test:integration` | Real ephemeral HTTP servers, Git subprocesses and a local npm registry                                                 |
| `npm test`                 | Unit tests followed by integration tests                                                                               |
| `npm run test:coverage`    | Fresh whole-repository unit coverage with >90% per file for every metric                                               |
| `npm run test:e2e`         | Playwright against the production build; run `npm run build` first                                                     |
| `npm run precommit:check`  | Lint/format/JSDoc for changes, type checks and changed-file unit coverage                                              |
| `npm run verify`           | Security checks, formatting, lint, whole-repository unit coverage, integration tests, build/type checks and Playwright |

`scripts/run-tests.mjs` recursively discovers `.test` and `.spec` files with JS/TS, JSX/TSX and ESM/CommonJS module extensions in every workspace's `tests/` directory and `scripts/tests/`. Files beneath an `integration/` directory belong only to the integration suite. Helpers without a test/spec suffix do not run as standalone tests. An empty selected suite is an error. Tests run in separate Node processes with a 60-second per-test timeout and the shared TypeScript compiler configuration, including automatic React JSX handling. Use `npm run test:unit --workspace @ra/frontend`, `@ra/backend` or `@ra/contracts` for focused runs.

## Frontend

`frontend/tests/dom.ts` installs jsdom globals before React DOM/Testing Library imports. Component tests use accessible roles/names and user interactions, not component internals. Cleanup and browser-state resets prevent storage, cookies, portals and root display styles from leaking between tests. These tests cover menus, dialogs/focus restoration, research selection, preferences, malformed/unavailable storage, enabled languages and configured section order.

SSR tests verify escaped metadata, selected-language content and script-safe bootstrap JSON. The client test hydrates that exact server projection and tears down its React root. Its Node loader treats CSS as an empty module; the production Vite build and browser tests validate CSS loading and layout. jsdom does not establish real visual layout, accessibility compliance or browser compatibility; Playwright retains those browser-level checks.

## Backend and contracts

`backend/src/app.ts` exports `createPublicApp`, which accepts resolver, renderer, asset and error-reporting adapters and never listens on a port. Unit tests exercise real Express handlers over an in-memory transport with controlled adapters. Separate HTTP integration tests bind port 0 and close every server/connection in cleanup.

`backend/src/main.ts` exports `startServer` and starts automatically only when executed as the entrypoint. Startup tests inject Vite/Nest boundaries and use temporary template/renderer files, verifying environment configuration, lifecycle setup, production rendering and development error forwarding without opening ports.

Tenant repositories and the public resolver retain their asynchronous interfaces, allowing small fake adapters for failure and ownership scenarios. Contracts own their schema, locale and serialization tests in `packages/contracts/tests/`; application tests retain assertions about how they use those contracts. Shared test fixtures are schema-valid synthetic data, independent of backend seed content, and are never bundled into production imports.

Database unit tests cover migration orchestration, manifest checks, configuration, snapshot validation and guarded tenant operations with controlled adapters. Run `RUN_DATABASE_TESTS=true npm run test:database` for real MariaDB constraints, migration execution, concurrent operations and mounted signed-cookie authentication/workspace isolation. Auth unit tests cover form routing, origin checks, current membership guards and mutation error handling. React component tests cover account form interactions, error/empty states, safe SSR and English/Hindi labels. Account browser tests verify tenant navigation, shared styling, hydration, focus and responsive axe scans. This suite reads dev connection settings, requires local CREATE/DROP DATABASE permissions, and creates/removes only disposable `sb_test_*` databases. It is also discovered by `test:integration`, but explicitly skips without the opt-in. The real-DB suite also verifies tenant provenance, old-schema upgrades, delivered backfill SQL, cross-RA login history and atomic trigger rollback on audit failure. Ordinary unit/integration success alone does not establish MariaDB correctness. See the [database setup and test instructions](../database/README.md).

Workspace regressions exercise many memberships and concurrent identities against a simulated five-connection pool, and the MariaDB suite repeats that scenario using a real five-connection pool. Transactional website/staff checks are compared with the shared role policy, including mismatched identities and tenants. Use isolated test-server credentials for real database runs; application grants should remain restricted.

## Coverage and tooling

Both coverage commands use c8 source maps and the same `precommit-policy.mjs` rules. Strictly greater than 90% is required separately for lines, statements, functions and branches of each included executable file; exactly 90% fails. These are whole-file thresholds. Integration and browser runs do not contribute to unit coverage. Whole-repository reports live in ignored `coverage/unit/`; changed-file reports live in `coverage/precommit/`.

Tests, declaration files, erased type-only modules, dependencies and generated output are outside runtime coverage. Only the identified ESLint, Playwright, Vite and tsup configuration files are exempt; application files such as `src/config.ts` remain included. Startup/CLI code and tooling scripts are included, with adapter-based unit tests for orchestration. The dependency-policy checker runs against fixture roots through its exported function, so coverage measures the actual repository module rather than a temporary copy.

The pre-commit runner and verification runner are also tested with controlled command adapters, including failed commands, stale/missing reports, exactly-90% coverage, source-only fixes and index protection. Separate integration scenarios exercise actual Git, ESLint, Prettier, c8 and Node tests in a disposable repository.

## CI and commit checks

`.github/workflows/verify.yml` installs the pinned Node/npm versions, dependencies and Chromium, then invokes the same `npm run verify` used locally. The checked-in workflow takes effect after it is committed and pushed to GitHub; creating it does not configure remote branch protection.

The workflow also runs an independent **Critical dependency audit** job on pushes and pull requests. `npm run security:audit:critical` audits the root/workspace lockfile, including development and optional dependencies, without installing project dependencies. Any critical finding or audit/network error fails this job. Other severities do not fail this dedicated job; `npm run verify` retains its stricter all-severity audit. Local-registry integration regressions exercise the actual npm command with clean, high, critical and unavailable-registry responses. Configure branch protection or a ruleset to require the job before merging.

Enable the local Git hook with `npm run hooks:install`. It validates staged changes and refuses tracked working files that differ from the index or untracked code/config that could influence results. It never stages, fixes or commits files. Codex's `$precommit-check` additionally reviews README/docs accuracy; `$precommit-fix` can repair code/tests/JSDoc and stale documentation. Documentation correctness still requires that semantic review.

Security regression coverage now includes explicit trusted proxy chains, spoofed/oversized headers, bounded/redacted Hostinger SMTP failures, isolated Sentry scopes and reset URL redaction. Disposable MariaDB verifies shared concurrent counters across two authentication instances, captured verification links, explicit enrollment, password reset, session invalidation and reset-token replay rejection. These tests send no actual email; mailbox credentials/DNS readiness and real inbox delivery are separate checks.

The organisation extension follows TDD with policy/service/bootstrap and React shell unit tests. `npm run test:e2e:organisations` runs the separate Playwright owner/admin/team journey using disposable MariaDB fixtures, captured email and responsive axe checks. It requires the local dev admin credentials and never modifies application users or sends real mail. See [organisation access verification](ORGANISATION_ACCESS.md#verification).

Platform recovery regression tests cover `/workspace/verify-email`, `/workspace/forgot-password` and `/workspace/reset-password`: null tenant context, platform-only callbacks, origin rejection, reset-cookie isolation, disabled-service handling, and no role grants. The organisation Playwright suite captures verification/reset messages in memory, follows the real email links, resets the password and confirms that a verified identity without a platform-owner grant cannot enter the owner workspace. No real email is sent.

Hostinger SMTP adapter unit tests cover 465/TLS and 587/required STARTTLS, complete credentials, matching sender, rejected recipients, origin validation, deadlines, redacted errors and transport cleanup. Authentication browser tests use captured messages rather than live SMTP, so they consume no Hostinger sending allowance. Production transport readiness requires the real mailbox password and is a separate check; test credentials are never substituted into the local application database.

`backend/tests/integration/smtp.test.ts` exercises the real Nodemailer SMTP protocol against an ephemeral loopback-only sink. Only its injected test factory substitutes a plaintext local transport; unit tests assert that the production configuration requires validated TLS. This test sends no external message and consumes no mailbox quota.

The organisation browser suite also checks unpublished branding exclusion from anonymous HTML/hydration in Hindi and session revocation through tenant logout after suspension. These fixtures mutate only their disposable database; test-only mail/lifecycle routes are never bundled into the application. Unit regressions cover safe pre-publication branding, mismatched tenant projections, unavailable-tenant logout, origin rejection and throttled form status/backoff.

Website editor unit tests cover branding, bilingual text, navigation, section/media/footer edits, loading failures, unsaved changes, request retries, publication and explicit conflict recovery. Owner API tests verify envelope validation, role/origin boundaries, safe failures and preview validation. The organisation browser suite also exercises saving an incomplete draft, completing bilingual content, private preview, publishing and Hindi public rendering against real MariaDB.

## Role exclusivity regressions

The role matrix covers RA Admin, Analyst, Support and Subscriber in each RA. Tests verify wrong-capsule denial, authenticated-own signup messages without anonymous role disclosure, subscriber conflicts on invite/resend/accept, no outgoing mail or replacement link after rejection, staff-to-subscriber direct URL/API attempts, category-change PATCH rejection, old pending links, concurrent enrolment/acceptance and cross-RA independence. New roles must extend the shared tests and use the same guards. Playwright captures the real messages using disposable fixtures; MariaDB tests check authoritative rows and transaction results. See [policy and complete coverage](ROLE_EXCLUSIVITY.md).

## Private document storage

`backend/tests/documents.test.ts` tests role separation, file validation, OAuth configuration and the Drive HTTP adapter against mocked Google responses. `frontend/tests/components/documents.test.tsx` covers activation state, role-specific upload forms, authenticated attachment links, pagination, raw uploads and localized errors. They run in `npm run test:unit`.

`backend/tests/integration/documents.test.ts` uses an isolated temporary MariaDB database, real migrations and Better Auth sessions with an in-memory Drive adapter. It checks tenant/customer isolation, fresh revocation, foreign keys, retained evidence, SHA-256 integrity, audit records, origin enforcement and HTTP uploads/downloads. Run with `RUN_DATABASE_TESTS=true` and a local test administrator connection capable of creating/removing temporary databases, following the existing database test workflow. No real customer documents or Google credentials are used in automated tests. A live Google upload/download round trip remains an activation check after `npm run drive:authorize` and `npm run drive:check`.

Folder-layout regressions additionally cover readable RA names, repeat reuse, tenant-name changes, adoption of existing UUID folders, identical names across RAs, a name colliding with Main, Unicode/apostrophes, unrelated/foreign-root folders, ambiguous matches and private-permission checks. MariaDB document tests assert the exact parent for every document kind, separate customer and tenant membership paths, refreshed database display names and downloads from historical recorded parent IDs. No live Drive folders/files are moved by these tests.

`backend/tests/document-access.test.ts` directly exercises the real document policy/service with controlled database/provider adapters. It covers all cross-tenant role/kind/action combinations, two customers in one RA, the same user with different RA roles, RA access to all own-client records, repeated own-evidence reads, global platform-role restrictions, invalid/foreign pagination cursors, authorized multi-page listing, excessive repository projections, guessed IDs, spoofed upload targets and fresh session/membership/tenant revocation. Real MariaDB document integration tests additionally check cursor visibility and HTTP attempts to download or filter for another customer/RA. These are application-authorization checks; they do not constrain a person who has the storage-account password or unrestricted server/database access.

## Investor onboarding and commerce

`onboarding-domain`, `onboarding-routes` and `onboarding-service` unit suites cover validation, HTTP authorization, a controlled in-memory workflow adapter, encrypted KYC, pricing/consent/payment state machines and delivery retries. The SQLite-based unit adapter translates selected dialect constructs and is not MariaDB compatibility proof. `frontend/tests/components/onboarding.test.tsx` exercises English/Hindi forms, upload/reference handling, plan/coupon settings, admin review, checkout consent and payment recovery. `tests/organisation/onboarding-flow.ts` extends the disposable MariaDB Playwright suite with KYC corrections, separate KFIN evidence, exact discounted agreement, email-code signing, payment-before-consent denial, payment/invoice/mail delivery and canonical attachment equality, download isolation, responsive screenshots and axe. Test Drive, Cashfree and email adapters do not contact external providers. See [onboarding verification](INVESTOR_ONBOARDING.md#verification).

## Four-finding regression coverage

Research-delivery tests now reject unpaid, future/expired, unverified-KYC and missing-agreement subscribers while retaining historical agreement downloads; excessive-row and pagination cases also hide ineligible research. Storage tests pause provider work, assert no active database transaction during I/O, reject a second same-scope upload, allow another scope, fence expired/replaced leases, and reject authorization revoked during transfer. The MariaDB document suite checks that a tenant row can be locked during a paused upload and that HTTP metadata excludes ineligible recommendations.

Queue tests cover sanitized failure classification, one-hour backlog warnings/throttling, current tenant-admin status/retry authorization, cross-RA/subscriber denial, live-lease protection and refusal to resend completed deliveries. Sentry tests capture locally and assert ambient identity, breadcrumbs and provider bodies are absent. English/Hindi delivery-status component tests cover refresh, retry, errors and recovery. Live Sentry verification is a separate explicitly authorized check; unit and browser tests do not export events or transmit payment/mail/document data externally.

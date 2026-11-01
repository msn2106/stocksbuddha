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

Enable the local Git hook with `npm run hooks:install`. It validates staged changes and refuses tracked working files that differ from the index or untracked code/config that could influence results. It never stages, fixes or commits files. Codex's `$precommit-check` additionally reviews README/docs accuracy; `$precommit-fix` can repair code/tests/JSDoc and stale documentation. Documentation correctness still requires that semantic review.

Security regression coverage now includes explicit trusted proxy chains, spoofed/oversized headers, bounded/redacted Hostinger SMTP failures, isolated Sentry scopes and reset URL redaction. Disposable MariaDB verifies shared concurrent counters across two authentication instances, captured verification links, explicit enrollment, password reset, session invalidation and reset-token replay rejection. These tests send no actual email; mailbox credentials/DNS readiness and real inbox delivery are separate checks.

The organisation extension follows TDD with policy/service/bootstrap and React shell unit tests. `npm run test:e2e:organisations` runs the separate Playwright owner/admin/team journey using disposable MariaDB fixtures, captured email and responsive axe checks. It requires the local dev admin credentials and never modifies application users or sends real mail. See [organisation access verification](ORGANISATION_ACCESS.md#verification).

Platform recovery regression tests cover `/workspace/verify-email`, `/workspace/forgot-password` and `/workspace/reset-password`: null tenant context, platform-only callbacks, origin rejection, reset-cookie isolation, disabled-service handling, and no role grants. The organisation Playwright suite captures verification/reset messages in memory, follows the real email links, resets the password and confirms that a verified identity without a platform-owner grant cannot enter the owner workspace. No real email is sent.

Hostinger SMTP adapter unit tests cover 465/TLS and 587/required STARTTLS, complete credentials, matching sender, rejected recipients, origin validation, deadlines, redacted errors and transport cleanup. Authentication browser tests use captured messages rather than live SMTP, so they consume no Hostinger sending allowance. Production transport readiness requires the real mailbox password and is a separate check; test credentials are never substituted into the local application database.

`backend/tests/integration/smtp.test.ts` exercises the real Nodemailer SMTP protocol against an ephemeral loopback-only sink. Only its injected test factory substitutes a plaintext local transport; unit tests assert that the production configuration requires validated TLS. This test sends no external message and consumes no mailbox quota.

The organisation browser suite also checks unpublished branding exclusion from anonymous HTML/hydration in Hindi and session revocation through tenant logout after suspension. These fixtures mutate only their disposable database; test-only mail/lifecycle routes are never bundled into the application. Unit regressions cover safe pre-publication branding, mismatched tenant projections, unavailable-tenant logout, origin rejection and throttled form status/backoff.

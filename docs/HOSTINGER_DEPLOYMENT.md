# Hostinger deployment plan and checklist

Prepared 20 November 2026. Dev deployment executed 21 November 2026; production remains unapproved.

This document plans and records an isolated hosted development instance first. The
user approved dev deployment on 21 November 2026. It does not authorize production
provisioning, live payments or production activation. Unchecked items remain
unverified, unfinished or dependent on separate provider credentials.

## Target and current evidence

Dev URL: `https://dev.stocksbuddha.com`.

The app uses one Nest/Express Node service for React SSR, assets, authentication,
APIs and background jobs, with MariaDB persistence and private Google Drive files.
Deploying only the frontend static output is insufficient.

Read-only Hostinger inspection on 20 November found one active Web/Cloud hosting
subscription with API plan name `hostinger_unlimited_v6`. On 21 November the
subscription provisioned `dev.stocksbuddha.com` as a Node.js website with an isolated
`u218170211_sb_dev` database.

| Area          | Proposed development configuration                                                          |
| ------------- | ------------------------------------------------------------------------------------------- |
| Hosting       | Existing managed Node plan if compatibility is proven; otherwise a separately approved VPS  |
| Runtime       | Node 24; repository baseline 24.22.0 and npm 11.19.1                                        |
| Application   | One persistent service initially, optimized build, same-origin frontend and API             |
| Database      | Separate Hostinger-prefixed `sb_dev` (`stocksbuddha_dev` remains valid where limits permit) |
| Accounts/data | Synthetic investor data and designated tester accounts                                      |
| Storage       | Separate Drive test root and scoped development credentials                                 |
| Payments      | Sandbox merchant credentials; no live payments                                              |
| Notifications | Designated test mailbox/recipients; existing SMS trial restrictions                         |
| Observability | Sentry environment `dev`, matching browser/server release identifiers                       |
| Exposure      | HTTPS, tester access restriction, indexing disabled                                         |

## Phase 1: confirm hosting compatibility

Use the existing subscription only after verifying all requirements. Record the
actual product name, limits, costs and results in the checklist. If managed hosting
cannot satisfy them, present a VPS specification and price for approval before purchase.

- Node/npm versions and root-workspace install/build/start commands are supported.
- The full package layout, backend assets and migration artifacts survive deployment.
- Explicit migration execution is available through a supported shell or release job.
- MariaDB version, SQL behavior, database naming and migration privileges are compatible.
- A persistent process can run the ten-second delivery/reconciliation worker; idle
  suspension and restart behavior are understood.
- Outbound SMTP, Google OAuth/Drive, Cashfree and Sentry are reachable.
- HTTPS, proxy identity, secret configuration, logs, backups and restart controls are available.
- Verified database TLS is feasible for eventual production; do not defer discovery
  of an incompatible database service until promotion.

For managed Hostinger web hosting, use the database's internal connection settings
(`127.0.0.1:3306` per the provider API guidance), not its remote-access hostname.
Confirm the actual endpoint for the chosen product; a VPS topology may differ.
Do not deploy the local Compose file or its DbGate service as the hosted stack.

## Phase 2: implement hosted-dev configuration

The code now supports an explicit `APP_ENV` independently of `NODE_ENV`:

| Deployment           | Settings                                                   | Behavior                                                                                                |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Hosted dev           | `APP_ENV=dev`, `DB_ENV=dev`, `NODE_ENV=production`         | Compiled SSR/assets, sandbox checkout and development signing; test orders remain marked as development |
| Production           | `APP_ENV=production`, `DB_ENV=prod`, `NODE_ENV=production` | Live-provider and production approval gates; no sandbox or development evidence                         |
| Existing local setup | Omit `APP_ENV`                                             | Preserve the existing `NODE_ENV`-based business policy                                                  |

Unknown or mismatched explicit settings fail startup before database access. Use
`npm start` for hosted dev and production; it sets `NODE_ENV=production`. HTTPS,
required SMTP, retained encryption keys, fixture-preview restrictions and market-data
usage approval remain tied to the optimized runtime and are not relaxed by dev mode.
Dev deployments cannot enable homepage indexing, even if the indexing flag is set.
Production database TLS remains enforced by `DB_ENV=prod`.

The policy covers payment settings (including privately stored RA credentials),
signing, order watermarks/provenance, research eligibility and research publication.
Automated regression tests exercise compiled startup, sandbox signing/payment,
entitlement isolation and invalid configurations. Hosted/provider acceptance remains
pending deployment; automated tests use controlled provider adapters.

Keep onboarding bypasses disabled for the primary acceptance journey. If a bypass
is needed for a focused test, record its use and exclude that result from proof of
the real verification/signing flow. Do not set `ONBOARDING_PRODUCTION_APPROVED=true`
as a workaround for dev testing.

## Phase 3: provision isolated dependencies

After approval, create the dev website/service, database and HTTPS subdomain.
Restrict tester access using a host-supported access layer or reviewed application
control. If access protection covers the site, allow authenticated provider webhooks
to reach their intended route without exposing other protected routes.

Supply credentials through the host's secret configuration. Do not copy local env
files into the deployment or publish backend files under the static document root.

| Configuration  | Requirement                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Database       | `DATABASE_MODE=mariadb`, `DB_ENV=dev`, matching `DB_NAME`; distinct operator and runtime credentials where supported |
| Network        | Host-assigned `PORT`, `HOST=0.0.0.0` when required; exact trusted proxy IPs/CIDRs                                    |
| Authentication | Unique `AUTH_SECRET`; `AUTH_BASE_URL=https://dev.stocksbuddha.com` after URL approval                                |
| Encryption     | Generate and retain a separate 64-character lowercase hexadecimal `ONBOARDING_DATA_KEY`                              |
| Indexing       | `BRAND_SITE_INDEXABLE=false`; verify actual response metadata                                                        |
| Integrations   | Dev Drive root/OAuth, test SMTP sender, trial SMS and sandbox merchant settings                                      |
| Market data    | Keep automatic sync disabled until usage approval and persistent storage are configured                              |
| Monitoring     | Explicit backend and frontend Sentry environment/release variables; upload token limited to build use                |

Build-time `VITE_*` variables are public bundle configuration; never put secrets in
them. Back up the database, private objects and retained encryption key with separate
key custody. Record retention, restore location and the operator responsible.

## Phase 4: build and deploy a traceable release

1. Select a reviewed commit and record its SHA. Run `npm ci` from the repository root
   with build-time development dependencies available and the pinned toolchain.
2. Run `npm run verify`. Run actual MariaDB tests against disposable databases and
   `npm run test:e2e:organisations` with its documented prerequisites. A skipped DB
   suite does not establish database correctness. Do not run destructive test setup
   against the persistent hosted dev database.
3. Build with `npm run build` and explicit dev frontend monitoring variables. On Hostinger, use `npm run build:hostinger:dev`; it builds the compiled migration manifest, applies it to the provisioned `DB_ENV=dev` database and runs the repeatable dev preview seed before service startup. Configure `backend/hostinger.cjs` as the entry file because Hostinger's LiteSpeed launcher requires a CommonJS entry while the application remains ESM. Use
   matching release IDs for browser, server and uploaded source maps.
4. Preserve `backend/dist`, `backend/assets`, `frontend/dist/client`,
   `frontend/dist/server`, `database/dist` with its manifest, and required workspace
   manifests/runtime dependencies in their expected relative layout.
5. Before later releases, back up data and stop incompatible old writers. Apply the
   compiled CLI explicitly: `node database/dist/cli.js migrate --target dev`, then
   `node database/dist/cli.js status --target dev`, with injected dev credentials.
   Apply every migration in the selected release's manifest, not an old runbook's
   timestamp. Startup must not migrate automatically.
6. Optionally apply dev-only preview seeds using the supported seed workflow. Seeds
   do not create usable owner accounts. Bootstrap the verified platform owner using
   [organisation access](ORGANISATION_ACCESS.md), then invite test RA administrators.
7. Start the optimized service using `npm start` with `APP_ENV=dev` and `DB_ENV=dev`. Verify
   `/api/health` and `/api/ready`, HTTPS, authentication cookies and public routes.
8. Record deployment/build IDs and confirm worker execution, logs and Sentry source
   maps. Retain the previous artifact for subsequent releases.

The existing Playwright acceptance configuration starts a local server. Add a
separate hosted-test configuration targeting the approved URL, using isolated test
accounts and cleanup that cannot reset shared data. Local E2E success alone is not
hosted acceptance.

## Phase 5: acceptance checklist

For each checked item, record the release SHA, date, tester and evidence link in the
release record. Mark unavailable provider tests as blocked rather than passed.

### Review and preparation

- [ ] User approves dev URL, hosting choice, cost and implementation scope.
- [ ] Managed hosting compatibility is recorded, or VPS alternative is approved.
- [ ] Hosted-dev configuration change and its negative tests are reviewed.
- [ ] Separate database, secrets, Drive root and test integrations are configured.
- [ ] Tester access, HTTPS and indexing restrictions are verified.
- [ ] Backup/restore operator and retention policy are recorded.
- [ ] Verification, real DB tests and organisation-flow tests pass for the release.
- [ ] Build artifacts, migration manifest and monitoring releases match the selected SHA.

### Hosted functionality and isolation

- [ ] Liveness/readiness succeed; DB outage makes readiness fail without fixture fallback.
- [ ] Root/RA pages, unsupported routes and SSR hydration work.
- [ ] Signup, verification, login, logout, recovery and session persistence work.
- [ ] Owner bootstrap, invitations and staff/subscriber role restrictions work.
- [ ] Cross-tenant and cross-customer API/document access is denied.
- [ ] KYC submission, trial mobile verification and manual review work without bypasses.
- [ ] Plan/discount selection, agreement consent and signature precede payment.
- [ ] Letterhead, signature and Hindi PDF rendering survive deployment.
- [ ] Private Drive upload/download, archive integrity and revoked-token failure work.
- [ ] Sandbox success, failure, cancellation and delayed payment outcomes behave correctly.
- [ ] Invalid/duplicate webhooks are handled safely; missed webhooks reconcile.
- [ ] QR claim/review behavior is tested with synthetic evidence and no real transfer.
- [ ] Email retry/recovery and process-restart recovery preserve payment/evidence state.
- [ ] Research publishing, eligibility and historical-access rules are verified.
- [ ] Mobile layouts, Hindi, keyboard navigation and accessibility checks pass.

### Operations and recovery

- [ ] Browser/server Sentry events have environment `dev`, matching releases and readable frames.
- [ ] Alerts reach the designated operator; independent monitoring detects stopped workers.
- [ ] Logs and browser output do not expose secrets or private customer content.
- [ ] Restart/redeploy preserves data and resumes queued work.
- [ ] Backup is restored into isolation; decryption, document hashes and access checks pass.
- [ ] Previous application artifact is recoverable and schema compatibility is assessed.
- [ ] Defects and blocked checks have owners; user accepts the hosted dev result.

## Stop and recovery procedure

Stop acceptance and restrict traffic on data leakage, incorrect entitlement/payment
activation, migration failure, unreadable evidence or persistent readiness failure.
Record the incident and preserve logs without exposing secrets. Stop affected workers
before repair to prevent duplicate external actions.

Do not blindly rerun a failed migration: inspect migration history and follow the
[database recovery runbook](DATABASE_IMPLEMENTATION.md). Application rollback is
allowed only when the previous release is compatible with the current schema. There
is no automatic destructive migration reversal. Otherwise use a reviewed forward fix
or restore into an isolated replacement database, reconcile external provider state,
then deliberately switch traffic. Record any downtime or potential data loss.

## Production promotion: separate future approval

Dev acceptance is not approval for live customers, payments or signing. Complete
the wider [rollout plan](ROLLOUT_PLAN.md) and [production review](SEBI_RA_REVIEW.md).

- [ ] User separately approves production provisioning and deployment.
- [ ] Compliance, signing, refunds, billing, storage and retention blockers are resolved.
- [ ] Production database, encryption key, storage and provider credentials are separate.
- [ ] Verified DB TLS, proxy/auth configuration, backups, alerts and recovery are proven.
- [ ] Promote the accepted commit/artifact; rebuild environment-specific frontend settings
      with traceable provenance and rerun affected checks if artifact bytes change.
- [ ] Production migration and smoke checks pass on the exact release.
- [ ] Live integrations are enabled only under the approved activation procedure.
- [ ] Pilot cohort, operational owners, stop criteria and expansion review are agreed.

## Release record

| Field                                     | Value                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| User approval/date/scope                  | 21 November 2026; dev deployment only                                                                                                     |
| Hosting product and confirmed limits/cost | Existing `hostinger_unlimited_v6`; Node 24 confirmed                                                                                      |
| Approved URL                              | `https://dev.stocksbuddha.com`                                                                                                            |
| Release SHA/build ID                      | Hostinger build `01a1ff51-31e6-717b-92c6-e5744cc883da`                                                                                    |
| Migration manifest/status                 | All 23 migrations and repeatable dev seed applied                                                                                         |
| Test evidence and unresolved defects      | Full local verify passed; live health/readiness/root/RA checks passed. Tester access, isolated Drive and Cashfree sandbox remain pending. |
| Backup/restore evidence                   | Pending                                                                                                                                   |
| Operator and recovery owner               | Pending                                                                                                                                   |
| Dev acceptance decision/date              | Technical deployment complete 21 November 2026; user acceptance pending                                                                   |

Related setup references: [database](../database/README.md),
[authentication](AUTHENTICATION.md), [Drive](GOOGLE_DRIVE.md),
[onboarding](INVESTOR_ONBOARDING.md), [Sentry](SENTRY.md), and
[branding/deployment assets](BRANDING_AND_AGREEMENTS.md).

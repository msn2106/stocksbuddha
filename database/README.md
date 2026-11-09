# MariaDB persistence

The current twenty-nine-table schema uses TypeORM and mysql2. Nineteen ordered application migrations create its tables/relationships; a locked runner bootstraps and verifies two migration metadata tables. See the [reviewed schema](../docs/DATABASE_DESIGN.md) and [implementation/recovery runbook](../docs/DATABASE_IMPLEMENTATION.md). No Hostinger resources have been provisioned or migrated.

## Local setup

Copy `backend/.env.example` to ignored `backend/.env`, replace both local passwords, set a unique random `AUTH_SECRET`, a retained `ONBOARDING_DATA_KEY`, and the exact `AUTH_BASE_URL` origin, then:

```sh
docker compose --env-file backend/.env up -d --wait
npm run db:migrate -- --target dev
npm run db:seed:demo -- --target dev
npm run dev
```

Compose runs MariaDB 11.4.8 and DbGate Community 7.3.2, both pinned by image digest and bound to loopback. MariaDB uses port 3307 by default (`DB_PORT` can select another host port) with a persistent volume. This is a local baseline, not a verified Hostinger version. A fresh image creates `stocksbuddha_dev`; provision `stocksbuddha_prod` separately. Do not stop a database with `down -v` unless its data should be deleted. No frontend/backend containers are required. See [authentication setup and routes](../docs/AUTHENTICATION.md) for session and membership behavior.

If port 3307 is already allocated, set `DB_PORT=3308` (or another unused port) in `backend/.env`, then rerun Compose. The application and CLI read that same setting. Use `docker-compose` instead of `docker compose` if your installation provides the standalone command.

Without a local `.env`, nonproduction startup retains fixture-preview mode. MariaDB failures never fall back to fixtures. Production defaults to MariaDB; fixture production previews require both `DATABASE_MODE=fixtures` and `ALLOW_PUBLIC_PREVIEW=true`.

## Local browser database client

Open [DbGate](http://localhost:8082) after Compose starts. Log in with username `stocksbuddha` and your local `DB_PASSWORD` from `backend/.env`. The local MariaDB connection and `stocksbuddha_dev` database are preconfigured. Browse tables, edit development rows and run SQL in the browser; use migration files for every intended schema change so deployed dev/prod get the same structure. Direct row edits bypass application validation and transactional business audit operations; the database triggers still audit authentication inserts. Use direct edits for deliberate local development adjustments, and use the reviewed backfill transactions for provenance corrections.

Set `DBGATE_PORT` in `backend/.env` if port 8082 is occupied. Both containers start together with the setup command above and continue running when you close the browser. Saved queries/settings use the separate `dbgate_data` volume; table data stays in `database_data`. To stop the tools while preserving their data, use `docker compose --env-file backend/.env stop`. To start only MariaDB, append `db` to the setup command.

DbGate connects internally to `db:3306`, independently of your host `DB_PORT`. Beekeeper Studio connects to `127.0.0.1`, your configured `DB_PORT`, user `stocksbuddha`, the same `DB_PASSWORD`, and database `stocksbuddha_dev`, with local SSL/SSH disabled. Neither client requires the application server to be running.

This Compose file is for local development only. Do not deploy its database console or reuse its local credentials for hosted environments. Continue using Beekeeper for deployed dev/prod through their approved connection settings.

## Migration workflow

```sh
npm run db:migrate:status -- --target dev
npm run db:migrate -- --target dev
RELEASE_ID=your-release-id npm run db:build
```

Production runs the built artifact with deployment-provided credentials:

```sh
node database/dist/cli.js status --target prod
node database/dist/cli.js migrate --target prod
```

Production requires `DB_ENV=prod`, a matching `stocksbuddha_prod` name (optional Hostinger account prefix), and `DB_TLS=true` with verified certificates. Supply `DB_TLS_CA` when needed. Use operator `DB_USER`/`DB_PASSWORD` for migrations and restricted runtime credentials for the application. Never pass secrets as CLI arguments or commit them. The source runner refuses production without a compiled manifest.

Add timestamped reviewed SQL migrations through TypeORM QueryRunner and register classes in `catalog.ts` in matching order. No automatic entity-diff generator is configured. Build manifests hash original source and accompany compiled JavaScript. Applied files stay immutable; automatic destructive reversal is disabled. Status acquires the same lock and can initialize metadata on an empty database, but does not apply application migrations. Unfinished/failed history intentionally blocks normal commands pending operator reconciliation.

## Seeds and tests

Demo seeds are dev-only and insert missing read-only previews. They never overwrite edits, restore an unpublished tenant, or seed passwords/sessions/memberships. Real managed tenant provisioning creates an effective first owner transactionally through the internal service.

```sh
npm run typecheck
npm run test:unit
RUN_DATABASE_TESTS=true npm run test:database
```

The DB suite reads dev connection settings, creates unique `sb_test_*` databases and removes only those databases afterward. Use a local disposable administrative user with CREATE/DROP DATABASE permissions. It never drops the configured dev/prod database. Without `RUN_DATABASE_TESTS=true`, it explicitly skips; ordinary tests then do not establish database correctness. `test:integration` discovers it too and uses the same opt-in.

Do not grant database-creation privileges to the application user just to run tests. Use a separate disposable MariaDB server and test account. The account needs access to its isolated `stocksbuddha_dev` base database and full privileges on the disposable `sb_test_*` namespace, including CREATE/DROP DATABASE, ALTER, TRIGGER and audit writes. Set `DB_HOST`, `DB_PORT`, `DB_USER` and `DB_PASSWORD` in the test process environment to override `backend/.env`; do not replace your local application credentials. The suite covers chooser lists larger than a five-connection pool, concurrent users, tenant/membership filtering and equality with detail projections, in addition to migrations, authentication and transaction invariants.

## Authentication provenance migration and legacy users

Migration `AddAuthTenantContext1793491200009` adds nullable signup/login RA FKs to `auth_users` / `auth_sessions`, plus two audit triggers. That migration does not add a table; the authentication-limit and organisation-invitation migrations brought that foundation to twelve before the document extension. It preserves existing rows with unknown (`NULL`) provenance; no users are automatically assigned to RAs. The migration operator needs ALTER/TRIGGER privileges, and the trigger definer must remain valid with audit insert access. See [implementation and partial-DDL recovery](../docs/DATABASE_IMPLEMENTATION.md).

After `npm run db:migrate -- --target dev`, use [backfill-auth-tenant-context.sql](queries/backfill-auth-tenant-context.sql) in a single database-client connection. Substitute known emails/slugs in the signup block; run it separately for Stocks Buddha and Beta. Session backfill is optional and requires a known original session RA, not just the user's signup origin. The transaction blocks preserve existing non-NULL values and audit corrections without granting memberships or marking emails verified. See [authentication provenance](../docs/AUTHENTICATION.md#signup-and-login-ra-provenance).

## Shared authentication limits

Migration `CreateAuthRateLimits1793491200010` adds one table for expiring, hashed authentication counters. All application instances must share this table. Its row-locked consume operation prevents concurrent requests from bypassing limits. Runtime privileges include SELECT/INSERT/UPDATE/DELETE on this table; no runtime CREATE/DROP privileges are needed. Configure trusted proxies and verification/recovery delivery using [the authentication guide](../docs/AUTHENTICATION.md). Existing migrations stay immutable.

## Organisation invitations

Migration `CreateOrganisationInvitations1793491200011` adds the tenant-bound, hashed-token invitation table (12 application migrations, 12 total tables including migration metadata). Run the normal explicit migration command before starting this version. No real account or role is automatically created/promoted. See [organisation setup, verified owner bootstrap and invitation lifecycle](../docs/ORGANISATION_ACCESS.md). The new organisation workflow creates a draft without a website, then activates it only after its first RA Admin accepts.

Migration `AddInvitationNames1793491200012` adds nullable `organisation_invitations.full_name` for personalised email greetings (13 application migrations; still 12 total tables including migration metadata). New invitations require a full name; historical rows keep NULL and request a name when resent. Run the normal explicit migration command before starting this version. Resend/revoke actions use current tenant-admin checks and audit events; revocation does not delete the shared identity or memberships in other organisations.

The current access policy is **one email, one role per RA**. Existing `auth_users.email` and `(tenant_id,user_id)` uniqueness remain unchanged; no migration or automatic role conversion is required. Subscriber and staff roles are mutually exclusive in one RA, including invitation resend/acceptance and enrolment/API paths. Application data keeps its current role. See [policy, concurrency and test coverage](../docs/ROLE_EXCLUSIVITY.md).

## Private documents

Migration `CreateDocuments1794009600000` adds retained document metadata, tenant/customer foreign keys and private Drive object references (14 application migrations; 13 total tables including migration metadata). File bytes stay in Google Drive. Apply the normal explicit migration before startup; configure backend OAuth separately. See [Drive activation, document roles and recovery](../docs/GOOGLE_DRIVE.md).

## Investor onboarding extension

Migration `1794096000000` adds seven tenant-owned onboarding/billing/history/delivery tables and the collected signup phone field. Apply it explicitly before restarting the application. Production also requires a separate retained encryption key. See [investor onboarding](../docs/INVESTOR_ONBOARDING.md) and [production review](../docs/SEBI_RA_REVIEW.md).

## External document transfer leases

Apply migration `1794182400000-DocumentStorageLeases` before this application release. `document_storage_leases` stores one recoverable lease per tenant UUID or the platform key. It is operational coordination, not document authorization. Provider requests run outside database transactions; authorization and fenced publication use short transactions. A fifteen-minute lease expires after a crashed holder, and token-checked cleanup cannot remove a newer holder's lease. Deploy only after stopping older app instances that still serialize Drive calls on tenant rows. See [Drive concurrency and recovery](../docs/GOOGLE_DRIVE.md).

## Mobile verification migration

Migration `1794268800000-MobileVerification` adds six tables: `sms_settings`, `sms_mutex`, `sms_challenges`, `sms_events`, `sms_security_notices` and `account_recovery_mobiles`. Existing timestamps remain unchanged; there is no automatic legacy verification. Stop old writers, apply the migration explicitly and check status before starting the new release. Preserve the existing data key. See [the SMS operating runbook](../docs/MOBILE_VERIFICATION.md).

## Password-recovery limits migration

Apply additive migration `1794355200000-RecoveryEmailLimits` explicitly before starting this release. It adds `recovery_email_sends` without modifying the earlier SMS migration, and requires runtime SELECT/INSERT access to that table. Password-reset emails share a five-send rolling 24-hour cap and 60-second cooldown across RA, platform and direct auth routes. SMS password recovery has a separate three-send rolling-day cap across RAs; existing broader mobile/IP/tenant caps still apply. See [the recovery policy](../docs/MOBILE_VERIFICATION.md#password-recovery-budgets).

## Private integrations and template libraries

Apply `1794441600000-TenantIntegrations` (migration 19) explicitly before startup. It creates `tenant_integrations` for separately versioned encrypted Telegram/payment credentials and expands `sms_settings.config_cipher` to `MEDIUMTEXT` for up to 100 SMS templates. Current totals are 29 tables including metadata. Preserve the existing encryption key; no public website revision contains these credentials. See [configuration and merchant editing restrictions](../docs/WEBSITE_EDITOR.md#private-service-settings).

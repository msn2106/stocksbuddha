# Database foundation implementation and operations

1 November 2026 · Implements the reviewed [database design](DATABASE_DESIGN.md), with the scope and decisions below.

## Implemented

- Local Docker Compose for MariaDB and the DbGate Community browser client; the application continues directly in Node. DbGate is bound to loopback, preconfigured only for the local dev database and excluded from hosted deployment.
- Ten constrained InnoDB tables, ten TypeORM application migrations and verified metadata bootstrap.
- Separate `stocksbuddha_dev` / `stocksbuddha_prod` targets, including optional Hostinger account prefix. No persistent third environment. SQL timestamp defaults explicitly use UTC expressions; the driver timezone setting controls value conversion and is not assumed to set server timezone.
- Source-checksum manifest, applied ledger, attempt outcomes, one release lock, drift rejection and refusal to retry failed/unfinished migrations automatically.
- Repeatable dev preview seeds preserving UUIDs, localized websites, owner edits and explicit unpublication.
- Database adapters behind existing repositories. Public reads follow the publication pointer and frozen profile, verify snapshot hash/version and never fall back to highest historical revision.
- Internal transactional draft create/save/rebase/publish/unpublish, verified subscriber enrollment, reviewed role/revocation/reactivation, last-owner protection and atomic tenant/first-owner provisioning. Operations read stored sessions rather than trust browser user IDs. Membership changes prelock actor and target identity rows in sorted order before the tenant, avoiding InnoDB foreign-key lock cycles with concurrent publication.
- Partial-draft and complete-publication validation; committed retry receipts share the business audit transaction. Draft/publication methods remain internal; guarded membership mutations are mounted through the auth boundary.
- Pinned Better Auth 1.7.12 core mapping, disabled cookie session cache, UUID identities and a separately owned pool. Real-MariaDB tests exercise signup, normalized email uniqueness, password login and revoked-token denial. Tenant signup/login/workspace UI is mounted; verification/recovery delivery and administrator MFA remain later work.
- Signup/login provenance: nullable `auth_users.signup_tenant_id` and `auth_sessions.login_tenant_id`, server-owned before-create hooks with per-request context, and atomic signup/login audit triggers. Provenance never grants membership. See [auth context and legacy backfill](AUTHENTICATION.md#signup-and-login-ra-provenance).
- `/api/health` remains liveness; `/api/ready` checks selected persistence. Startup rejects missing/incomplete migration history. Owned DB connections close through application shutdown hooks.

## Implementation decisions

| Concern     | Decision                                                                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email       | Framework-normalized lowercase email with binary `utf8mb4_bin` uniqueness. Accent-distinct values are not conflated. Broader Unicode email/domain policy still needs product review before login rollout.                     |
| Auth schema | Four core tables mapped and integration-tested. Username and administrator OTP/MFA plugins must generate/review their schema before activation. No administrators have been imported or had protection removed.               |
| Lock        | DDL and the advisory lock use the same QueryRunner connection, avoiding a separate live DDL session after lock-connection loss. Attempt writes use another autocommit connection.                                             |
| Pools       | TypeORM 5; auth 5 when instantiated; migration pool 3. Both runtime pools fail fast at capacity rather than queuing. Ordinary TypeORM queries have a 5s client timeout; migration DDL has none. Driver connect timeout is 3s. |
| Activation  | MariaDB startup mounts core auth and protected workspace/membership routes. OTP/verification/recovery transport, Google callbacks and editor routes remain deferred; see [authentication](AUTHENTICATION.md).                 |
| Overrides   | Empty capability overrides only; nonempty stored overrides fail closed. DOB/city are deferred.                                                                                                                                |
| Snapshots   | Version 1 readers/validators implemented; unknown versions fail closed. Future adapters must precede new writers; reads never rewrite originals/checksums.                                                                    |
| Seeds       | Dev previews can be ownerless with no protected mutation routes. Real managed tenants require a verified effective first owner in their provisioning transaction.                                                             |
| Recovery    | No automatic destructive down/fake-success command. Forward repair or isolated restore requires observed schema and reconciliation evidence.                                                                                  |

Budget all old/new application processes during deployment, future workers and backup/admin reserve. Actual Hostinger limits/TLS/version have not been verified. Auth query deadlines/cancellation are not configured; a universal 5s auth query deadline is not claimed.

## Setup and release

Follow [database setup](../database/README.md). Runtime lives in `backend/src/database/` and `backend/src/auth/`; schema, runner, manifest and seeds live under `database/`. `npm run build` builds frontend, backend and standalone migration artifacts. Startup never executes migrations.

The provenance migration needs ALTER and TRIGGER privileges. Triggers use the migration connection’s definer; retain a valid definer account with the grants required to read inserted fields and insert audit rows. Include triggers/definers in backup and restore verification. See [MariaDB CREATE TRIGGER](https://mariadb.com/docs/server/server-usage/triggers-events/triggers/create-trigger).

The application needs SELECT access to migration metadata to reject missing/unfinished history. Deployment verifies source checksums under the lock before starting new code. The manifest also binds the reviewed metadata bootstrap checksum. Build with a release-specific `RELEASE_ID`; keep `database/dist/cli.js`, `database/dist/manifest.json` and the matching application artifact together. Manifests hash source, not compiler-dependent output. CLI failures suppress raw driver errors and credentials; inspect safe attempt fields through an authorized client.

## Failure and reconciliation

1. Stop the failed release. Do not enable synchronization or repeatedly rerun migrations.
2. Inspect attempt ID, migration name/checksum, release, status, timestamps and sanitized errors; compare the applied ledger and actual schema with the exact release artifact.
3. Acquire `GET_LOCK('sb:<database>:migrate', 30)` on the operator connection before repair or metadata changes, substituting the actual database name. Keep that session alive; no release may run concurrently.
4. Determine completed DDL. A missing ledger row does not prove rollback. Back up affected data and choose a reviewed repair/restore; the first nine migrations each perform one table/constraint operation. Migration `1793491200009` performs two ALTERs and creates two triggers; inspect both columns/FKs and both trigger definitions before reconciling a partial attempt.
5. If the ledger and complete resulting schema already match, set the unfinished attempt to `reconciled`, set its finish time and record bounded `resolution_json` with keys `schemaVersion` (1), `operator`, `priorStatus`, `decision`, `time` and `evidence`. The metadata table requires those keys for a reconciled state. Preserve original source checksum/release.
6. If the ledger is absent and the exact pre-migration state has been restored, record the reconciliation with an explicit retry decision; normal execution creates a fresh attempt. If complete DDL exists without a ledger row, reconcile metadata through TypeORM's public API only after separate review; never infer success from an exception message.
7. Release the lock, run normal status/manifest checks and retry the approved release. Retain deployment diagnostics for failures before bootstrap or while metadata storage was unavailable.

There is no unattended repair command because the runner cannot infer safe recovery from partial DDL. Receipt-bearing audit events are not automatically purged; define retry expiry/tombstones before retention deletion.

## Validation and deployment gates

Real-DB tests use disposable `sb_test_*` databases on local MariaDB 11.4.8. They cover fresh/repeated/concurrent runners, drift/failure blocking, seed safety, tenant constraints, frozen projections, unknown/corrupt snapshots, incomplete/stale drafts, retries, revocation, last owner, atomic provisioning rollback and pinned core authentication. Unit tests cover controlled dependency failures, domain denials, projections and lifecycle. Browser tests use explicit fixture-preview configuration.

These checks are not Hostinger deployment, load or restore evidence. Before production: inspect actual engine/grants/connection budget/TLS; test against its version; provision separate dev/prod databases and credentials; rehearse backups with required key/document recovery; finish verification/recovery delivery, chosen auth plugins, administrator MFA and editor API/UI; approve privacy/retention policies. Payments, KYC evidence, files, providers and durable delivery remain deferred modules as reviewed.

Local validation also exercised the compiled migration/seed artifact and production server against a fresh disposable database: readiness, Hindi API projection, SSR, frozen identity after an administrative edit, explicit unpublication and graceful pool shutdown passed. All 14 existing browser acceptance tests passed. The full `verify` command remains blocked by the 14 pre-existing moderate tooling audit findings documented in the root README; the dependency age policy was not weakened.

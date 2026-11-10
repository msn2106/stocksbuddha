# Database foundation design for review

Status: **Reviewed specification; foundation implemented locally** · 1 November 2026 · Revision 2 baseline

This document is the reviewed ten-table specification. The local implementation, resolved schema choices, validation scope and remaining deployment gates are tracked in [DATABASE_IMPLEMENTATION.md](DATABASE_IMPLEMENTATION.md). Executable migrations live under `database/migrations/`; Hostinger deployment has not occurred. Historical proposal wording below describes the design baseline; the implementation runbook identifies what now exists.

## 1. Decisions and scope

| Item                    | Proposed decision                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| Persistent environments | `stocksbuddha_dev` and `stocksbuddha_prod` only; Hostinger may prepend its account prefix                    |
| Engine                  | MariaDB; confirm the actual Hostinger plan, version, privileges and limits before writing migrations         |
| Application persistence | TypeORM with `mysql2`, behind tenant-aware repository interfaces                                             |
| Authentication          | Better Auth candidate using its supported MySQL connection; generated schema must be checked against MariaDB |
| Migration ownership     | One new TypeORM migration history; legacy Liquibase remains with the legacy application                      |
| Runtime                 | Frontend SSR and backend continue in the existing Node application; no application containers required       |
| Local database          | Docker Compose with a pinned MariaDB version matching production as closely as possible                      |
| Database tests          | Disposable Docker database; no third persistent/hosted environment                                           |
| Tenancy                 | Shared tables, immutable tenant IDs and server-verified membership                                           |
| Initial table count     | Eight application/authentication tables and two migration tables                                             |

Ten tables cover the foundation, not the complete future commerce/KYC/Telegram product. Additional independently repeating business records will need tables when implemented. Preserving their future foreign-key boundaries is part of this design; hiding those records in JSON to maintain an arbitrary count is not.

Hostinger's Web/Cloud documentation identifies MariaDB behind its MySQL-labelled service. A VPS permits a different installation. The account and server version have not been inspected. See [Hostinger engine documentation](https://www.hostinger.com/support/1583226-which-database-management-system-is-used-at-hostinger/).

## 2. Schema conventions

| Convention             | Specification                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Storage                | InnoDB; strict SQL mode; verify CHECK and foreign-key enforcement on the selected server                                 |
| Default character set  | `utf8mb4`                                                                                                                |
| Default collation      | `utf8mb4_unicode_ci`; identifiers requiring exact comparison override it below                                           |
| `UUID` shorthand below | `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin`; application-generated lowercase UUID, no database default              |
| `ASCII(n)` shorthand   | `VARCHAR(n) CHARACTER SET ascii COLLATE ascii_bin`                                                                       |
| `EXACT(n)` shorthand   | `VARCHAR(n) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`                                                                   |
| Time                   | `DATETIME(3)` interpreted as UTC; connection timezone UTC; API emits ISO 8601                                            |
| Booleans               | `TINYINT UNSIGNED` with `CHECK (column IN (0,1))`                                                                        |
| Mutable row timestamps | `created_at` and `updated_at`, both NOT NULL with `DEFAULT (UTC_TIMESTAMP(3))`; writers explicitly maintain `updated_at` |
| Row concurrency        | Application-owned mutable rows use an unsigned `lock_version`, starting at 1; updates compare and increment it           |
| Missing/default values | `—` means no SQL default; caller must supply a NOT NULL value. Nullable fields default to NULL unless stated             |
| Status/role values     | Bounded ASCII strings and named CHECK constraints, rather than native ENUM; values listed per table                      |
| IDs and ownership      | IDs, `tenant_id` and membership `user_id` are immutable after creation                                                   |
| Deletion               | Lifecycle/revocation first; hard deletion is an explicit retention workflow, not a generic cascade                       |
| Public response        | Explicit projection; never serialize an ORM entity wholesale                                                             |

`VARCHAR(n)` specifies maximum characters, not fixed bytes. `utf8mb4` can require four bytes per character; ASCII uses one. UUID text costs 36 bytes before row/index overhead. This readable representation preserves existing UUID contracts; binary UUID storage is a possible later measured optimization, not required now.

MariaDB `JSON` is an alias of LONGTEXT rather than MySQL binary JSON. For every JSON field below, require valid object JSON, an application schema version, and an explicit serialized UTF-8 byte limit. Database checks enforce validity/object/byte limits; application validation enforces the complete shape. There are no arbitrary JSON relationships or JSON indexes in the foundation. See [MariaDB JSON documentation](https://mariadb.com/docs/server/reference/data-types/string-data-types/json).

## 3. Table inventory and ownership

| Table                | Owner/scope                          | Purpose                                                                 |
| -------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `tenants`            | Platform registry; one row per RA    | Address, lifecycle, organization profile, settings, publication pointer |
| `auth_users`         | Global authentication identity       | Login identity and separately controlled platform role                  |
| `auth_accounts`      | Authentication framework             | Credential/OAuth accounts                                               |
| `auth_sessions`      | Authentication framework             | Global login sessions; never a mutable current tenant                   |
| `auth_verifications` | Authentication framework             | Temporary authentication verification records                           |
| `tenant_memberships` | Tenant-owned                         | Membership role/status, local profile and onboarding summary            |
| `website_revisions`  | Tenant-owned                         | Full versioned website snapshots                                        |
| `audit_events`       | Tenant or explicitly platform-scoped | Append-only business audit                                              |
| `migrations`         | Deployment infrastructure            | Successfully applied migration identities                               |
| `migration_attempts` | Deployment infrastructure            | Attempt history, checksums and recovery outcomes                        |

## 4. `tenants`

| Column                | SQL type         | Null? | Default          | Purpose/validation                                                                         |
| --------------------- | ---------------- | ----- | ---------------- | ------------------------------------------------------------------------------------------ |
| `id`                  | UUID             | No    | —                | Primary key; retain existing seed IDs                                                      |
| `slug`                | ASCII(48)        | No    | —                | Unique; lowercase pattern `^[a-z][a-z0-9-]{1,47}$`; reserved-slug rejection in application |
| `status`              | ASCII(16)        | No    | `'draft'`        | `draft`, `active`, `suspended`, `closed`                                                   |
| `is_synthetic`        | TINYINT UNSIGNED | No    | `0`              | Demo marker; never an authorization bypass                                                 |
| `display_name`        | VARCHAR(80)      | No    | —                | Public organization name; trimmed, minimum 2 characters                                    |
| `legal_name`          | VARCHAR(100)     | No    | —                | Legal identity; trimmed, minimum 2 characters                                              |
| `registration_number` | ASCII(40)        | Yes   | NULL             | Supplied registration identifier; no automatic compliance claim                            |
| `monogram`            | VARCHAR(3)       | No    | —                | Public mark; 1–3 characters, matching existing contract                                    |
| `contact_email`       | VARCHAR(254)     | Yes   | NULL             | Public contact, syntactically validated                                                    |
| `contact_phone`       | ASCII(20)        | Yes   | NULL             | Public phone; canonical E.164 when a phone number is supplied                              |
| `settings_json`       | JSON             | No    | —                | Versioned non-secret configuration object, at most 16,384 bytes                            |
| `published_revision`  | INT UNSIGNED     | Yes   | NULL             | Current published website revision number                                                  |
| `lock_version`        | INT UNSIGNED     | No    | `1`              | Optimistic concurrency, positive                                                           |
| `created_at`          | DATETIME(3)      | No    | UTC_TIMESTAMP(3) | Creation                                                                                   |
| `updated_at`          | DATETIME(3)      | No    | UTC_TIMESTAMP(3) | Last update                                                                                |

Keys: primary `(id)`; unique `uq_tenants_slug (slug)`; index `ix_tenants_publication (id, published_revision)` for the composite publication FK. No standalone status index until an actual query warrants it.

`settings_json` starts as `{"schemaVersion":1}`. It may later contain bounded non-secret preferences. It must not contain credentials, provider connection IDs masquerading as foreign keys, KYC evidence or the public website content. Only allowlisted settings reach public responses.

Add `fk_tenants_publication (id, published_revision) REFERENCES website_revisions(tenant_id, revision) ON DELETE RESTRICT ON UPDATE RESTRICT` after both tables exist. NULL means no public website. No slug aliases or custom domains are implied by this schema. A rename needs explicit redirect design before it is exposed.

Revision 2 additions to this table:

| Column                | SQL type     | Null? | Default | Purpose/validation                                                                                     |
| --------------------- | ------------ | ----- | ------- | ------------------------------------------------------------------------------------------------------ |
| `publication_version` | INT UNSIGNED | No    | `0`     | Increments on every publish/unpublish; detects intervening changes even if the pointer returns to NULL |

The profile columns are administrative working values, not live public website values. A publication snapshots the proposed public name/legal name/registration/monogram/contact details into `snapshot_json.publicProfile`. Public rendering and metadata use that frozen profile. Editing `tenants` never silently changes the live page; the editor must copy updated details into a draft and publish it. Slug, tenant lifecycle and publication pointer remain operational controls that take effect immediately. Suspending/closing a tenant hides the page regardless of its frozen profile. Restoring a revision restores its public-profile snapshot, not the administrative working values; require explicit review when restoring outdated legal details. Future agreements/invoices capture their own identity snapshots at issuance, never a mutable tenant join.

For a real managed tenant, activation requires an active effective owner and a valid provisioning transaction (section 10.3). Existing read-only synthetic/demo fixtures may be imported without authenticated owners as an explicitly recorded public-preview mode, with all protected writes disabled; the mode is deployment-controlled and never inferred solely from `is_synthetic`.

## 5. Authentication contract and tables

These four tables describe proposed storage for the documented core authentication model. Pin Better Auth and its exact plugins, configure table/field mappings and UUID generation, generate the required SQL, and reconcile it with this specification before migration approval. Do not silently truncate generated fields to fit this plan.

All authentication IDs use the UUID convention, including accounts, sessions and verifications. Map framework camelCase fields to snake_case database columns. Application additions such as `platform_role` must be server-owned (`input: false`) and omitted from ordinary public auth responses. Passwords and tokens are never part of public contracts.

The four-table count is conditional on the selected auth features. The PRDs also mention username login and retained administrator OTP protection: these require an explicit plugin/schema proof. If a chosen feature requires extra columns or tables, update this document rather than omit security behavior to keep the count at ten. The pinned core authentication mapping and email/password endpoints are installed and integration-tested. MariaDB mode mounts tenant account/workspace routes and membership APIs; username and administrator OTP plugins remain deferred (see [authentication status](AUTHENTICATION.md)).

### 5.1 `auth_users`

| Column             | SQL type         | Null? | Default          | Purpose                                                        |
| ------------------ | ---------------- | ----- | ---------------- | -------------------------------------------------------------- |
| `id`               | UUID             | No    | —                | Primary identity                                               |
| `name`             | VARCHAR(160)     | No    | —                | Global display name; not the RA-local profile                  |
| `email`            | VARCHAR(254)     | No    | —                | Normalized global login email, unique                          |
| `email_verified`   | TINYINT UNSIGNED | No    | `0`              | Framework-owned verification state                             |
| `image`            | VARCHAR(2048)    | Yes   | NULL             | Validated avatar URL; not trusted HTML                         |
| `signup_tenant_id` | UUID             | Yes   | NULL             | First signup RA provenance only; no membership or access grant |
| `platform_role`    | ASCII(16)        | Yes   | NULL             | NULL or `owner`; no automatic tenant membership                |
| `created_at`       | DATETIME(3)      | No    | UTC_TIMESTAMP(3) | Creation                                                       |
| `updated_at`       | DATETIME(3)      | No    | UTC_TIMESTAMP(3) | Update                                                         |

Keys: primary `(id)`; unique `uq_auth_users_email (email)`. Email normalization must agree with the pinned authentication framework. Recommended review decision: ASCII/punycode domain and case-folded login email, with a case-insensitive unique key. Confirm whether the default accent-insensitive collation is acceptable; otherwise use a reviewed case-insensitive, accent-sensitive available collation or a separate normalized key. This is a blocking auth-schema decision, not permission to conflate distinct addresses.

`signup_tenant_id -> tenants.id` uses DELETE/UPDATE RESTRICT and index `ix_signup_tenant`. It is set only at account creation from server-resolved tenant context, remains nullable for legacy/global accounts, and is not returned by ordinary auth APIs. It does not change global email uniqueness. Known legacy origins can be backfilled using the [reviewed SQL](../database/queries/backfill-auth-tenant-context.sql), with a separate correction audit event. Never infer first signup from current memberships.

Platform-role changes require a dedicated authorized operation, audit and fresh server-side authorization reads. Do not rely on a stale role embedded in a long-lived session.

### 5.2 `auth_accounts`

| Column                     | SQL type     | Null? | Default          | Purpose                                                   |
| -------------------------- | ------------ | ----- | ---------------- | --------------------------------------------------------- |
| `id`                       | UUID         | No    | —                | Local account row                                         |
| `user_id`                  | UUID         | No    | —                | Global identity FK                                        |
| `provider_id`              | ASCII(64)    | No    | —                | Configured provider, e.g. credential/Google               |
| `account_id`               | EXACT(191)   | No    | —                | External provider subject, or identity ID for credentials |
| `password`                 | VARCHAR(512) | Yes   | NULL             | Framework password hash; never plaintext                  |
| `access_token`             | TEXT         | Yes   | NULL             | Sensitive OAuth credential, if retained                   |
| `refresh_token`            | TEXT         | Yes   | NULL             | Sensitive OAuth credential, if retained                   |
| `id_token`                 | TEXT         | Yes   | NULL             | Sensitive provider token, if retained                     |
| `access_token_expires_at`  | DATETIME(3)  | Yes   | NULL             | Provider token expiry                                     |
| `refresh_token_expires_at` | DATETIME(3)  | Yes   | NULL             | Provider token expiry                                     |
| `scope`                    | TEXT         | Yes   | NULL             | Provider scopes                                           |
| `created_at`               | DATETIME(3)  | No    | UTC_TIMESTAMP(3) | Creation                                                  |
| `updated_at`               | DATETIME(3)  | No    | UTC_TIMESTAMP(3) | Update                                                    |

Keys: primary `(id)`; unique `uq_auth_accounts_provider (provider_id, account_id)`; index `ix_auth_accounts_user (user_id)`; FK `user_id -> auth_users.id`, DELETE/UPDATE RESTRICT.

TEXT permits at most 65,535 bytes per field; reject oversize values without truncation and prove provider token lengths during integration. Do not index token bodies. Configure supported framework encryption for retained OAuth tokens and keep the encryption key outside the database/backups; validate round trips. Do not replace tokens with hashes unless the adapter supports that representation. Retain only provider credentials actually needed by the chosen flow.

### 5.3 `auth_sessions`

| Column            | SQL type    | Null? | Default          | Purpose                                                       |
| ----------------- | ----------- | ----- | ---------------- | ------------------------------------------------------------- |
| `id`              | UUID        | No    | —                | Session identity                                              |
| `user_id`         | UUID        | No    | —                | Identity FK                                                   |
| `token`           | ASCII(255)  | No    | —                | Framework session token, unique and sensitive                 |
| `expires_at`      | DATETIME(3) | No    | —                | Expiry                                                        |
| `ip_address`      | ASCII(45)   | Yes   | NULL             | IPv4/IPv6 text from trusted request boundary                  |
| `login_tenant_id` | UUID        | Yes   | NULL             | Session creation RA provenance; never selected/current tenant |
| `user_agent`      | TEXT        | Yes   | NULL             | Optional device metadata, application cap 4,096 UTF-8 bytes   |
| `created_at`      | DATETIME(3) | No    | UTC_TIMESTAMP(3) | Creation                                                      |
| `updated_at`      | DATETIME(3) | No    | UTC_TIMESTAMP(3) | Refresh/update                                                |

Keys: primary `(id)`; unique `uq_auth_sessions_token (token)`; indexes `(user_id)` and `(expires_at)`; FK `user_id -> auth_users.id`, DELETE/UPDATE RESTRICT. Database check: `expires_at > created_at`; prove compatibility with generated framework timestamps.

There is no current-tenant field: two browser tabs can use different RAs. Nullable `login_tenant_id -> tenants.id` (DELETE/UPDATE RESTRICT; index `ix_login_tenant(login_tenant_id,created_at)`) records only the origin of this session. It never authorizes another request or changes when a tab navigates to another RA. Every protected request resolves tenant and membership independently. Global session revocation deletes the session under the framework contract; tenant revocation changes membership. Sensitive token storage must follow the actual adapter; this proposal does not claim the database stores only token hashes.

Disable Better Auth cookie session caching for protected operations and do not use cached session claims as proof of current access. Validate against authoritative session storage on each protected request; inside the business transaction perform the final authoritative session-expiry/existence and role check immediately before the guarded write. A global logout racing after that final check may allow that already-authorized in-flight operation to finish; subsequent authorization checks deny it. Stronger cancellation of in-flight work would require coordinated auth-revocation locking and is not claimed here. Tenant membership revocation has the serialized semantics in section 10.1. See [Better Auth session caching and revocation](https://better-auth.com/docs/concepts/session-management).

### 5.4 `auth_verifications`

| Column       | SQL type    | Null? | Default          | Purpose                                            |
| ------------ | ----------- | ----- | ---------------- | -------------------------------------------------- |
| `id`         | UUID        | No    | —                | Verification row                                   |
| `identifier` | EXACT(255)  | No    | —                | Framework lookup identifier                        |
| `value`      | TEXT        | No    | —                | Framework-specific verification payload; sensitive |
| `expires_at` | DATETIME(3) | No    | —                | Expiry                                             |
| `created_at` | DATETIME(3) | No    | UTC_TIMESTAMP(3) | Creation                                           |
| `updated_at` | DATETIME(3) | No    | UTC_TIMESTAMP(3) | Update                                             |

Keys: primary `(id)`; indexes `(identifier)` and `(expires_at)`. No uniqueness on identifier unless generated auth/plugin requirements demand it. No artificial user FK: a verification can precede account creation. TEXT maximum 65,535 bytes; exact payload/hash/consumption behavior belongs to the selected framework/plugin, not a homegrown OTP implementation. Never use this table as a business invitation, consent or KYC ledger.

Auth schema reference: [Better Auth core database model and customization](https://better-auth.com/docs/concepts/database). The SQL lengths, indexes and application-owned fields above are proposed project choices, not assertions about generated defaults.

## 6. `tenant_memberships`

**One email, one role per RA.** The globally unique identity email and unique `(tenant_id, user_id)` membership key represent one relationship with one current role. No parallel subscriber relationship is created for staff. Invitations and enrolment reject incompatible roles; the reviewed membership API forbids subscriber/staff conversion. Different RAs remain independent. See [the implemented policy](ROLE_EXCLUSIVITY.md).

| Column               | SQL type     | Null? | Default          | Purpose/validation                                                                        |
| -------------------- | ------------ | ----- | ---------------- | ----------------------------------------------------------------------------------------- |
| `id`                 | UUID         | No    | —                | Stable RA relationship ID for future business FKs                                         |
| `tenant_id`          | UUID         | No    | —                | Owner tenant                                                                              |
| `user_id`            | UUID         | No    | —                | Global identity                                                                           |
| `role`               | ASCII(16)    | No    | `'subscriber'`   | `owner`, `analyst`, `support`, `subscriber`                                               |
| `status`             | ASCII(16)    | No    | `'active'`       | `active`, `revoked`; no access while revoked                                              |
| `full_name`          | VARCHAR(160) | Yes   | NULL             | RA-local supplied name                                                                    |
| `mobile`             | ASCII(20)    | Yes   | NULL             | Canonical E.164; not a globally unique identity                                           |
| `mobile_verified_at` | DATETIME(3)  | Yes   | NULL             | Verified in the applicable membership flow                                                |
| `profile_json`       | JSON         | No    | —                | Versioned allowlisted non-secret profile extensions; max 8,192 bytes                      |
| `capabilities_json`  | JSON         | No    | —                | Versioned fixed capability overrides; max 4,096 bytes                                     |
| `onboarding_stage`   | ASCII(24)    | No    | `'not_started'`  | `not_started`, `profile_pending`, `verification_pending`, `agreement_pending`, `complete` |
| `revoked_at`         | DATETIME(3)  | Yes   | NULL             | Required exactly when status is revoked                                                   |
| `lock_version`       | INT UNSIGNED | No    | `1`              | Positive concurrency version                                                              |
| `created_at`         | DATETIME(3)  | No    | UTC_TIMESTAMP(3) | Join time                                                                                 |
| `updated_at`         | DATETIME(3)  | No    | UTC_TIMESTAMP(3) | Update                                                                                    |

Keys: primary `(id)`; unique `(tenant_id, user_id)`; unique `(tenant_id, id)` for future composite FKs; indexes `(user_id, status)` and `(tenant_id, status, role, id)`. FKs `tenant_id -> tenants.id` and `user_id -> auth_users.id`, DELETE/UPDATE RESTRICT. No unique key on phone or name. Defer DOB/city until a real profile workflow needs them; proposed future types are nullable DATE and VARCHAR(100), respectively. Do not hide deferred fields in JSON.

Database checks cover role/status/stage sets, positive version, and revoked-status/timestamp consistency. Application rejects overlong/invalid profile values; an omitted profile value is not an empty string. Clearing/changing mobile also clears its verification timestamp transactionally.

`profile_json` initially contains only `schemaVersion: 1`. Explicitly exclude PAN, documents, consent evidence, credentials and KYC history. Store those through future purpose-specific records with their own access/retention rules.

`capabilities_json` shape: `{"schemaVersion":1,"allow":[],"deny":[]}`. Values come only from the application's known capability set; duplicates, overlaps and unknown values are rejected. Effective access is role baseline plus allowed overrides minus denied overrides, subject to tenant/membership status and operation-specific policy. Subscriber overrides cannot grant staff capabilities; platform privileges never appear here. This is a proposed extension: today's policy only supports fixed role baselines. Add the extension with tests before persisting nonempty overrides.

The onboarding stage is a summary, not evidence or paid entitlement. Initially it must not grant protected research. Future verified attempts/agreements drive transitions. Staff membership and purchased research access remain independent: an analyst/owner can hold subscriptions through the same membership without changing staff role, and staff status alone grants no paid research entitlement.

Persist only empty capability overrides in the foundation. When overrides are enabled, an effective owner must be active with owner role and effective `staff:manage`; every role/status/override change must preserve at least one such owner. Prevent the last effective owner from denying their own management capability. Reactivation is an explicit authorized action, never a signup side effect: preserve the prior role only after explicit review, clear overrides by default, reset revocation timestamp and audit before/after values. All these writes follow section 10.1.

## 7. `website_revisions`

| Column                     | SQL type     | Null? | Default          | Purpose/validation                                                      |
| -------------------------- | ------------ | ----- | ---------------- | ----------------------------------------------------------------------- |
| `id`                       | UUID         | No    | —                | Stable revision row identity                                            |
| `tenant_id`                | UUID         | No    | —                | Immutable owner                                                         |
| `revision`                 | INT UNSIGNED | No    | —                | Positive monotonically allocated number within tenant                   |
| `base_revision`            | INT UNSIGNED | Yes   | NULL             | Publication pointer captured when draft was created/rebased             |
| `base_publication_version` | INT UNSIGNED | No    | —                | Tenant publication generation captured with base pointer                |
| `status`                   | ASCII(16)    | No    | `'draft'`        | `draft`, `published`                                                    |
| `snapshot_json`            | JSON         | No    | —                | Versioned branding/layout/languages/content snapshot, max 524,288 bytes |
| `snapshot_sha256`          | ASCII(64)    | No    | —                | Lowercase SHA-256 of canonical validated snapshot bytes                 |
| `created_by`               | UUID         | Yes   | NULL             | Membership ID; NULL for controlled seeds/system work                    |
| `published_by`             | UUID         | Yes   | NULL             | Publishing membership; NULL for controlled system publication           |
| `published_at`             | DATETIME(3)  | Yes   | NULL             | Required exactly when status is published                               |
| `lock_version`             | INT UNSIGNED | No    | `1`              | Draft concurrency version                                               |
| `created_at`               | DATETIME(3)  | No    | UTC_TIMESTAMP(3) | Creation                                                                |
| `updated_at`               | DATETIME(3)  | No    | UTC_TIMESTAMP(3) | Last draft change/publication                                           |

Keys: primary `(id)`; unique `(tenant_id, revision)`; unique `(tenant_id, id)`; index `(tenant_id, status, revision)`; explicit indexes `(tenant_id, created_by)`, `(tenant_id, published_by)` and `(tenant_id, base_revision)` for FKs. FK `tenant_id -> tenants.id`; composite FKs `(tenant_id, created_by)` and `(tenant_id, published_by) -> tenant_memberships(tenant_id, id)` and `(tenant_id, base_revision) -> website_revisions(tenant_id, revision)`; all DELETE/UPDATE RESTRICT. Reject self-reference and require the base, when present, to be a published snapshot in the service. Nullable actor IDs permit controlled seed/system records, never arbitrary client impersonation.

Checks: positive revision/lock version; nonnegative base publication generation; status set; status/publication-time consistency; SHA-256 format; object JSON and byte limit. `snapshot_json` shape is `{"schemaVersion":1,"publicProfile":...,"branding":...,"languages":...,"layout":...,"content":...}`. Public-profile field types/limits match the tenant profile/contact columns, but are frozen independently. Do not duplicate tenant ID, revision, status or timestamps in the stored JSON; reconstruct the contract from authoritative columns. The shared `websiteSnapshotSchema` and database validators implement the partial draft and frozen-profile behavior.

Draft-save validation permits incomplete content: declared languages are English/Hindi only, default must be declared/enabled, and `content` maps a language to an object of known field keys. An unfinished language is `{}`; missing field means unfinished, while an empty string is permitted draft text and fails publication for required text. Unknown keys and invalid supplied values are rejected; supplied strings remain capped at 3,000 characters. Profile/branding/layout can omit unfinished fields, but supplied fields must satisfy their type, length and safe-value rules. Object/byte limits and script/HTML restrictions apply even to drafts. Protected previews show missing-field diagnostics and never borrow another tenant's copy or populate a public cache.

Publish validation requires a complete public profile, branding/layout, all required sections, supported/default/enabled languages, complete nonempty content for every enabled language and matching translation placeholders. Disabled languages must not be included in the published snapshot. Publishing an incomplete Hindi draft is rejected; the owner may explicitly disable Hindi before publishing an English-only snapshot. The editor saves partial snapshots through `websiteSnapshotSchema`; publication reconstructs and validates the complete `websiteRevisionSchema`. No scripts, arbitrary HTML, secret fields or asset ownership references hidden inside JSON. Future file references require a reviewed relational asset model.

Published snapshots cannot change. Restoring an old website creates/publishes a new revision. Allocate the next revision under a tenant-row lock, not an unprotected `MAX()+1`. Capture both current publication pointer and generation as the draft base; ordinary saves cannot change that base. Publishing follows section 10.1 locking/revalidation, checks idempotent replay before stale-state rejection, compares expected draft lock version and requires both base pointer (NULL-safe) and base publication generation to match the tenant. Then validate the complete snapshot, freeze it, increment publication generation, switch pointer and write the result audit in one transaction.

If Alice starts from publication 1 and Bob publishes another revision, Alice receives `409 stale_publication`; her saved work remains a draft. No last-writer-wins overwrite. Rebase is a separate authorized, version-checked operation that shows current-vs-draft differences, requires explicit resolution and updates the draft base to the current publication under the same locks. Unpublishing sets the pointer to NULL and increments generation with audit; the public repository returns unavailable and never falls back to the highest historical revision. Successful publish retries return the original result rather than creating a new revision or advancing generation twice (section 10.2).

The composite pointer FK proves ownership/existence, not `status='published'`. The publish service enforces status; the public repository also joins on owner, pointer, active tenant and published status and rejects mismatch. The application DB role cannot be assumed to enforce immutability on its own: service rules and integration tests are required; a trigger would be an additional separately reviewed control.

Canonical snapshot hashing requires one specified stable JSON serialization (sorted object keys recursively; array order preserved; UTF-8; no whitespace). Hash before persistence and recompute after decode using the same serializer; do not hash driver-dependent raw JSON output. The checksum detects inconsistency, not malicious database administration.

### 7.1 Snapshot evolution

Keep a version-specific draft/publish validator and read adapter for every stored supported `schemaVersion`. Never validate old snapshots solely with the newest schema. Decode the stored version, verify its original checksum, validate with its own rules, and transform a detached in-memory copy into the current rendering contract. Do not rewrite stored published JSON or its checksum during a read. Fields newly required for editing/publishing can have reviewed deterministic rendering defaults for old versions; missing legal identity is never fabricated. Existing pre-persistence fixtures are converted with their real tenant profile in a controlled import, not by mutating historical publications on demand.

When editing/restoring an old snapshot, create a new draft in the current write version and require review of transformed fields. Unsupported versions fail closed with an operational error; they do not render another tenant or fallback publication. Deploy readers supporting old and new versions before enabling writers of the new version. Keep that write feature gated until old instances drain; retain compatible readers for rollback or explicitly block an incompatible rollback. Removing a section from the newest editor does not remove its renderer from supported historical versions.

## 8. `audit_events`

| Column                | SQL type     | Null? | Default          | Purpose                                                            |
| --------------------- | ------------ | ----- | ---------------- | ------------------------------------------------------------------ |
| `id`                  | UUID         | No    | —                | Event identity                                                     |
| `scope`               | ASCII(16)    | No    | —                | `tenant` or `platform`                                             |
| `tenant_id`           | UUID         | Yes   | NULL             | Required for tenant scope; NULL for platform scope                 |
| `actor_type`          | ASCII(16)    | No    | —                | `user`, `system`, `migration`                                      |
| `actor_user_id`       | UUID         | Yes   | NULL             | Required exactly for user actor                                    |
| `actor_membership_id` | UUID         | Yes   | NULL             | Optional tenant membership acting in event                         |
| `action`              | ASCII(80)    | No    | —                | Allowlisted event code, e.g. `website.published`                   |
| `entity_type`         | ASCII(48)    | No    | —                | Allowlisted record category                                        |
| `entity_id`           | ASCII(255)   | Yes   | NULL             | Diagnostic subject ID; not an authorization/FK mechanism           |
| `request_id`          | ASCII(64)    | Yes   | NULL             | Correlation ID, never session/token                                |
| `reason`              | VARCHAR(500) | Yes   | NULL             | Sanitized operational reason                                       |
| `metadata_json`       | JSON         | No    | —                | Versioned allowlisted redacted metadata, max 16,384 bytes          |
| `operation_key`       | UUID         | Yes   | NULL             | Globally unique client retry key for a committed guarded operation |
| `request_sha256`      | ASCII(64)    | Yes   | NULL             | Canonical semantic request digest, required with operation key     |
| `occurred_at`         | DATETIME(3)  | No    | UTC_TIMESTAMP(3) | Event time                                                         |

Keys: primary `(id)`; unique `uq_audit_operation (operation_key)` (NULL allowed for unrelated events); indexes `(tenant_id, occurred_at, id)`, `(tenant_id, entity_type, entity_id, occurred_at)` and `(scope, occurred_at, id)`; explicit indexes for actor FKs. FKs `tenant_id -> tenants.id`, `actor_user_id -> auth_users.id`, `(tenant_id, actor_membership_id) -> tenant_memberships(tenant_id, id)`, DELETE/UPDATE RESTRICT. Check operation-key/request-digest nullability matches, with a lowercase SHA-256 format when supplied.

Checks enforce scope/tenant consistency, actor type/user consistency, and require tenant/user fields when membership is present. A service validates that membership belongs to the actor user, because the listed FKs do not prove that extra equality. Platform operators can perform explicitly authorized tenant-scoped administration without membership; those events have an actor user but no membership. Entity IDs are polymorphic diagnostics and do not have generic referential integrity.

Events are append-only in application APIs. Use a table-specific INSERT/SELECT-only grant where Hostinger privileges permit; operational retention uses a separate privileged procedure. Audit writes accompany application-owned business mutations in the same TypeORM transaction. Authentication identity/session inserts have a separate atomic guarantee through the `auth_users_audit_signup` / `auth_sessions_audit_login` database triggers added by migration `1793491200009`: each insert and its `auth.signup` / `auth.login` event share an InnoDB transaction. The events retain the origin tenant and diagnostic identity/session ID after session deletion, without storing tokens. They describe successful insertions, not failed credentials or membership authorization. This does not make later verification/enrollment part of the same transaction; a Better Auth after-hook can run after its transaction commits. Recover through section 10.3. Exclude passwords, tokens, full PAN/DOB, documents and unrestricted request bodies; use changed-field names, revision IDs and safe status summaries. This is a business audit, not a financial/consent ledger or a tamper-proof archive. See [Better Auth database hooks](https://better-auth.com/docs/concepts/database#database-hooks).

## 9. Migration infrastructure

### 9.1 `migrations`

TypeORM owns the exact metadata DDL; pin its release and inspect its generated table before implementation. The expected shape is:

| Column      | Expected SQL type | Null? | Default        | Purpose                                           |
| ----------- | ----------------- | ----- | -------------- | ------------------------------------------------- |
| `id`        | INT               | No    | AUTO_INCREMENT | Primary key                                       |
| `timestamp` | BIGINT            | No    | —              | Migration ordering timestamp, not completion time |
| `name`      | VARCHAR(255)      | No    | —              | Migration class name                              |

Configure `migrationsTableName: 'migrations'`, `synchronize: false`, `migrationsRun: false`. Use the framework's applied ledger; do not add a competing successful-state column or hand-insert rows in normal operation. Constrain project migration names to ASCII at most 255 characters with unique 13-digit timestamp suffixes. Preserve the framework's generated types/index behavior if it differs from this expected shape, and update the review document.

### 9.2 `migration_attempts`

| Column                | SQL type       | Null? | Default          | Purpose                                                       |
| --------------------- | -------------- | ----- | ---------------- | ------------------------------------------------------------- |
| `id`                  | UUID           | No    | —                | Attempt identity                                              |
| `run_id`              | UUID           | No    | —                | Groups attempts from one runner invocation                    |
| `migration_name`      | ASCII(255)     | No    | —                | Same identity as TypeORM migration name                       |
| `migration_timestamp` | BIGINT         | No    | —                | Same ordering value as TypeORM                                |
| `migration_checksum`  | CHAR(64) ASCII | No    | —                | SHA-256 of the committed migration source file bytes          |
| `release_id`          | ASCII(128)     | No    | —                | Build/commit identity; no credentials                         |
| `runner_version`      | ASCII(64)      | No    | —                | Runner behavior version                                       |
| `direction`           | ASCII(8)       | No    | `'up'`           | `up` or `down`                                                |
| `status`              | ASCII(16)      | No    | `'running'`      | `running`, `succeeded`, `failed`, `interrupted`, `reconciled` |
| `started_at`          | DATETIME(3)    | No    | UTC_TIMESTAMP(3) | Attempt start                                                 |
| `finished_at`         | DATETIME(3)    | Yes   | NULL             | Terminal-state time                                           |
| `error_code`          | ASCII(64)      | Yes   | NULL             | Safe driver/runner code                                       |
| `error_summary`       | VARCHAR(1000)  | Yes   | NULL             | Redacted failure/recovery description; no raw SQL values      |
| `resolution_json`     | JSON           | Yes   | NULL             | Versioned operator reconciliation evidence, max 8,192 bytes   |

Keys: primary `(id)`; unique `(run_id, migration_name, direction)`; indexes `(migration_name, started_at, id)` and `(status, started_at)`. No FK to `migrations`: failed attempts have no applied row, and reversal removes a ledger row. Checks cover direction/status sets, checksum hex format, positive timestamp and terminal-state timestamp (`running` has no finish; all other states do).

`reconciled` records operator-confirmed resolution, not automatic success. Require `resolution_json` containing operator identity, decision, time and evidence reference; preserve the prior status in that record. Restrict reconciliation to the deployment operator, not tenant staff. Redaction must also apply to deployment logs.

### 9.3 Files, bootstrap, locking and execution

Proposed future layout, not created by this documentation change:

```text
database/
  data-source.ts
  migrations/
    <timestamp>-CreateTenants.ts
    <timestamp>-CreateAuthCore.ts
    <timestamp>-CreateMemberships.ts
    <timestamp>-CreateWebsiteRevisions.ts
    <timestamp>-AddPublicationPointer.ts
    <timestamp>-CreateAuditEvents.ts
  infrastructure/
    bootstrap.sql
  seeds/
    reference.ts
    demo.ts
scripts/
  db-migrate.ts
```

Bootstrap is necessary because the attempt table cannot record its own failed creation. Under the advisory lock, a reviewed bootstrap creates/verifies the two metadata tables on an empty database. Use TypeORM's pinned ledger initialization and explicit reviewed DDL for attempts. Existing tables must match the expected definitions; `IF NOT EXISTS` alone is insufficient validation. Keep bootstrap version/checksum in the release manifest and retain bootstrap success/failure in deployment logs. Later infrastructure changes are ordinary tracked migrations. No manual schema edits through phpMyAdmin are part of routine deployment.

Runner sequence:

1. Validate environment target and migration artifact manifest. Require an explicit production target; never print connection strings/secrets.
2. Acquire `GET_LOCK('stocksbuddha:<database>:migrate', 30)` on a dedicated connection. Validate the final lock name fits the server's limit. On timeout/error, exit without schema changes; record lock contention in deployment logs.
3. Keep the lock connection alive; stop scheduling work if it is lost. Do not silently reconnect/reacquire while a migration might still be executing. Before another runner proceeds after lock loss, inspect for an outstanding migration DB session; connection-scoped lock loss does not prove a query on another connection has stopped.
4. Bootstrap/verify metadata, compare all applied migration identities and recorded source checksums with the release manifest, and refuse unknown/changed/missing history. The runner records every migration; imported legacy metadata without checksums requires explicit reconciliation.
5. Resolve unfinished attempts before executing new work. An applied ledger row without a terminal attempt can indicate a crash after success; an unapplied row can still have partial DDL. Require operator reconciliation, not automatic retry or fake success.
6. For each pending migration, commit a `running` attempt using a separate autocommit metadata connection. Execute one named migration through TypeORM's supported pinned API and commit its success ledger entry. Then persist the attempt outcome. Prove per-migration instrumentation in a spike; do not use unreviewed TypeORM internals or claim a single batch run gives individual outcomes.
7. Stop on failure, record a sanitized failure outside the failed transaction and leave subsequent migrations pending. If metadata persistence itself fails, exit and retain deployment diagnostics; an unfinished row must block the next run.
8. Release the advisory lock, close all connections, and return a nonzero exit on any unresolved state. Roll out the application only after successful migration completion.

Migration source checksums are generated from immutable committed files and shipped in a build manifest alongside compiled JavaScript. Do not compare TypeScript hashes to compiler-dependent JavaScript hashes. Release/build identity ties the manifest to its artifact; checksums are not protection against a malicious database/release administrator.

Run compiled JavaScript through the Node runner at deployment time, not on API startup. Proposed commands: `db:migrate:status`, `db:migrate`, `db:migration:generate`, `db:seed:demo`; none exists yet. Direct CLI execution must not bypass the locked runner in shared dev/prod.

MariaDB DDL can implicitly commit. Use small migrations with reviewed partial-failure recovery and additive expand/backfill/contract releases. No blanket promise of transaction rollback or automatic `down()` in production. `down` attempts, where explicitly approved and safe, use the same runner/lock/history. See [MariaDB implicit commits](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit), [GET_LOCK](https://mariadb.com/docs/server/reference/sql-functions/secondary-functions/miscellaneous-functions/get_lock), and [TypeORM migration configuration](https://typeorm.io/docs/migrations/setup/).

## 10. Relationship and access summary

| Child                   | Parent relationship                                                     | Database guarantee                                 |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| Auth account/session    | `user_id -> auth_users.id`                                              | Identity exists                                    |
| Membership              | `tenant_id -> tenants.id`, `user_id -> auth_users.id`                   | Tenant/identity exist; unique relationship         |
| Website revision        | `tenant_id -> tenants.id`                                               | Owner exists                                       |
| Revision actors         | `(tenant_id, actor membership ID) -> tenant_memberships(tenant_id, id)` | Actor membership belongs to same tenant            |
| Tenant publication      | `(id, published_revision) -> website_revisions(tenant_id, revision)`    | Pointer cannot reference another tenant's revision |
| Tenant audit            | Tenant/user/membership FKs as defined above                             | Retained referenced identity/ownership             |
| Future business records | `(tenant_id, membership_id) -> tenant_memberships(tenant_id, id)`       | Stable tenant-local subscriber ownership           |

Foreign keys do not authorize reads. Authenticated request handling must verify session, resolve tenant, check tenant lifecycle and matching membership/capability, then scope every resource operation by immutable tenant ID. Platform privileges are evaluated separately. Public website projection includes only the selected published snapshot/locale and safe organization fields, not settings, other languages, drafts or membership fields.

Database roles: application DML with no DDL; migration operator with DDL/metadata privileges; separate operational backup/retention access where the hosting plan allows it. Verify table grants and `GET_LOCK` on the actual host. Account deletion is explicitly coordinated: remove temporary auth children, handle memberships and retained audits according to policy, then delete/anonymize identity as permitted. RESTRICT means the auth framework's default delete flow needs testing and possibly a controlled wrapper.

### 10.1 Authorization and permission-change ordering

All tenant mutations, including draft save/publish/unpublish, membership role/override/revocation/reactivation and tenant lifecycle changes, use one transaction lock order: affected `auth_users` rows in sorted ID order first (actor plus target identity for membership changes/provisioning), tenant row second, affected memberships in sorted ID order third, affected revisions in sorted ID order fourth. Read current committed permission state through locking reads after acquiring locks, not an earlier repeatable-read snapshot. Revalidate active tenant, authenticated actor, required capability and expected row versions inside the transaction. Platform operations use current locked platform-role data and explicit platform authorization; global role changes lock the affected user row. System jobs use an explicit service policy, not a fabricated user session.

The tenant lock deliberately serializes early-stage tenant writes. If a publisher acquires it first and passes the final checks, publication commits before revocation; if revocation commits first, publication reads revoked membership and is denied. Revocation takes effect at its commit for later serialized operations. Do not promise cancellation of previously returned data or a global session operation already past its authorization point. No external provider/network work occurs while holding these business locks. On deadlock/timeout, roll back; retry only the complete bounded transaction with the same operation key and no outside side effects.

Owner changes evaluate the resulting effective-owner set, including capability denies, before commit. First-owner creation and tenant activation use this same tenant transaction. Initial nonempty overrides remain deferred; the invariant must be implemented before enabling them.

### 10.2 Idempotent application operations

Publish, unpublish, draft creation and tenant provisioning require a client-generated UUID `operation_key`, reused for the same retry. The existing audit table holds the committed operation receipt; this does not add a generic business ledger or another table. The semantic request digest includes authenticated actor ID, tenant/scope, action, target IDs, expected versions and canonical payload. Do not include transport timestamps or request IDs that change on retry. `metadata_json` stores a small allowlisted `operationResult` (resource IDs, resulting versions and original response status), not credentials or full content.

Inside the authorized transaction, check a matching receipt before testing stale draft/base versions. Same actor, scope, action and digest returns the original committed result; same key with different semantics returns `409 idempotency_conflict` without exposing any other operation. If access was revoked since the original call, deny replay rather than disclose its result. One globally unique audit key prevents concurrent duplicate commits: a unique-key race rolls back the whole losing transaction, then an authorized receipt lookup determines replay/conflict. Provisioning uses a preallocated tenant UUID so concurrent requests can acquire consistent locks when the row exists; the unique key/tenant insert resolves the initial missing-row race.

A response lost after commit is safe to retry. A crash before commit leaves neither business change nor receipt. Never report success from an audit attempt whose transaction rolled back. Retain operation receipts for as long as the corresponding operation can be replayed; no audit purge is introduced in this foundation. Before implementing retention, define a retry-expiry/tombstone policy or a dedicated receipt table so old keys cannot silently reexecute. This covers database-only foundation operations; external payments/messages need provider idempotency and durable jobs in their own future modules.

### 10.3 Authentication, enrollment and provisioning boundaries

Authentication creates/verifies a global identity independently of tenant enrollment. No claim is made that Better Auth hooks join the TypeORM transaction. A newly created identity with no membership is valid but has no tenant capabilities; show enrollment pending and allow retry from a verified session. A failed tenant write must never trigger automatic global-account deletion because that identity may already belong to another RA.

An explicit enrollment endpoint verifies the session and server-resolved tenant, then creates a default subscriber membership under the tenant lock. The unique `(tenant_id, user_id)` key makes repeated enrollment converge to one relationship. Existing staff roles are rejected from subscriber enrolment rather than treated as subscriber access. Subscriber and staff memberships are mutually exclusive in one RA; staff invitations cannot convert an existing subscriber or a different staff role. Existing revoked membership returns an explicit unavailable/reactivation-required response, never silent restoration. Record business enrollment and audit atomically. Do not grant staff from Google profile values, a request role, or a post-auth hook.

Staff invitations are implemented in `organisation_invitations` by migration `1793491200011`, with tenant, normalized intended email, stored staff role, token digest, issuer, one-hour expiry, delivery state and accepted identity. Consume it and create/update membership atomically under the same locks; concurrent signup/acceptance must preserve one membership, apply only the server-stored invitation grant, and not overwrite a higher role accidentally. Only platform owners appoint RA Admins; an RA Admin invites analysts/support in their tenant. See [organisation access](ORGANISATION_ACCESS.md).

Provisioning requires an existing verified owner identity. A platform-authorized transaction creates a draft tenant, first active owner membership, initial website draft and audit receipt, then activates only after effective ownership and required setup pass validation. Initial publication may be a later explicit operation. Failure rolls back tenant/membership activation together; no active real tenant is left ownerless. A retry reuses the operation key and preallocated IDs. This describes the older internal `TenantOperations.provision` service. The newer invited-admin flow creates an unpublished draft organisation first and activates it atomically with its first admin membership on acceptance; website draft/publication is a separate later operation (see [organisation access](ORGANISATION_ACCESS.md)). Import of read-only public previews follows the explicitly restricted exception in section 4.

Auth event telemetry may be written through hooks with correlation IDs and reconciliation, but has no promised atomicity with the auth transaction. If durable, complete authentication-event capture becomes a requirement, prove an auth-supported transactional outbox/capture mechanism rather than treating a best-effort hook as an audit guarantee.

### 10.4 Connection budgets and restore compatibility

Initial proposed runtime caps per application process: TypeORM 5 connections, Better Auth/mysql2 5 connections; use 2 + 2 for local development. Bound acquisition wait at 3 seconds, query wait at 5 seconds for ordinary web requests, and pending acquisition queue at 20 per pool. Return an explicit temporary-unavailable response on saturation; no unlimited queues. These are starting engineering values to map to the pinned drivers and load-test, not proven Hostinger capacity or a universal provider timeout. Tune slow operations separately outside web request transactions.

Budget across all process instances: `instances × (typeorm_pool + auth_pool) + migration_connections + backup/admin/reserve <= hosting connection limit`. The migration runner may require 3 connections (lock, migration, metadata); reserve at least 5 additional administrative/backup connections initially. A rolling deployment can double application pools; do not deploy if its combined budget exceeds the confirmed plan limit. A future worker consumes an additional explicit budget. Verify actual driver timeout/cancellation semantics rather than assume differently named options are interchangeable.

Backups must identify compatible app release, schema/migration manifest, referenced document/object versions and the encryption-key versions needed to decrypt retained secrets. Keep recoverable keys separately protected rather than embedding them in the DB dump. Rehearse an isolated restore with decryption, object-reference verification, tenant access and session invalidation/re-establishment policy. Restoring only rows does not demonstrate a working service. Current foundation has no customer documents; the file-consistency requirement becomes mandatory before adding them.

## 11. Seeds and existing-data compatibility

- Preserve the current three tenant UUIDs, canonical slugs, synthetic markers and validated multilingual websites.
- Repeatable demo seeds insert missing records using stable IDs; reruns do not overwrite owner edits or current publications. Changed fixture content requires an explicit new revision.
- Never seed passwords, provider tokens, sessions or real subscriber data. Synthetic login identities, if later required, use a separate explicit dev-only workflow.
- Production seed work is explicit and audited; Alpha/Beta demos are not automatically activated in production. Synthetic tenants are never a security exemption.
- Preserve canonical redirect behavior in routing; historical slug/domain mappings are a separate future feature.
- Legacy migration/import is a later dry-run/reconciliation workflow, not re-execution of old Liquibase SQL. Move global legacy profile/onboarding state into the selected RA membership; never infer consent/KYC/payment success from an aggregate status alone.

## 12. Deferred records and limits of consolidation

| Later feature                          | Boundary reserved now                                   | Why a later table may be needed                                                                     |
| -------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Invitations/username/administrator OTP | Tenant UUID and framework schema contract               | Expiring invitations and plugin records are not profile JSON                                        |
| KYC/agreements/consent                 | Composite membership key                                | Repeated attempts, immutable accepted versions and evidence have independent lifecycles             |
| Commerce                               | Tenant + membership IDs; future plan/version/order keys | Orders, multiple payment attempts, refunds and subscriptions cannot be one mutable profile          |
| Provider configuration/callbacks       | Tenant UUID                                             | Credential versions and callback idempotency need explicit keys                                     |
| Jobs/delivery                          | Tenant-owned business references                        | Durable leases, retries and per-attempt outcomes require records, not audit reconstruction          |
| Research/Telegram                      | Tenant/membership keys                                  | Immutable research revisions and overlapping plan-channel relationships need relational constraints |
| Files                                  | Tenant/owner composite keys                             | Private file metadata and grants cannot be hidden in content JSON                                   |
| Domains/slug history                   | Immutable tenant UUID                                   | Host uniqueness, verification and redirects are independently managed                               |
| Platform software billing              | Separate product/ledger namespace                       | Must not mix platform fees with RA subscriber money                                                 |

No future PAN, file or provider-secret storage is authorized by `profile_json`/`settings_json`. Extra tables will be proposed with their feature; ten is a foundation target, not a permanent cap. Lower table count does not establish lower storage cost or better query performance.

## 13. Size limits and growth planning

| Data                           | Proposed bound/behavior                                                         |
| ------------------------------ | ------------------------------------------------------------------------------- |
| Website snapshot               | 512 KiB serialized maximum per revision; normal fixtures should be much smaller |
| Tenant settings                | 16 KiB per tenant                                                               |
| Membership extension/overrides | 8 KiB + 4 KiB maxima; ordinary rows remain small                                |
| Audit metadata                 | 16 KiB maximum per event; target ordinary events below 2 KiB                    |
| OAuth/verification TEXT        | 65,535-byte SQL bound; validate actual provider/framework payloads              |
| Migration resolution           | 8 KiB maximum; sanitized summary, not full logs                                 |

These are limits, not allocations or a storage forecast. For illustration, 12 tenants × 100 revisions × 50 KiB average snapshot is about 58.6 MiB of snapshot payload; one million audit events averaging 1 KiB is about 976.6 MiB of metadata payload. Indexes, other columns, row overhead, binary logs and backups add storage. Audit/session history may dominate, not tenant count.

Expire authentication sessions/verifications using bounded indexed batches, only after their framework-required lifetime. Audit retention, private profile retention, anonymization and revision archival require an owner-approved policy before live customer data; do not choose a regulatory duration from a legacy SQL comment. No automatic deletion of published history is part of this proposal.

## 14. Implementation and review gates

1. Confirm Hostinger plan/version/engine, connection rules, database limits, TLS, grants, lock support and backup/restore capability. Pin matching local image and libraries.
2. Approve auth configuration and plugins; settle email uniqueness/collation, username login, administrator OTP, token storage and ID generation. Generate/diff the exact SQL. The four auth tables remain provisional until that proof.
3. Build bootstrap/runner and prove lock exclusion, per-migration tracking, source-manifest verification, process crash recovery and DDL partial failure on real MariaDB.
4. Apply schema in dependency order: metadata bootstrap; tenants without publication FK; auth; memberships; revisions; publication FK; audit. Insert initial records only after all schema constraints are installed.
5. Replace fixture repositories with database adapters behind the existing interfaces. Keep public contract validation/projection, UUIDs, localization and redirects intact. Update architecture/database documentation alongside implementation.
6. Verify two-tenant FK rejection, scoped reads, multi-tab memberships, last-owner concurrency, stale edit rejection, atomic complete-language publication, immutable history, failure-without-fixture-fallback, and repeatable non-destructive seeds.
7. Verify authentication create/login/link/recover/revoke/delete flows against exact mappings; test overlong values and duplicate emails/provider identities. No implementation of security plugins is implied by a proposed column.
8. Verify fresh install and upgrades, backup/restore, deployment failure blocking and explicit dev/prod separation. Integration tests use only a disposable local database, never destructive resets against hosted dev/prod.

Additional behavioral acceptance cases from revision 2:

| Scenario                                             | Required result                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Save unfinished Hindi draft                          | Save succeeds with missing known fields; publication fails with field diagnostics; current live page unchanged |
| Edit administrative legal/contact details            | Public website stays on its frozen profile until explicit publication                                          |
| Stale draft after another publication or unpublish   | `409 stale_publication`; draft preserved; explicit rebase required                                             |
| Lost publish/provision response; same-key retry      | Original authorized result returned; one business change, one receipt, no duplicate generation                 |
| Same retry key, different request/actor/tenant       | Generic conflict/denial without disclosing another operation                                                   |
| Revocation and publish run concurrently              | Tenant-lock order determines the committed result; revoked member cannot authorize a later mutation            |
| Last owner denied management or demoted              | Reject if no effective active owner would remain                                                               |
| Reactivate revoked staff                             | Explicit reviewed role, cleared overrides by default, audit; signup alone cannot reactivate                    |
| Auth account exists but membership creation fails    | Global identity remains; no tenant privileges; verified enrollment retry converges to one membership           |
| First-owner provisioning fails midway                | No partially active real tenant; transaction rollback and safe operation retry                                 |
| Temporarily unpublished tenant                       | NULL pointer returns unavailable; historical highest revision is not selected                                  |
| Staff member buys a plan                             | Existing staff role preserved; research access separately checks onboarding/subscription entitlements          |
| Concurrent signup and future invitation acceptance   | One membership and only a verified invitation grant; test when invitation module is added                      |
| Older stored schemaVersion after application upgrade | Original bytes/checksum preserved; supported read adapter renders correctly; unknown version fails closed      |
| Rolling deployment overlaps old code                 | New writers remain gated until compatible readers run everywhere; schema changes are additive                  |
| Session revoked while cookie remains                 | Next authoritative protected check rejects it; test the documented in-flight-operation boundary                |
| Pools saturated during rolling deployment            | Confirm combined connection budget, bounded queue/timeouts and recoverable failure responses                   |
| Restored backup and external objects/keys            | Decryption and references work with the matching release, plus tenant-isolation checks                         |

Reviewer decisions: approve consolidation; confirm identity normalization/plugin requirements; approve JSON caps and privacy boundaries; review FK/index costs against actual queries; approve migration recovery mechanics and deletion/retention policies. Do not approve production migrations solely from this document: generated DDL and real-database evidence are separate deliverables.

## 15. Repository references

- [Current architecture](ARCHITECTURE.md): implemented fixture boundaries and future persistence requirements. This proposal intentionally consolidates previously separate conceptual profile/content tables; the implemented architecture has not changed.
- [Database artifact location](../database/README.md): currently empty migration/seed directories and no configured runner.
- [Tenant contract](../packages/contracts/src/tenancy.ts), [website contract](../packages/contracts/src/website.ts), and [access policy](../backend/src/access/authorization.ts): source contracts this design must preserve or explicitly evolve.
- Legacy reference PRDs live in the sibling `website/product-rebuild/prds/` directory. Their planned features inform deferred boundaries; they are not evidence those features already exist here.

## 16. Review disposition — revision 2

The attached review's six principal findings are accepted: separate draft/publish validation (section 7); frozen public organization profile (section 4); explicit base generation/rebase and operation receipts (sections 7 and 10.2); serialized permissions/effective-owner/reactivation and authoritative sessions (sections 5.3, 6 and 10.1); independent auth/enrollment transactions (section 10.3); versioned snapshot readers and rollout gates (section 7.1). Its additional scenarios are included in section 14, and pool/restore decisions in section 10.4.

DOB/city and nonempty permission overrides are deferred until their actual workflows. Consolidated snapshots and later dedicated records for KYC/payments/files/delivery remain unchanged. Added columns/constraints stay within ten proposed tables; plugins/invitations may still justify later tables. These were documentation-only decisions at revision 2. The subsequent foundation implementation and its local validation are recorded in [DATABASE_IMPLEMENTATION.md](DATABASE_IMPLEMENTATION.md).

## Organisation invitation extension

`organisation_invitations` adds UUID primary key `id`; required tenant/issuer FKs (`tenant_id`, `created_by`); normalized binary-collated `email` (254 characters); `role` restricted to owner/analyst/support; unique 64-character ASCII SHA-256 `token_hash`; expiry and creation UTC DATETIME(3); nullable accepted_at/accepted_by and revoked_at; delivery_status pending/sent/failed. Checks pair acceptance identity/time, forbid accepted+revoked states and require expiry after creation. All FKs restrict deletion/update. Indexes cover `(tenant_id,email)` and expiry. Tokens are never stored in plaintext. Membership remains the authorization source. Draft organisation activation and first-admin membership are atomic at invitation acceptance; published website creation remains separate. See the migration and organisation access guide for locking, privacy and retry behavior.

## Mobile verification extension

Migration 17 (`1794268800000-MobileVerification`) adds six tables, bringing that baseline to 27 tables including migration metadata. `sms_settings` keeps encrypted versioned tenant sender/template credentials and a keyed vendor-username fingerprint for platform-account isolation. `sms_mutex` serializes short OTP/quota transactions. `sms_challenges` binds keyed OTP/mobile digests to tenant/user/membership/purpose with expiry, resend, attempt and consumption state. `sms_events` keeps retained encrypted communication evidence plus provider outcome, hashed IP and request-key uniqueness. `account_recovery_mobiles` holds one explicitly enrolled encrypted global recovery number per identity, with a unique keyed number digest. `sms_security_notices` is the leased durable security-email outbox. No public website JSON contains SMS settings. Foreign keys preserve evidence scope. Existing membership mobile timestamps are reused, not automatically populated. See [retention, limits and trust boundaries](MOBILE_VERIFICATION.md).

## Recovery email limit extension

Migration 18 (`1794355200000-RecoveryEmailLimits`) adds `recovery_email_sends`, bringing totals at that migration to 28 tables including metadata. Its user FK and `(user_id, created_at)` index support global rolling-day/cooldown reservations. Per-user row locks in `auth_users` serialize quota checks and inserts across replicas. Each reservation commits before SMTP, so failures still consume the attempt without holding a database connection during mail delivery. Only opaque IDs and UTC send-attempt timestamps are stored, with no email addresses or reset links/tokens.

Migration 19 (`1794441600000-TenantIntegrations`) adds `tenant_integrations`, bringing totals at that migration to 29 tables including metadata. `(tenant_id, kind)` is the primary key; `kind` is constrained to Telegram/payment, with a tenant FK, encrypted configuration and optimistic version. Existing `sms_settings.config_cipher` is widened to `MEDIUMTEXT` for template arrays. Provider secrets remain outside public website revisions and general audit metadata.

## QR payment extension

Migration 20 (`1794528000000-QrPayments`) brings the current total to 31 tables including metadata. `ra_qr_settings` stores independently versioned encrypted RA payee/UPI/instruction/image configuration. `qr_payment_attempts` has an order primary key, composite tenant/order FK, encrypted frozen configuration, encrypted reference/date/proof and review note, tenant-bound unique reference hash, constrained review status, version, timestamps and reviewer FK. `subscription_orders.payment_method` distinguishes QR and Cashfree, with existing sessions backfilled. Bounded QR images and proofs use encrypted MariaDB `MEDIUMTEXT` rather than Drive document rows. Owner approval and entitlement/delivery-job changes commit together, preserving manual bank-check evidence and exactly-once activation. See [QR operations, limits and retention](QR_PAYMENTS.md).

# Authentication and workspace access

MariaDB mode mounts Better Auth email/password authentication against the existing four auth tables. Migration `AddAuthTenantContext1793491200009` adds RA provenance and authentication audit triggers; no dependency change is required. Fixture mode renders tenant login/signup previews with a 503 service notice and disabled forms. Session/workspace APIs remain unavailable; no fixture identities or fake memberships are created.

## Configuration and sessions

Set `AUTH_SECRET` to a unique random secret of at least 32 characters and `AUTH_BASE_URL` to the exact public origin, for example `http://localhost:3000` locally or `https://stocksbuddha.com` in production. Paths and trailing slashes are rejected; production requires HTTPS. Generate secrets with `openssl rand -hex 32`. Use separate secrets, databases and origins for dev/prod. Existing local `.env` files need these new settings before starting MariaDB mode.

Cookies are signed, HttpOnly, SameSite=Lax, host-only and Secure on HTTPS. Sessions expire absolutely after seven days. Cookie caching and session refresh are disabled: every protected request consults persistent sessions, then current membership/tenant state. Sign-out deletes the stored session. The application never accepts a user ID, platform role, tenant ID or session token from a body/query/header as authorization. The convenience session endpoint omits the token. Better Auth's own session APIs retain their standard authenticated response shapes.

`/api/auth/*` mounts the [official Express adapter](https://better-auth.com/docs/integrations/express) before body parsing. Better Auth applies origin checks and rate limits, including stricter credential-route limits. MariaDB mode uses shared `auth_rate_limits` counters through Better Auth’s atomic `consume` interface. Requests across application processes share a bucket; row locks serialize checks/increments. Counter keys are SHA-256 digests rather than raw IPs; expired buckets are removed in bounded batches during requests. Database failure fails the request closed. The general limit is 100 requests per 60 seconds per client/path, with Better Auth’s stricter credential and email rules retained. Internal unmounted auth tests can still select memory storage explicitly. This is authentication abuse protection, not tenant workload quotas or a capacity guarantee.

`AUTH_TRUSTED_PROXIES` is an optional comma-separated list of exact proxy IP addresses/CIDRs. Leave it empty for direct local development. If configured, only a trusted socket peer may supply `X-Forwarded-For`; the server walks the chain from right to left and stops at the first untrusted address. Invalid or oversized chains fall back to the socket. Client-supplied `x-auth-client-ip` is always overwritten. Blanket trust and hop-count settings are rejected. Select addresses from the actual deployment topology, restrict access to the origin, and have the ingress sanitize forwarded headers. Do not copy an example proxy address into production without verifying it.

## Signup and login RA provenance

Global identity, authentication provenance and access are separate:

| Storage                         | Meaning                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `auth_users.signup_tenant_id`   | Nullable FK to the RA through which the global account was first created; later logins do not change it       |
| `auth_sessions.login_tenant_id` | Nullable FK to the RA through which this particular session started; not a current/selected tenant            |
| `audit_events`                  | Durable `auth.signup` identity-creation and `auth.login` session-creation events, including RA and event time |
| `tenant_memberships`            | Actual membership, role and authorization; provenance never grants access                                     |

The backend resolves an active tenant from `/ra/:slug/signup` or `/login` and uses request-local `AsyncLocalStorage` to supply that context to Better Auth's before-create hooks. Both extra fields are server-owned (`input: false`, `returned: false`) and omitted from ordinary auth responses and public hydration. No header, query/body tenant ID or referrer supplies provenance. Concurrent RA requests cannot overwrite each other's context.

Direct global `/api/auth/*` calls and internal auth calls without a tenant scope retain `NULL` and generate platform-scoped audit events. `NULL` means unknown/global context; it must not be guessed from membership, browser tabs or the user's signup RA. Without email delivery configured in local development, signup creates a session too, producing both a signup and login event. With production-style verification configured, signup creates only the identity/audit event; the later password sign-in after verification creates the session/login event. Signup origin is the first account-creation origin, not a list of RAs joined.

Migration `1793491200009-AuthTenantContext.ts` installs `auth_users_audit_signup` and `auth_sessions_audit_login`. Each trigger inserts a minimal event in the same InnoDB transaction as its parent insert, so an audit failure rolls back that identity/session insertion. Audit `entity_id` contains a user/session **ID**, never a session token; deleting an expired/revoked session does not delete its login history. The creation events are evidence of database insertion, not failed-password attempts, workspace access or completion of later verification/onboarding. Whole signup requests can include additional auth operations; no cross-operation transaction guarantee is claimed. See [MariaDB trigger transaction behavior](https://mariadb.com/docs/server/server-usage/triggers-events/triggers/trigger-overview).

Existing users and sessions are preserved with `NULL` provenance. Apply the migration explicitly before starting the updated backend:

```sh
npm run db:migrate -- --target dev
npm run db:migrate:status -- --target dev
```

Use [the reviewed backfill SQL](../database/queries/backfill-auth-tenant-context.sql) in one database-client connection. The file provides read-only inventory/history queries and separate transaction blocks for signup and individual-session provenance. For the two existing accounts, run the signup block once with the Stocks Buddha email and slug `stocksbuddha`, then again with the Beta email and slug `beta`. Replace placeholders with the actual emails; no assignment is inferred or applied by the migration. The blocks update only missing origins, preserve existing values, and record `auth.signup_context.backfilled` / `auth.login_context.backfilled` with `source=manual_backfill` at the backfill time. They do not invent historical login events, change verification state or add memberships. A result of `updated_rows=0` means no matching unknown origin was updated; inspect the supplied email/slug and existing value before proceeding.

Only backfill a session when its original login RA is known. Otherwise leave its origin `NULL`, or sign out and sign in through the intended RA to create a correctly attributed new session. Do not set all sessions to the user's signup RA.

## Pages and APIs

Account and workspace pages use the shared React SSR/hydration pipeline, public brand components, styles and English/Hindi catalogues. The responsive forms retain native POST behavior without JavaScript; hydration adds password visibility and pending state. Failed requests preserve name/email but never passwords. CSP restricts form destinations, framing, base URLs and embedded objects while allowing the shared frontend assets to load. All responses retain `no-store` and `noindex`.

| Route                                     | Behavior                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET/POST /ra/:slug/signup`               | Account creation; new accounts have no platform role or membership                                           |
| `GET/POST /ra/:slug/login`                | Email/password sign-in; members enter the workspace, while verified nonmembers continue to tenant enrollment |
| `POST /ra/:slug/logout`                   | Revoke the current session and clear its cookie                                                              |
| `/api/auth/*`                             | Better Auth signup/sign-in/sign-out and core session management                                              |
| `GET /api/session`                        | Current identity and session expiry; guests receive 401                                                      |
| `GET /workspace`                          | Active workspace memberships or an empty state; guests redirect to login                                     |
| `GET /ra/:slug/workspace`                 | Membership-protected workspace overview with role and capabilities                                           |
| `GET /api/workspaces`                     | Current user's active workspace list                                                                         |
| `GET /api/workspaces/:slug`               | Current membership and derived capabilities                                                                  |
| `POST /api/workspaces/:slug/membership`   | Verified-user self-enrollment as subscriber through the audited transactional service                        |
| `GET /api/workspaces/:slug/members`       | Minimal roster, requiring `staff:manage`                                                                     |
| `PATCH /api/workspaces/:slug/members/:id` | Change an existing member's role/status with concurrency and last-owner checks                               |

The public website’s desktop/mobile login links retain the tenant and selected language. `/ra/:slug/signin` redirects to the tenant login page; global `/login`, `/signin` and `/signup` redirect to the Stocks Buddha account pages. `/workspace` remains the authenticated cross-tenant chooser; the former `/workspace/:slug` address redirects to the canonical tenant workspace after authentication. Global `POST /logout` remains available for the chooser. Path-scoped account pages share the global identity/session; tenant membership, not the URL or cookie path, authorizes workspace access.

The application-owned form and membership mutations require an exact `Origin: AUTH_BASE_URL`. Membership mutations also require a fresh UUID `Idempotency-Key`. PATCH accepts `{ "version": 1, "role": "analyst", "active": true }`; use the version returned in the roster. Reusing a key with a different request returns 409. Transactions recheck the stored session and current owner permission, preserve the last effective owner, increment the membership version and commit an audit receipt with the update.

Self-enrollment never grants staff roles, changes an existing staff role, reactivates a revoked membership or accepts unverified email. Account creation alone gives no workspace access. First-owner/tenant provisioning remains an internal, audited `TenantOperations.provision` operation with a verified platform-owner session; no public role-grant or bootstrap-admin endpoint is exposed.

## Roles and isolation

| Role       | Tenant capabilities                                                    |
| ---------- | ---------------------------------------------------------------------- |
| owner      | `website:edit`, `research:publish`, `subscribers:read`, `staff:manage` |
| analyst    | `research:publish`                                                     |
| support    | `subscribers:read`                                                     |
| subscriber | Workspace overview only                                                |

Active membership and an active tenant are mandatory. Missing, revoked, suspended or foreign workspaces return the same 404; browser requests to an active tenant without membership receive a branded unavailable view. Unknown nested workspace routes cannot fall through to the public renderer. Unsupported capability overrides fail closed. Platform ownership grants no automatic tenant membership. The members API scopes reads and transaction inputs to the server-resolved immutable tenant ID. Role/status changes are reflected on the next request without signing in again.

Website editing, research publication and subscriber business screens are not part of these overview routes; their future endpoints must enforce the listed capabilities too. Subscriber membership is not a purchase entitlement.

The workspace chooser reads tenant/membership projections in one joined query scoped to the authenticated user, rather than launching lookups per membership. List and detail views share projection/capability checks. Transactional website and membership operations use the same `canAccessTenant` capability policy on locked tenant/membership facts; stored session validation, lock order, unsupported-override rejection and last-owner checks remain inside the transaction.

## Validation and remaining scope

`npm run test:unit` covers auth forms, private routing, membership/capability guards, forged identity fields, origin checks, safe failures and workspace projections. `RUN_DATABASE_TESTS=true npm run test:database` tests real signed cookies through HTTP against disposable MariaDB databases, verified enrollment, owner-only updates, role changes, revocation, sign-out and tampering, alongside existing transactional/concurrency tests. The real-DB suite also verifies old-schema upgrades, repeatable backfill queries, cross-RA sign-ins, global/null contexts, retained history after session deletion and rollback when an audit insert fails. The ordinary integration suite explicitly skips MariaDB unless opted in. Component tests cover localized forms and workspace states, and Playwright checks tenant navigation, responsive layout, hydration, keyboard focus and axe scans at desktop/tablet/mobile widths.

Google/username auth, administrator OTP/MFA, invitations, bootstrap tooling and a full workspace/editor UI remain separate work. Verification and recovery are configured through Resend as described below. No production deployment is included.

## Verification and password recovery

Set `RESEND_API_KEY` to a Resend sending key and `AUTH_EMAIL_FROM` to a sender on a verified domain (for example `support@stocksbuddha.com`). Credentials remain in process environment / ignored `backend/.env`. Both are required at production startup. Local MariaDB without either retains the earlier unverified-development login behavior and displays service-unavailable notices on email recovery forms; configuring just one is rejected. Fixture previews never send mail. A present key is not proof that Resend accepts it or that the sender domain is verified: check provider readiness before onboarding.

With email configured, signup sends a one-hour verification link and creates no session. Unverified sign-in resends verification and grants no session. Verification confirms the shared global identity without automatically signing it in; a normal password sign-in follows. `/ra/:slug/join` then allows explicit, verified subscriber enrollment through the existing transaction policy. Existing members go directly to their workspace; revoked memberships cannot self-reactivate. This does not grant paid research access or staff roles.

| Route                                | Purpose                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `GET/POST /ra/:slug/verify-email`    | Request a fresh verification email; generic confirmation avoids disclosing eligibility |
| `GET/POST /ra/:slug/forgot-password` | Request a password reset with the same generic confirmation                            |
| `GET/POST /ra/:slug/reset-password`  | Submit a new password using Better Auth’s one-time, one-hour recovery token            |
| `GET/POST /ra/:slug/join`            | Authenticated join page and explicit verified subscriber enrollment                    |

The framework owns token generation, verification and consumption. Forms pin callback destinations to the configured origin and resolved tenant, reject foreign mutation origins and retain ordinary native POST behavior. Reset-link tokens are exchanged for a one-hour HttpOnly, SameSite=Strict cookie scoped to the tenant’s reset path; the browser is redirected to a clean URL. Tokens are not included in account hydration. The cookie is Secure on HTTPS and cleared after success. A successful reset revokes existing sessions across all workspaces because passwords belong to global identity. Login and recovery forms explain that shared identity.

Delivery uses Resend’s HTTPS API with a 10-second deadline. Provider failures are reported without recipient addresses, credentials, or response bodies in application errors. Delivery is awaited; there is no durable mail queue or automatic provider retry. Users can request a fresh link after a failure. Automated tests capture email messages and follow their real framework links against disposable MariaDB without emailing recipients.

Apply migration `1793491200010-AuthRateLimits.ts` explicitly before starting MariaDB mode. The runtime account needs SELECT/INSERT/UPDATE/DELETE on `auth_rate_limits`; migration privileges remain separate. Never migrate the live application database as part of starting a test.

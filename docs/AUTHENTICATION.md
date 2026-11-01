# Authentication and workspace access

MariaDB mode mounts Better Auth email/password authentication against the existing four auth tables. No migration or dependency change is required. Fixture mode renders tenant login/signup previews with a 503 service notice and disabled forms. Session/workspace APIs remain unavailable; no fixture identities or fake memberships are created.

## Configuration and sessions

Set `AUTH_SECRET` to a unique random secret of at least 32 characters and `AUTH_BASE_URL` to the exact public origin, for example `http://localhost:3000` locally or `https://stocksbuddha.com` in production. Paths and trailing slashes are rejected; production requires HTTPS. Generate secrets with `openssl rand -hex 32`. Use separate secrets, databases and origins for dev/prod. Existing local `.env` files need these new settings before starting MariaDB mode.

Cookies are signed, HttpOnly, SameSite=Lax, host-only and Secure on HTTPS. Sessions expire absolutely after seven days. Cookie caching and session refresh are disabled: every protected request consults persistent sessions, then current membership/tenant state. Sign-out deletes the stored session. The application never accepts a user ID, platform role, tenant ID or session token from a body/query/header as authorization. The convenience session endpoint omits the token. Better Auth's own session APIs retain their standard authenticated response shapes.

`/api/auth/*` mounts the [official Express adapter](https://better-auth.com/docs/integrations/express) before body parsing. Better Auth applies origin checks and rate limits, including stricter credential-route limits. The limiter is in-memory per process, enabled in development and production. The rate-limit IP comes from the socket, overwriting any client-supplied `x-auth-client-ip`. Forwarded IP headers are not trusted; behind a proxy, requests share its socket IP. Review a trusted proxy boundary and a shared limiter before horizontal scaling.

## Pages and APIs

Account and workspace pages use the shared React SSR/hydration pipeline, public brand components, styles and English/Hindi catalogues. The responsive forms retain native POST behavior without JavaScript; hydration adds password visibility and pending state. Failed requests preserve name/email but never passwords. CSP restricts form destinations, framing, base URLs and embedded objects while allowing the shared frontend assets to load. All responses retain `no-store` and `noindex`.

| Route                                     | Behavior                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET/POST /ra/:slug/signup`               | Account creation; new accounts have no platform role or membership                    |
| `GET/POST /ra/:slug/login`                | Email/password sign-in; successful form submission redirects to `/ra/:slug/workspace` |
| `POST /ra/:slug/logout`                   | Revoke the current session and clear its cookie                                       |
| `/api/auth/*`                             | Better Auth signup/sign-in/sign-out and core session management                       |
| `GET /api/session`                        | Current identity and session expiry; guests receive 401                               |
| `GET /workspace`                          | Active workspace memberships or an empty state; guests redirect to login              |
| `GET /ra/:slug/workspace`                 | Membership-protected workspace overview with role and capabilities                    |
| `GET /api/workspaces`                     | Current user's active workspace list                                                  |
| `GET /api/workspaces/:slug`               | Current membership and derived capabilities                                           |
| `POST /api/workspaces/:slug/membership`   | Verified-user self-enrollment as subscriber through the audited transactional service |
| `GET /api/workspaces/:slug/members`       | Minimal roster, requiring `staff:manage`                                              |
| `PATCH /api/workspaces/:slug/members/:id` | Change an existing member's role/status with concurrency and last-owner checks        |

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

## Validation and remaining scope

`npm run test:unit` covers auth forms, private routing, membership/capability guards, forged identity fields, origin checks, safe failures and workspace projections. `RUN_DATABASE_TESTS=true npm run test:database` tests real signed cookies through HTTP against disposable MariaDB databases, verified enrollment, owner-only updates, role changes, revocation, sign-out and tampering, alongside existing transactional/concurrency tests. The ordinary integration suite explicitly skips MariaDB unless opted in. Component tests cover localized forms and workspace states, and Playwright checks tenant navigation, responsive layout, hydration, keyboard focus and axe scans at desktop/tablet/mobile widths.

Email verification delivery, password recovery delivery, Google/username auth, administrator OTP/MFA, invitations, bootstrap tooling and a full workspace/editor UI remain separate work. Verification/recovery providers are not configured, so new self-service accounts cannot complete verified enrollment yet. Existing verified users and provisioned memberships can use these routes. No production deployment or live-account mutation is included.

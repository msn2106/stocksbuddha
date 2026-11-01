# Platform owner, RA Admin and team access

The login identity is global. The selected login section determines the intended destination, while current database roles determine access. Selecting Organisation never grants a role or enrolls the user as an investor.

## Routes and roles

| Route                        | Access / purpose                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `/workspace/login`           | Platform-owner sign-in; no public platform-owner signup                                                   |
| `/workspace/verify-email`    | Verify the shared platform identity, returning to platform login; no RA context or role grant             |
| `/workspace/forgot-password` | Send platform password recovery email                                                                     |
| `/workspace/reset-password`  | Reset the shared password using a platform-path HttpOnly token cookie                                     |
| `/workspace`                 | Verified platform owner only; blank workspace shell                                                       |
| `/workspace/organisations`   | Create a draft organisation and invite its first RA Admin, or invite an admin to an existing organisation |
| `/ra/:slug/login`            | Same URL with Investor / Organisation radio capsule                                                       |
| `/ra/:slug/account`          | Investor account shell, requiring an active tenant membership                                             |
| `/ra/:slug/workspace`        | Organisation shell, requiring active `owner`, `analyst` or `support` membership                           |
| `/ra/:slug/workspace/team`   | RA Admin invitations and delivery state                                                                   |
| `/ra/:slug/invitation`       | Inspect and explicitly accept a valid invitation using the invited verified identity                      |
| `/workspaces`                | Authenticated cross-RA chooser; links investors to account and staff to workspace                         |

The database tenant role `owner` is labelled **RA Admin** in the organisation UI. It is distinct from `auth_users.platform_role='owner'`, labelled **Platform owner**. Existing analyst/support/subscriber roles retain their meaning. Platform ownership does not implicitly create tenant membership. Only platform owners can appoint or change RA Admin grants, including through the existing membership PATCH API. An RA Admin can invite analysts/support solely to their own active organisation; other team members cannot invite or promote users.

On the tenant login form, Investor leads to the investor account or verified subscriber enrollment. Organisation leads only to a staff workspace; an account without a staff role gets an access message and the newly created login session is revoked. Existing staff are never demoted by investor enrollment. The platform login independently checks the current stored platform role and verification state.

The authenticated overview intentionally has a blank main area, brand logo/name, left navigation and a top-right Profile control. The profile shows name, email, verification, current role and organisation. Research, documents and settings navigation entries are disabled and marked Coming soon. Organisations and Team are functional management pages for the appropriate roles. RA Admins also see **Edit website** at `/ra/<slug>/workspace/website`; platform ownership alone and investor/staff access do not grant editor permissions. See the [website editor](WEBSITE_EDITOR.md). The sidebar collapses on narrow screens; the profile uses the existing Radix dialog primitive with focus restoration and Escape handling. Shared English/Hindi labels and existing fonts/colours are reused.

## First platform owner: explicit operator bootstrap

Use an existing global account for the first owner. There is no public owner signup: creating a tenant investor account is not a required owner-onboarding step. For an existing unverified identity, open `/workspace/verify-email`, submit its email, and follow the configured Hostinger SMTP link back to `/workspace/login`. Verification does not assign any role or tenant membership. Then, from an authorised operator checkout with the intended database credentials:

```sh
npm run db:migrate -- --target dev
npm run auth:bootstrap-owner -- --email your-verified-email@example.com --target dev
npm run dev
```

The CLI requires `DB_ENV` to match the explicit `--target`. It only assigns an existing verified identity, refuses replacing another platform owner, is repeatable for the same owner, and writes a platform audit event. It never creates a password or marks an email verified. No public bootstrap or platform-role assignment endpoint is exposed. No local real account is promoted automatically by migrations or application startup. The operator command runs from the source checkout; it is not part of the standalone migration CLI artifact.

Open `/workspace/login` and use the existing email/password after bootstrap. The login links to `/workspace/verify-email` and `/workspace/forgot-password`; recovery stays under `/workspace` and never redirects to an RA join page. Successful password reset returns the platform sign-in form and does not grant access. Platform and tenant reset cookies have separate names and paths; raw reset tokens are removed from the URL before rendering. These public recovery pages deliberately work before platform-role assignment, but the protected workspace still checks the verified, current stored owner role. Restart the development process after changing `SMTP_USER`, `SMTP_PASSWORD` or `AUTH_EMAIL_FROM` in `backend/.env`, because the email adapter is configured at startup.

Open `/workspace` to sign in. Local fixture mode cannot authenticate owners or send invitations. Administrator MFA is still a separate production-readiness requirement; this change does not implement MFA.

## Organisation setup and invitations

The platform owner enters the organisation name, legal name, unique slug, brand initials and RA Admin email. The organisation is created as `draft`, with no public website or fabricated research content. An invitation is issued for the intended email and the server-stored role `owner`. Once the verified recipient explicitly accepts, membership is created/promoted and the organisation becomes active in the same transaction. Website publication is an explicit action in the RA owner editor; activation alone does not create a public page. Existing demo organisations can receive explicit admin invitations without recreating their identities.

Invitations do not pre-create passwords or duplicate an existing global identity. A new recipient creates an account through the invitation page, verifies the invited email via Hostinger SMTP, signs in, then accepts. Existing users sign in with their existing credentials and accept. The invitation remains in a tenant-path HttpOnly, SameSite=Lax cookie while verification/login completes. The raw credential is removed from the URL on first inspection and never put into hydration data or the invitation listing. Cookies are Secure on HTTPS and contain no role grant; the server rechecks the stored invitation on acceptance.

Migration `CreateOrganisationInvitations1793491200011` adds `organisation_invitations`. It stores a SHA-256 token digest, tenant, normalized email, role, issuer, one-hour expiry, delivery state and acceptance/revocation state. Raw tokens are sent only to the recipient through the existing bounded Hostinger SMTP adapter. Issuing another invitation for the same tenant/email revokes older pending invitations. Delivery failures retain safe state; sending again creates a new credential rather than recovering a stored bearer token. No provider response or secret is included in errors.

Acceptance requires a current session, verified matching email, exact tenant, unexpired unused/unrevoked invitation and an issuer whose current permissions still authorize the grant. The transaction locks affected users in sorted order, then tenant and invitation/membership records, preserving existing staff roles and denying revoked memberships. Concurrent acceptance creates one membership and consumes the grant once. An invitation cannot reactivate revoked staff, grant platform ownership, overwrite an existing RA Admin with a lower role, or grant access to a different tenant. Creation, invitation issuance and acceptance write audit events atomically with their respective database mutations. Email delivery occurs after commit and is not an atomic part of that transaction.

Organisation creation and admin-email delivery are separate operations: a delivery failure can leave a draft organisation. Refresh Organisations, select that existing organisation and send its admin invitation again. Duplicate slugs are rejected; no hidden destructive cleanup occurs.

## Verification

TDD began with failing policy, service, bootstrap and React shell tests. Unit tests exercise role/destination separation, tenant-scoped invitation permissions, hashing, delivery state, verified recipient binding, single-use/expiry denial, staff-role preservation and operator bootstrap. MariaDB integration tests use disposable databases to verify actual constraints, draft activation, cross-tenant denial, concurrent acceptance and issuer/membership revocation.

```sh
npm run test:unit
npm run test:coverage
RUN_DATABASE_TESTS=true npm run test:database
npm run build
npm run test:e2e
npm run test:e2e:organisations
```

The organisation Playwright suite needs local dev administrative database credentials (`DB_ROOT_PASSWORD` in ignored `backend/.env`) to create and remove only disposable `sb_test_*` databases. It captures verification/invitation emails in memory and never sends real messages. Its test-only server creates verified fixture accounts and a fixture platform owner; those grants do not touch the configured application database. It checks real owner/admin/team navigation, profile dialogs, role denials, responsive screenshots, hydration and axe accessibility. The fixture disables credential rate limits to avoid shared test traffic buckets; dedicated auth integration tests continue to verify the production limiter.

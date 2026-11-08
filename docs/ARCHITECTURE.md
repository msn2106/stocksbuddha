# Multi-tenant website architecture — public renderer and database foundation

## Implemented boundary

One application serves `/ra/stocksbuddha`, `/ra/alpha`, and `/ra/beta`. The old `/ra/stocks-buddha` public address redirects permanently (308), preserving the query string. The root `/` renders a separate English/Hindi platform brand website without resolving a tenant. Its public RA sign-in form takes an explicit slug; platform-owner access remains at `/workspace/login`. See [platform routes and indexing](PLATFORM_WEBSITE.md). Slugs are addresses, while UUID tenant IDs own data.

`backend/src/main.ts` composes the adapters and HTTP/SSR runtime. `backend/src/tenancy/resolve-public-site.ts` resolves a request using injected asynchronous repository interfaces. It validates the exact path, resolves an active tenant, fetches that tenant's published website, checks ownership/publication again, selects one enabled language and returns a public projection. No module-level current tenant or browser-selected tenant authorizes a request. Unknown paths return 404; arbitrary tenant headers/query IDs have no authority. Backend failures produce an error, not another tenant's site.

## Modules and data ownership

| Module                              | Responsibility                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/contracts/src/tenancy.ts` | Immutable tenant identity, canonical slug, lifecycle and public legal profile        |
| `packages/contracts/src/website.ts` | Validated revision, tenant ownership, branding, languages and layout                 |
| `packages/contracts/src/content.ts` | Stable tenant-content fields supported by website sections                           |
| `backend/src/tenancy/`              | Repository contracts and request-scoped public resolution                            |
| `backend/src/tenants/`              | Validated tenant seed adapter                                                        |
| `backend/src/websites/`             | Validated website seed adapter and per-tenant/per-language content                   |
| `backend/src/access/`               | Tenant membership/capability and separate platform-role policy                       |
| `frontend/src/locales/`             | Shared UI translations, accessibility controls and application-owned disclosure text |
| `frontend/src/platform/`            | Tenant-independent platform homepage, audience entry points and localized brand copy |
| `frontend/src/websites/`            | Approved page components, template presentation and configured section rendering     |
| `database/`                         | MariaDB schema, locked migration runner, release manifest and repeatable dev seeds   |
| `backend/src/database/`             | Persistent repositories and internal transactional tenant/publication operations     |
| `backend/src/auth/`                 | Better Auth sessions, account pages and membership-protected workspace routes        |

The public frontend receives a tenant profile and exactly one published website revision with only the selected language's content. It does not receive the tenant registry, draft revisions, other tenants' copy or every translation. SSR metadata and hydration use that same projection. Website content values are text, never HTML, executable configuration, CSS or translation identifiers. Authentication/accessibility UI keys cannot be overridden; approved optional public copy overrides can customize navigation, footer and disclosure text. Bootstrap JSON escapes script delimiters.

## Independent websites

Each website revision owns its theme, approved font choice, template, ordered sections, default/enabled languages and complete content for every enabled language. Stocks Buddha/Alpha use the classic template; Beta uses editorial, a sans heading style, places About before Research, and omits the optional principles strip. Template choice also changes hero composition. Components are shared; content and composition belong to the tenant.

The renderer follows configured DOM order, including keyboard/reading order. Arbitrary component names, colors outside hex syntax, unapproved content keys, duplicate sections and incomplete enabled translations are rejected. Currently Hero must be first; Research, Approach, About, Expectations, Plans and Investor information are required to preserve navigation and the preview's disclosure areas. Principles and FAQ are optional. Header navigation, approved public copy, footer presentation, safe image URLs and section presentation can be configured; authentication and accessibility controls stay application-owned. This is a validated template/section foundation, not an unrestricted visual editor or a legal compliance certification.

Only English and Hindi are platform-supported today. Each tenant can enable either or both and choose its default. Unsupported/disabled requested languages resolve to that tenant's default as a complete page; translations are not borrowed from another tenant or mixed field by field. The language cookie uses an immutable tenant ID in its name, a tenant-specific path, no parent-domain attribute, and Secure on HTTPS. Query language takes precedence. Display accessibility preferences intentionally remain device-wide; they contain no tenant business data.

## Access model

Identity, authentication provenance and membership are separate. `auth_users.signup_tenant_id` is the first signup origin, `auth_sessions.login_tenant_id` is session creation origin, and database triggers retain signup/login audit history. These nullable fields never determine the current tenant or grant access. See [authentication provenance and backfill](AUTHENTICATION.md#signup-and-login-ra-provenance). Platform administration and RA membership are separate. A platform owner does not automatically become a member of every tenant. The permission policy requires an authenticated identity, active tenant, matching active membership and the requested capability. Owner, analyst, support and subscriber roles have explicit capabilities; revocation/suspension denies access.

MariaDB mode mounts Better Auth, private workspace overview routes and membership APIs. Each private request checks the persistent session and current membership; membership mutations also reauthorize inside their transaction. See [authentication routes and configuration](AUTHENTICATION.md). The access module defines capabilities; future business endpoints must enforce them too. Every future protected endpoint must derive its principal from a verified server session, resolve tenant context server-side, enforce the applicable policy and scope resource reads/writes by tenant ID. A route slug, hidden button or body/header tenant ID is never sufficient authorization. Subscriber research also needs purchase/access entitlements beyond membership.

The authenticated shell separates platform-owner `/workspace`, tenant staff `/ra/:slug/workspace` and investor `/ra/:slug/account` destinations. Current database roles, not the login capsule, authorize each route. RA Admin is the UI label for tenant `owner`; platform ownership stays separate. Durable tenant/email-bound invitations are accepted transactionally and delivered through Hostinger SMTP; see [organisation access](ORGANISATION_ACCESS.md).

## Persistence and editing

The server selects MariaDB repositories through `DATABASE_MODE=mariadb`, or read-only fixtures for explicit preview use. MariaDB mode checks schema history, never migrates during startup and never falls back to fixtures. Production defaults to MariaDB; fixture previews require explicit opt-in. See [setup](../database/README.md) and [implementation/runbook](DATABASE_IMPLEMENTATION.md).

Twelve tables consolidate tenant profile/settings, membership profile and complete website snapshots while retaining separate authentication and migration metadata. Composite tenant/revision and actor relationships prevent foreign-tenant links. Public rendering follows the explicit publication pointer and frozen public profile, not administrative working values or the highest historical revision. Unpublished/suspended tenants stay unavailable.

Internal services support partial drafts, optimistic saves, explicit rebase, complete atomic publication, retry receipts, membership lifecycle, last-owner protection and atomic managed-tenant provisioning. They validate stored sessions and lock current permission state; owner-only website endpoints now call the draft/save/publish methods with authenticated tokens and tenant context. Authentication storage, signed-cookie HTTP routes and membership mutations are integration-tested. Tenant-scoped React signup/login and workspace overview pages share the public SSR pipeline and styles; Hostinger SMTP verification/recovery is configured separately; the owner website editor provides private saved preview and publication. Username/administrator OTP plugins and additional identity-provider transports remain gated future work.

Published snapshots stay immutable through application operations. Version 1 is supported; unknown versions fail closed. Future schema writers require compatible readers before rollout. Shared contracts for the existing public renderer remain stable; database adapters project the frozen snapshot into them. DB queries use a bounded pool and parameter binding. See [reviewed schema](DATABASE_DESIGN.md) for field sizes and invariants, and the implementation document for resolved differences and test scope.

## Hosts and environments

Planned production: `https://stocksbuddha.com/ra/<slug>`. Planned development: `https://dev.stocksbuddha.com/ra/<slug>`. Both can run this code, with separate deployments, databases, credentials, host-only session cookies and provider sandbox/live configuration. Keep development access protected and noindex. All pages default to noindex/no-store; only the root platform page supports an explicit production indexing opt-in. RA websites, private pages and previews retain their restrictions. No hosting/DNS change is included.

Custom-domain resolution is not implemented. Add verified domain-to-tenant mappings later, retaining immutable tenant ownership. Resolve allowed host/path combinations explicitly and reject conflicts; never trust forwarded host headers without a configured proxy boundary. Build navigation from a resolved public base URL when custom domains arrive. Current path tenants share a browser origin, so arbitrary tenant scripts are excluded. Review custom-domain routing support and app quotas on the selected host before offering it commercially.

No public cache exists. If introduced, its key must include tenant ID, revision and locale. Published public content and authenticated/private responses must have separate caching policies.

## Verification and limits

Testing is split into unit, integration and browser suites, with shared recursive discovery and per-file unit coverage. The public Express application factory is separate from startup; its resolver/renderer adapters and the startup Vite/Nest boundaries can be controlled in unit tests. Contracts own their validation and serialization suite. See [testing architecture](TESTING.md) for commands, fixtures, coverage boundaries and CI.

Run `npm run verify`. Unit tests cover tenant ownership, statuses, draft privacy, defensive repositories, localized publication validation and permission denials. Playwright covers canonical redirects, public API projections, conflicting tenant hints, independent tab/language state, different template/section order, mobile reflow, English/Hindi accessibility and existing page interactions.

Unit and fixture-based browser tests establish the public boundaries and policy behavior. The opt-in MariaDB suite verifies persistent constraints, authenticated internal operations, mounted signed-cookie authentication and workspace membership isolation locally. These checks do not establish account recovery, production capacity, compliance, provider integrations or Hostinger readiness.

## Role exclusivity

One global email/password identity has at most one membership and one current role within an RA. Subscriber and organisation staff access are mutually exclusive; capsules do not grant or convert roles. Staff cannot enter subscriber dashboard/enrolment paths, and subscribers cannot join staff by invitation. The same identity may have a different role in another RA. Authorization and transaction checks enforce both directions, including legacy links, APIs and concurrent enrolment/acceptance. See [role exclusivity](ROLE_EXCLUSIVITY.md).

## Private documents

The authenticated route layer mounts private document endpoints before general JSON parsing so uploads can use bounded raw PDF/JPEG/PNG bodies. `DocumentService` rechecks current MariaDB session, tenant and membership facts, stores document metadata and audit events, and uses `GoogleDriveStorage` for private file bytes. Platform documents remain separate from tenant/customer scope. Workspaces expose Documents pages in English/Hindi, including per-customer recommendation evidence and KYC/MITC. Provider object IDs and tokens never enter page hydration or HTTP metadata projections. See [configuration, access matrix and non-atomic Drive/SQL recovery](GOOGLE_DRIVE.md).

Drive labels follow `<RA display name>/General/` and `<RA display name>/Customer/<membership UUID>/`; customer KYC/MITC files sit directly in the membership folder, while recommendation evidence goes into `ForYouByRA/`. The app-private `stocksbuddhaTenantId` property owns the RA folder independently of its visible label. Existing UUID-named RA folders are adopted/renamed in place on upload; existing document downloads use recorded object/parent IDs and require no bulk move. See the [folder naming and compatibility rules](GOOGLE_DRIVE.md#folder-structure-and-naming-pattern).

Document authorization is checked both in scoped SQL and against each returned document's tenant/customer fields. List cursors must identify a document visible to the same actor; foreign customer/tenant cursors are rejected without projecting their metadata. Platform ownership has no implicit document privilege inside an RA. The recommended scoped, expiring, RA-approved support-access process is a proposal only; current behavior and storage-administrator limits are documented in the [document access policy](GOOGLE_DRIVE.md#document-access-guarantees-and-lifecycle).

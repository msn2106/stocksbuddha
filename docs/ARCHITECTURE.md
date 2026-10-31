# Multi-tenant website architecture — S0.2

## Implemented boundary

One application serves `/ra/stocksbuddha`, `/ra/alpha`, and `/ra/beta`. The old `/ra/stocks-buddha` public address redirects permanently (308), preserving the query string. The root currently redirects to the demo; a future platform marketing homepage can replace that redirect. Slugs are addresses, while UUID tenant IDs own data.

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
| `frontend/src/websites/`            | Approved page components, template presentation and configured section rendering     |
| `database/`                         | Future migrations and persistent seeds; no live database adapter yet                 |

The frontend receives a tenant profile and exactly one published website revision with only the selected language's content. It does not receive the tenant registry, draft revisions, other tenants' copy or every translation. SSR metadata and hydration use that same projection. Website content values are text, never HTML, executable configuration, CSS or translation identifiers. Shared UI keys cannot be overridden by tenant content. Bootstrap JSON escapes script delimiters.

## Independent websites

Each website revision owns its theme, approved font choice, template, ordered sections, default/enabled languages and complete content for every enabled language. Stocks Buddha/Alpha use the classic template; Beta uses editorial, a sans heading style, places About before Research, and omits the optional principles strip. Template choice also changes hero composition. Components are shared; content and composition belong to the tenant.

The renderer follows configured DOM order, including keyboard/reading order. Arbitrary component names, colors outside hex syntax, extra content keys, duplicate sections and incomplete enabled translations are rejected. Currently Hero must be first; Research, Approach, About, Expectations, Plans and Investor information are required to preserve navigation and the preview's disclosure areas. Principles and FAQ are optional. Shared header/footer/accessibility controls remain outside tenant section configuration. This is a validated template/section foundation, not an unrestricted visual editor or a legal compliance certification.

Only English and Hindi are platform-supported today. Each tenant can enable either or both and choose its default. Unsupported/disabled requested languages resolve to that tenant's default as a complete page; translations are not borrowed from another tenant or mixed field by field. The language cookie uses an immutable tenant ID in its name, a tenant-specific path, no parent-domain attribute, and Secure on HTTPS. Query language takes precedence. Display accessibility preferences intentionally remain device-wide; they contain no tenant business data.

## Access model

Platform administration and RA membership are separate. A platform owner does not automatically become a member of every tenant. The permission policy requires an authenticated identity, active tenant, matching active membership and the requested capability. Owner, analyst, support and subscriber roles have explicit capabilities; revocation/suspension denies access.

**No session authentication or protected business endpoint exists yet.** The access module is a tested policy contract for the next slice, not an authorization system already protecting an editor. Every future protected endpoint must derive its principal from a verified server session, resolve tenant context server-side, run this policy and scope resource reads/writes by tenant ID. A route slug, hidden button or body/header tenant ID is never sufficient authorization. Subscriber research also needs purchase/access entitlements beyond membership.

## Persistence and editing next

The current adapters are defensive, read-only synthetic fixtures. Interfaces are asynchronous so MySQL adapters can replace them without changing public rendering. No tenant provisioning, durable edits, transactional publishing, sessions or customer data exists yet.

Persistent tables should separate tenants, identities/accounts/sessions, tenant memberships, website revisions and localized revision content. Enforce unique tenant slugs, unique `(tenant_id, revision)`, unique `(tenant_id, user_id)` memberships, and composite tenant/revision foreign keys for content and future assets. Maintain an explicit published-revision pointer; update it atomically after validation and authorization. A publish must never expose a partially translated draft. Keep actor, tenant, revision and time in audit events. Last-owner protection and session revocation need transactional database-backed implementation/tests.

A future owner editor writes a tenant-owned draft, previews it through a protected route, then publishes an immutable validated snapshot. It must not directly mutate the current public revision. Credentials and private membership data never enter the public website contract.

## Hosts and environments

Planned production: `https://stocksbuddha.com/ra/<slug>`. Planned development: `https://dev.stocksbuddha.com/ra/<slug>`. Both can run this code, with separate deployments, databases, credentials, host-only session cookies and provider sandbox/live configuration. Keep development access protected and noindex. All current pages remain noindex/no-store; no hosting/DNS change is part of S0.2.

Custom-domain resolution is not implemented. Add verified domain-to-tenant mappings later, retaining immutable tenant ownership. Resolve allowed host/path combinations explicitly and reject conflicts; never trust forwarded host headers without a configured proxy boundary. Build navigation from a resolved public base URL when custom domains arrive. Current path tenants share a browser origin, so arbitrary tenant scripts are excluded. Review custom-domain routing support and app quotas on the selected host before offering it commercially.

No public cache exists. If introduced, its key must include tenant ID, revision and locale. Published public content and authenticated/private responses must have separate caching policies.

## Verification and limits

Testing is split into unit, integration and browser suites, with shared recursive discovery and per-file unit coverage. The public Express application factory is separate from startup; its resolver/renderer adapters and the startup Vite/Nest boundaries can be controlled in unit tests. Contracts own their validation and serialization suite. See [testing architecture](TESTING.md) for commands, fixtures, coverage boundaries and CI.

Run `npm run verify`. Unit tests cover tenant ownership, statuses, draft privacy, defensive repositories, localized publication validation and permission denials. Playwright covers canonical redirects, public API projections, conflicting tenant hints, independent tab/language state, different template/section order, mobile reflow, English/Hindi accessibility and existing page interactions.

These tests establish the implemented in-memory public boundaries and policy behavior. They do not prove database isolation, account recovery, authenticated authorization, production capacity or compliance. Those require the next persistent authentication slice and real-database acceptance tests.

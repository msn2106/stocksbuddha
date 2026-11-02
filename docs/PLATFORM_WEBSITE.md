# StocksBuddha platform website

The root `/` renders the platform brand website, independently of tenant resolution, publication and authentication availability. It no longer redirects to `/ra/stocksbuddha`. The existing Stocks Buddha RA remains a separate organisation at that address, with its own public profile, registration, website content and membership permissions. Platform copy never inherits an RA's registration or research claims.

## Navigation and access

| Address                                             | Purpose                                                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                 | Public platform website, in English or Hindi via `?lang=en` or `?lang=hi`                                                        |
| `/#contact`                                         | Demo enquiry instructions and an email link to support@stocksbuddha.com                                                          |
| `/#access`                                          | Explicit RA website-name entry and separate investor / RA Admin or team buttons                                                  |
| `/access?slug=<slug>&audience=organisation&lang=en` | Validates the slug and redirects to that RA's login; accepts investor/organisation audiences and en/hi languages; grants no role |
| `/login`, `/signin`                                 | Redirect to platform access, preserving supported `lang`                                                                         |
| `/signup`                                           | Redirect to demo enquiries; this is not an onboarding form                                                                       |
| `/ra/<slug>`                                        | Published RA website; existing tenant behavior is preserved                                                                      |
| `/ra/<slug>/login`                                  | Tenant login with Investor / Organisation audience selection                                                                     |
| `/ra/<slug>/workspace`                              | Membership-protected RA Admin/team workspace                                                                                     |
| `/workspace/login`, `/workspace`                    | Platform-owner sign-in and protected administration                                                                              |
| `/workspaces`                                       | Authenticated membership chooser; signed-out visitors return to platform access                                                  |

The website-name form uses the shared slug rules (2–48 characters, starting with a lowercase letter, then lowercase letters, numbers or hyphens; reserved names are rejected). Invalid input returns to a localized error in the access section. The destination login checks tenant availability; entering a slug never proves membership or grants access. Unknown tenants continue to return 404.

Demo requests open the visitor's email client. There is no submission backend, automatic onboarding, public platform-owner signup, pricing or payment flow. The platform owner still creates organisations and invites the initial RA Admin. Subsequent staff access follows the existing invitation and authorization rules. See [organisation access](ORGANISATION_ACCESS.md).

Platform brand links, generic not-found home links and the platform workspace's website link return to `/`. RA links continue to return to their own website. Global logout returns to platform access; tenant logout returns to that RA's login. Shared identity/session semantics do not change.

## Rendering and indexing

The platform has a distinct `PageData.page='platform'` SSR/hydration view, tenant-independent localized copy, metadata and scoped CSS. It renders without reading tenant/publication adapters, so an unavailable RA publication cannot replace the platform homepage. The `/api/ready` endpoint remains the database availability signal; a working homepage does not establish persistence readiness.

All pages default to `noindex,nofollow` and `no-store`, including the platform homepage. Set `BRAND_SITE_INDEXABLE=true` only for a production launch after reviewing the domain and content. The setting is effective only when `NODE_ENV=production` and `ALLOW_PUBLIC_PREVIEW` is not `true`. It enables `index,follow` in both the HTTP header and HTML metadata for the root platform page only; invalid-access error views remain non-indexable. Tenant websites, API responses, authentication, workspaces, private previews and errors retain their existing indexing restrictions. This setting does not deploy the app, change DNS, or enable indexing for RA websites.

Keep `AUTH_BASE_URL` as the exact shared origin (for example `https://stocksbuddha.com` in production). No subdomain, cookie-scope or authentication callback changes are needed for the root homepage. Hosting must route the root and existing `/ra`, `/workspace`, `/workspaces`, `/api` and `/assets` paths to the same application. The existing Hostinger site and live DNS are outside this local change.

## Verification

Unit tests cover platform SSR/metadata, tenant-free rendering, slug validation, entry-point redirects and indexing isolation. The normal integration suite checks HTTP routing. `npm run test:e2e` includes platform navigation, audience selection, tenant boundaries, English/Hindi screenshots at desktop/tablet/mobile widths, hydration errors, axe accessibility, keyboard navigation and 200% text sizing. The browser suite uses fixture mode; database-backed access tests remain separate.

## Account roles within an RA

Investor and Organisation entry points lead to mutually exclusive per-RA roles. One email cannot be both a subscriber and staff in the same RA. Staff use Organisation; subscribers use Investor; incompatible signup, invitations, direct URLs and APIs are rejected with appropriate guidance. A different RA can assign that global identity a different role. See [role exclusivity](ROLE_EXCLUSIVITY.md).

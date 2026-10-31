# RA website

Clean incremental rebuild of the reference application in `../website`. First slice: **S0.1 — tenant foundation and public landing pages**. This is a local development preview, not a production research service.

## Run

Use Node **24.22.0** (`nvm use`) and npm **11.19.1**, then:

```sh
npm ci
npm run dev
```

Open [Stocks Buddha](http://localhost:3000/ra/stocks-buddha), [Alpha demo](http://localhost:3000/ra/alpha), or [Beta demo](http://localhost:3000/ra/beta). `/` redirects to Stocks Buddha. Unknown/reserved tenant slugs and unsupported routes return HTTP 404, not another tenant’s content.

```sh
npm run typecheck
npm test
npm run build
npm start
# First time only:
npx playwright install chromium
npm run test:e2e
npm run format:check
```

The production build and development server both render public content and tenant metadata on the server, then hydrate the same validated data in React. One Nest/Express Node process serves the website and read-only API. Backend configuration is documented in `backend/.env.example`; provide values through the process environment (the example is not loaded automatically). `PORT` defaults to `3000`; `HOST` defaults to `127.0.0.1`. Set `HOST=0.0.0.0` in a future hosted environment if required by its runtime.

## Monorepo structure

This repository uses npm workspaces with one root lockfile and a shared dependency installation. Run the commands above from the repository root.

```text
stocksbuddha/
├── frontend/                 # @ra/frontend — React, styles, Vite, HTML and SSR renderer
│   ├── src/
│   └── dist/                 # Generated client/ and server/ builds
├── backend/                  # @ra/backend — Nest/Express API and tenant resolution
│   ├── src/tenants/           # Public tenant fixtures and lookup logic
│   ├── tests/                # Tenant unit tests
│   ├── .env.example
│   └── dist/                 # Generated Node server
├── packages/
│   └── contracts/            # @ra/contracts — shared public schemas, types and serialization
├── database/
│   ├── migrations/           # Reserved for future reviewed migrations
│   └── seeds/                # Reserved for future database seeds
├── scripts/                  # Repo-wide verification and future operational scripts
├── docs/                     # Requirements, architecture and delivery evidence
├── tests/e2e/                # Cross-workspace browser acceptance
├── package.json              # Workspace registration and top-level commands
└── package-lock.json         # Single dependency lockfile
```

The frontend imports only `@ra/contracts`, never backend modules. Tenant records and path resolution belong to the backend. The shared contracts package contains public shapes, validation and safe serialization; no tenant registry or database access. Both build pipelines bundle this internal TypeScript package, so the production server does not execute raw workspace TypeScript.

`npm run build` checks all workspaces, builds frontend client/SSR assets, then builds the backend. `npm start` launches the backend, which serves the frontend on the same origin. Build outputs stay inside their owning packages. Server paths resolve from the module location and work when invoked from either the root or the backend workspace.

Useful focused commands:

```sh
npm run build --workspace @ra/frontend
npm run build --workspace @ra/backend
npm test --workspace @ra/backend
npm run typecheck --workspace @ra/contracts
npm run verify
```

`npm run dev` runs the backend with Vite middleware and React hot reload. The browser acceptance server uses port **3100**, separate from the normal preview on port **3000**, and always starts a fresh production server. `npm run verify` performs dependency policy/audit checks, formatting checks, unit tests, the production build/type checks, and browser tests in sequence.

See [database ownership](database/README.md), [repository scripts](scripts/README.md), and [S0.1 evidence](docs/S0.1.md).

## Dependency security policy

**Use npm only.** The root `package.json` declares `packageManager: npm@11.19.1`, enforces npm `>=11.19.1 <12`, and all workspaces share one committed `package-lock.json`. Do not add Yarn, pnpm, Bun, or nested lockfiles.

The checked-in [.npmrc](.npmrc) sets:

- `min-release-age=7`: npm excludes registry versions published less than seven days ago when resolving new dependencies, including transitive dependencies. No release-age exclusions are configured. [Official npm configuration reference](https://docs.npmjs.com/cli/v11/using-npm/config/#min-release-age).
- `save-exact=true`: new dependencies are saved as exact versions. All repository-owned dependency declarations and overrides must use exact versions, including local workspace references such as `@ra/contracts: 0.1.0`.
- `engine-strict=true`, `package-lock=true`, and auditing at every vulnerability severity.

Install from the repository root, using workspace targeting where needed:

```sh
npm ci
npm install package-name --workspace @ra/frontend
npm install --save-dev package-name --workspace @ra/backend
npm run security:check
npm run verify
```

`npm ci` reproduces the committed lockfile; `npm install` resolves additions/updates under the age policy. Review and commit both manifests and lockfile after dependency changes. Exact direct versions do not pin transitive dependencies by themselves; the lockfile does.

The root `preinstall` hook checks npm selection, exact versions, one-lockfile ownership, and effective inherited configuration. `npm run security:check` runs the policy check and `npm audit` for every workspace **and the root**, including production, development and optional dependencies. It fails on any reported vulnerability and on audit/network errors. This check is also the first step of `npm run verify`.

Do not bypass the policy with release-age exclusions, `--before`, a relaxed age setting, `--ignore-scripts`, `--force`, or another package manager in normal installs. npm command-line/environment overrides and skipped lifecycle hooks can bypass repository defaults; these controls are guardrails, not an immutable security boundary. If an urgent security fix is younger than seven days, surface the conflict and review it explicitly rather than silently relaxing the policy. Do not use `npm audit fix --force`.

**Audit baseline, 31 October 2026:** zero known vulnerabilities across the full workspace lockfile, including development dependencies. Re-run the audit whenever dependencies change and before release; a clean audit does not detect every malicious or previously unknown package issue.

## Accessibility and languages

The website supports English/Hindi through the visible language links (`?lang=en` / `?lang=hi`), including server-rendered content and metadata. Display preferences offer larger text up to 200%, high contrast, reduced motion and reset. Body copy defaults to 18px; controls and disclosures use at least 16px. Language and display preferences are remembered when browser cookies/storage are available.

Translations live in separate `frontend/src/locales/en.json` and `hi.json` files with stable keys such as `nav.subscribe`, referenced through `t("nav.subscribe")`. Type checking and frontend tests verify catalogue keys and placeholders. Only English/Hindi are enabled; see [how to maintain translations and add a language](docs/I18N.md).

Playwright covers translation, keyboard focus, dialog behavior, persistence, text enlargement, responsive reflow and axe accessibility scans. See [accessibility implementation and verification](docs/ACCESSIBILITY.md). Hindi financial/legal text still needs RA approval, and professional accessibility auditing plus the real accessibility contact/grievance channel remain launch requirements. Automated tests are not compliance certification.

## Boundaries

Seed profiles and published revisions currently live in source. There is **no database persistence, editing, authentication, authorization proof, payment, signup, or deployed infrastructure** yet. No customer records are stored. The read-only public API exposes only public seeded fields. Do not add private data to that contract.

Stocks Buddha details reproduce the owner’s supplied brand, legal name and registration string; verification and approved content remain prerequisites for launch. Alpha and Beta are explicitly synthetic and use no registration credentials. The monogram and portrait area are placeholders. No invented pricing, testimonials, performance results, or research recommendations appear.

All preview pages use `noindex` and `no-store`. Google Fonts are optional network enhancements with local serif/sans fallbacks. Revisit font self-hosting and the content security policy before production. Path tenancy separates resolution, not browser origins; authorization must be implemented on every future protected request.

Next: MySQL schema/migrations and Better Auth proof, then server-authorized owner customization with draft/publish history. Keep the reference project intact. No deployment or changes to the existing Hostinger site are included.

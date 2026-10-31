# Repository scripts

`verify.mjs` runs dependency policy/audit checks, formatting checks, unit tests, the complete production build (including type checks), and browser acceptance in order. Run `npm run verify` from the repository root. Install the Playwright Chromium browser first with `npx playwright install chromium`.

Keep future repo-wide development, release, and deployment helpers here. Package-specific build commands belong in their workspace's `package.json`; database migrations and seeds belong in `database/`.

`check-dependency-policy.mjs` uses only Node built-ins and checks package manager configuration, exact dependency versions, and lockfile ownership. It runs on `preinstall` and through `npm run security:policy`. Policy regression tests use disposable directories and a local mock registry; they verify rejection of a one-day-old package, acceptance of an eight-day-old package, exact version saving, and rejection of weakened settings.

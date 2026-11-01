# Sentry monitoring

## Current status — 1 November 2026

The application runs locally only. No Hostinger or other production deployment has been configured, and no production uptime monitor has been created. Local development and a locally running production build have both been verified with real browser/server errors, logs, traces and readable TypeScript stack traces in Sentry. A production build running on a laptop is still a local verification, not a hosted deployment.

The `stocks-buddha` organization hosts two projects:

- [stocksbuddha-frontend](https://stocks-buddha.sentry.io/issues/?project=4512352833568848): browser exceptions, React 19 root errors and browser performance traces.
- [stocksbuddha-backend](https://stocks-buddha.sentry.io/issues/?project=4512352834093136): handled Express request/readiness errors, startup failures, unhandled Node exceptions, server traces and structured error logs. Nest hosts the Express application; the routes currently belong to Express, so the server uses `@sentry/node`.

SDK versions are pinned under the repository's seven-day release-age policy. Runtime initialization lives in `frontend/src/instrument.ts` and `backend/src/instrument.ts`. The server preloads instrumentation before importing application dependencies in both development and production. Missing DSNs disable initialization. The Express integration's automatic error capture is disabled because the application error hook reports those failures explicitly, avoiding duplicates. Shutdown flushes buffered events.

## Local setup

Copy the `SENTRY_*` values from [backend/.env.example](../backend/.env.example) into ignored `backend/.env`, and copy [frontend/.env.example](../frontend/.env.example) into ignored `frontend/.env.local`. Existing database settings must be retained. These files contain public DSNs, not authentication tokens. Both local files were configured during initial setup; merge changes rather than overwriting existing files.

From the repository root:

```sh
nvm use
npm ci
npm run dev
```

Open `http://localhost:3000/ra/stocksbuddha`. This starts the backend with Vite middleware; a separate frontend development server is unnecessary. For a fixture-only development preview without a local database, use `DATABASE_MODE=fixtures npm run dev`. For database-backed development, retain the database settings in `backend/.env`, set `AUTH_SECRET` and `AUTH_BASE_URL`, and follow [authentication setup](AUTHENTICATION.md) and [DATABASE_DESIGN.md](DATABASE_DESIGN.md).

### Frontend and backend environment settings

Use the same two Sentry projects for development and production, and filter by `environment` in Sentry. Separate Sentry projects for each environment are unnecessary for this setup. The frontend and backend DSNs differ; copy each from its own example file.

| Setting                                   | Local development                  | Production                         | When it takes effect |
| ----------------------------------------- | ---------------------------------- | ---------------------------------- | -------------------- |
| Frontend `VITE_SENTRY_DSN`                | Frontend project DSN               | Same frontend project DSN          | Vite startup/build   |
| Frontend `VITE_SENTRY_ENVIRONMENT`        | `development`                      | `production`                       | Vite startup/build   |
| Frontend `VITE_SENTRY_TRACES_SAMPLE_RATE` | `1`                                | `0.1` initially                    | Vite startup/build   |
| Frontend `VITE_SENTRY_RELEASE`            | `stocksbuddha@local`               | Deployed commit SHA                | Vite startup/build   |
| Backend `SENTRY_DSN`                      | Backend project DSN                | Same backend project DSN           | Node process startup |
| Backend `SENTRY_ENVIRONMENT`              | `development`                      | `production`                       | Node process startup |
| Backend `SENTRY_TRACES_SAMPLE_RATE`       | `1`                                | `0.1` initially                    | Node process startup |
| Backend `SENTRY_RELEASE`                  | `stocksbuddha@local`               | Same deployed commit SHA           | Node process startup |
| Backend `NODE_ENV`                        | Unset or `development`             | Set by `npm start` to `production` | Node process startup |
| Build `SENTRY_AUTH_TOKEN`                 | Optional; required to test uploads | Required for source-map uploads    | Build only           |

Restart the dev server after frontend configuration changes. Rebuild and redeploy browser assets after production frontend changes: changing only the server's runtime environment cannot change values already compiled into the browser bundle. Restart the backend after changing its runtime settings.

Vite reads `frontend/.env.local` in both development and production mode. Before building production locally, either set all four `VITE_SENTRY_*` values in the build process environment or create an ignored `frontend/.env.production.local` with production values. Mode-specific files override generic files, and pre-existing process variables override both. Do not assume `NODE_ENV=production` changes an explicit `VITE_SENTRY_ENVIRONMENT=development` or a sample rate of `1`. See [Vite environment precedence](https://vite.dev/guide/env-and-mode).

The backend currently loads only optional `backend/.env`; it does not automatically select `.env.production` or `.env.development`. Use the hosting platform's runtime environment for production and exclude local env files from deployment. The startup command's `--env-file-if-exists` retains values already supplied by the process environment.

Request bodies, headers, cookies, URL query parameters and automatic user identity collection are disabled. Database parameter/result collection is also disabled on the server. Exception messages and source context still reach Sentry; avoid putting secrets in thrown errors or explicit logs. Expected 404 responses are not reported as failures. Session replay and feedback widgets are not enabled.

Local tracing defaults to 100%; production defaults to 10% unless overridden. Local example files explicitly set 100%, so change that value for a hosted deployment. Errors are captured independently of the trace sampling rate.

## Production builds and source maps

Store an organization auth token in the ignored repository-root `.env.sentry-build-plugin` file as `SENTRY_AUTH_TOKEN=...`, or provide `SENTRY_AUTH_TOKEN` through the build environment. Never prefix this secret with `VITE_`, commit it, or paste it into chat. Both bundler configs load this optional file without printing its contents.

With the token present, `npm run build` uploads client source maps to `stocksbuddha-frontend` and SSR/backend source maps to `stocksbuddha-backend`. The Vite plugin uploads hidden maps and removes them afterward. The backend uses Sentry CLI in tsup's success hook to inject debug IDs and upload the completed files; uploading inside esbuild's earlier hook would run before tsup writes its output. Backend maps remain beside the private server bundle for Node's `--enable-source-maps`; they are not served as browser assets. Upload failures fail the build.

Without a token, builds succeed, browser maps are not generated, and source-map uploads are skipped. Minified browser stack traces then lack original source context. Source maps include source code, so uploads are restricted to the selected client, SSR and backend build directories.

### Example production build and start

Configure the frontend project DSN as `VITE_SENTRY_DSN` in the build environment first. Provide the upload token through the build secret store, or the ignored local build-token file. Then run from the repository root:

```sh
export SENTRY_RELEASE="$(git rev-parse HEAD)"
export VITE_SENTRY_RELEASE="$SENTRY_RELEASE"
export VITE_SENTRY_ENVIRONMENT=production
export VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
npm ci
npm run build
```

In CI without Git metadata, use the pipeline's commit SHA for both release variables. Preserve that exact release value when starting the deployed server. Configure `SENTRY_DSN` with the backend DSN, database credentials and the production database settings through the host's runtime environment, then start with:

```sh
export SENTRY_ENVIRONMENT=production
export SENTRY_TRACES_SAMPLE_RATE=0.1
export HOST=0.0.0.0
# SENTRY_RELEASE must match the commit SHA used to build the browser assets.
# Retain the PORT supplied by the host; do not replace it with a fixed local port.
npm start
```

For a local production-mode preview without a database, the explicit preview opt-in is `DATABASE_MODE=fixtures ALLOW_PUBLIC_PREVIEW=true npm start`. This is a demonstration mode; use MariaDB and production data for the actual service.

### CI configuration

Add repository secret `SENTRY_AUTH_TOKEN` in GitHub Actions. The checked-in [verify workflow](../.github/workflows/verify.yml) passes it on trusted push builds and supplies the same commit SHA as `SENTRY_RELEASE` and `VITE_SENTRY_RELEASE`; pull-request builds skip uploads. Adding a local token file does not create the GitHub secret.

The verify workflow tests and builds the repository; it does not deploy it or set production DSNs. A future release pipeline must explicitly supply the frontend production variables before building and the backend production variables when starting the service. Local env files are ignored by Git and will not be present in a fresh CI checkout. If the host rebuilds the application itself, configure the build variables and upload token there as well; source maps must correspond to the exact build being deployed.

## Deploying later on Hostinger or another platform

The current app renders HTML on the server and serves the read-only API and browser assets from one Nest/Express Node process. Deploy the complete application as a Node service. Uploading only `frontend/dist/client` to static hosting will not provide the SSR pages or API. Keeping one origin also matches the current frontend trace propagation configuration. A split-origin deployment would need explicit API routing, CORS and trace-propagation changes.

### Hostinger preparation

At deployment time, confirm the selected Hostinger plan supports a persistent Node application and the required runtime. Hostinger's [Node deployment guide](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/) documents managed Node hosting and VPS options; available settings must be checked against this monorepo rather than accepting a frontend-only preset. This repository requires Node 24 and npm 11.19.1, with exact requirements in the root `package.json` and `.nvmrc`.

Use these repository requirements when configuring the host:

| Deployment setting    | Required configuration                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project/build root    | Repository root, including npm workspaces and the root lockfile                                                                                                                       |
| Install               | `npm ci`, with build-time dev dependencies available                                                                                                                                  |
| Build                 | `npm run build`, with frontend production variables, matching release IDs and the Sentry upload token                                                                                 |
| Start                 | `npm start`, preserving the Sentry preload and Node source-map flags in the backend workspace script                                                                                  |
| Network               | Platform-assigned `PORT`; `HOST=0.0.0.0` where required by the host                                                                                                                   |
| Runtime configuration | Backend production Sentry variables, database configuration, `AUTH_SECRET` and HTTPS `AUTH_BASE_URL`; no build upload token is needed at runtime                                      |
| Build output          | Keep `backend/dist`, `frontend/dist/client`, `frontend/dist/server`, the compiled database CLI/manifest and required npm workspace/runtime files in their expected relative locations |
| Health checks         | `/api/health` for process liveness and `/api/ready` for database readiness                                                                                                            |

If a managed hosting preset cannot preserve the workspace layout, custom build/start commands or Sentry preload, prepare a compatible deployment package or use a VPS/container-capable host. Resolve that packaging before enabling automatic deployment.

### Before the first hosted release

1. Configure the Node service, domain and HTTPS. Keep backend bundles, backend source maps and secret files outside the public static document root.
2. Provision the production MariaDB database and separate production credentials. This repository requires `DATABASE_MODE=mariadb`, `DB_ENV=prod`, a matching database name such as `stocksbuddha_prod` (an account prefix is allowed), and verified TLS with `DB_TLS=true`; configure `DB_TLS_CA` if required. Confirm the host's database meets these requirements. See [database design and operations](DATABASE_DESIGN.md) for migrations and production configuration. Application startup never runs migrations automatically.
3. Supply build and runtime variables from the table above. Use the same release SHA on the browser, server and uploaded build artifacts. Keep the upload token in the build secret store, and database credentials in the runtime secret store.
4. Run the repository checks and resolve release blockers before publishing. At initial Sentry setup, the security gate reported 17 moderate dependency advisories involving `glob`/`minimatch`; recheck the current audit at deployment time. The MariaDB integration test also needs an actual configured database; it was skipped during the local Sentry verification.
5. Build, confirm source-map uploads succeeded, and deploy that exact output. Check HTTPS, `/api/health`, `/api/ready`, the public tenant pages and API responses.
6. Verify a controlled browser error and server error through the hosted app, confirm `environment=production`, matching release IDs and readable source lines in the respective Sentry projects, then remove any temporary triggers. Check that normal requests generate traces and server failures generate structured logs.
7. Configure production-scoped error alerts and, once a stable public URL exists, an uptime monitor. Neither has been created by this local setup. Review sampling and Sentry usage after real traffic begins.

These requirements apply to Hostinger and other Node-capable platforms. Provider-specific infrastructure, database connectivity, deployment packaging and the final production verification remain work to perform when a host is selected.

## Verification

Initial setup sent genuine failures through the running app, confirming browser and server ingestion. Temporary test triggers were removed afterward. The test issues remain available for inspection; they can be resolved after review:

- [Browser verification](https://stocks-buddha.sentry.io/issues/STOCKSBUDDHA-FRONTEND-1)
- [Server verification](https://stocks-buddha.sentry.io/issues/STOCKSBUDDHA-BACKEND-1)

For later verification, introduce a temporary deliberate failure in a local route or browser event handler, start the actual app, exercise that path, confirm its issue and source lines in Sentry, then remove the trigger. Do not add permanent public error-test endpoints.

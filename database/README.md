# MariaDB persistence

The ten-table foundation uses TypeORM and mysql2. Nine ordered application migrations create its tables/relationships; a locked runner bootstraps and verifies two migration metadata tables. See the [reviewed schema](../docs/DATABASE_DESIGN.md) and [implementation/recovery runbook](../docs/DATABASE_IMPLEMENTATION.md). No Hostinger resources have been provisioned or migrated.

## Local setup

Copy `backend/.env.example` to ignored `backend/.env`, replace both local passwords, set a unique random `AUTH_SECRET` and the exact `AUTH_BASE_URL` origin, then:

```sh
docker compose --env-file backend/.env up -d --wait db
npm run db:migrate -- --target dev
npm run db:seed:demo -- --target dev
npm run dev
```

Compose runs only MariaDB 11.4.8, pinned by image digest, on loopback port 3307 by default (`DB_PORT` can select another host port) with a persistent volume. This is a tested local baseline, not a verified Hostinger version. A fresh image creates `stocksbuddha_dev`; provision `stocksbuddha_prod` separately. Do not stop a database with `down -v` unless its data should be deleted. No frontend/backend containers are required. See [authentication setup and routes](../docs/AUTHENTICATION.md) for session and membership behavior.

If port 3307 is already allocated, set `DB_PORT=3308` (or another unused port) in `backend/.env`, then rerun Compose. The application and CLI read that same setting. Use `docker-compose` instead of `docker compose` if your installation provides the standalone command.

Without a local `.env`, nonproduction startup retains fixture-preview mode. MariaDB failures never fall back to fixtures. Production defaults to MariaDB; fixture production previews require both `DATABASE_MODE=fixtures` and `ALLOW_PUBLIC_PREVIEW=true`.

## Migration workflow

```sh
npm run db:migrate:status -- --target dev
npm run db:migrate -- --target dev
RELEASE_ID=your-release-id npm run db:build
```

Production runs the built artifact with deployment-provided credentials:

```sh
node database/dist/cli.js status --target prod
node database/dist/cli.js migrate --target prod
```

Production requires `DB_ENV=prod`, a matching `stocksbuddha_prod` name (optional Hostinger account prefix), and `DB_TLS=true` with verified certificates. Supply `DB_TLS_CA` when needed. Use operator `DB_USER`/`DB_PASSWORD` for migrations and restricted runtime credentials for the application. Never pass secrets as CLI arguments or commit them. The source runner refuses production without a compiled manifest.

Add timestamped reviewed SQL migrations through TypeORM QueryRunner and register classes in `catalog.ts` in matching order. No automatic entity-diff generator is configured. Build manifests hash original source and accompany compiled JavaScript. Applied files stay immutable; automatic destructive reversal is disabled. Status acquires the same lock and can initialize metadata on an empty database, but does not apply application migrations. Unfinished/failed history intentionally blocks normal commands pending operator reconciliation.

## Seeds and tests

Demo seeds are dev-only and insert missing read-only previews. They never overwrite edits, restore an unpublished tenant, or seed passwords/sessions/memberships. Real managed tenant provisioning creates an effective first owner transactionally through the internal service.

```sh
npm run typecheck
npm run test:unit
RUN_DATABASE_TESTS=true npm run test:database
```

The DB suite reads dev connection settings, creates unique `sb_test_*` databases and removes only those databases afterward. Use a local disposable administrative user with CREATE/DROP DATABASE permissions. It never drops the configured dev/prod database. Without `RUN_DATABASE_TESTS=true`, it explicitly skips; ordinary tests then do not establish database correctness. `test:integration` discovers it too and uses the same opt-in.

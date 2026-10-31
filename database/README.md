# Database

Database-owned artifacts live here, separate from application code:

- `migrations/`: future reviewed MySQL/TypeORM migrations, including the reviewed Better Auth schema.
- `seeds/`: future repeatable database seed scripts for local/staging data.

No database or migration runner is configured yet. The current read-only tenant profiles are in `backend/src/tenants/tenants.ts`; website revisions and localized content are in `backend/src/websites/`. These are application demo data, not SQL seeds. Asynchronous repository interfaces in `backend/src/tenancy/repository.ts` define the replacement point for MySQL adapters. Do not place database dumps, credentials, or live customer records in this repository.

When persistence is introduced, the backend will own database access and run migrations explicitly. The frontend receives only public contracts through the API/SSR boundary. Document migration and rollback commands here when they exist.

See [multi-tenant ownership and persistence requirements](../docs/ARCHITECTURE.md) before implementing tables or an editor. Enforce tenant-scoped revision/content relationships in the database, not only in application filters.

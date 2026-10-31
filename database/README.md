# Database

Database-owned artifacts live here, separate from application code:

- `migrations/`: future reviewed MySQL/TypeORM migrations, including the reviewed Better Auth schema.
- `seeds/`: future repeatable database seed scripts for local/staging data.

No database or migration runner is configured yet. The current read-only tenant fixtures remain in `backend/src/tenants/tenants.ts`; these are application demo data, not SQL seeds. Do not place database dumps, credentials, or live customer records in this repository.

When persistence is introduced, the backend will own database access and run migrations explicitly. The frontend receives only public contracts through the API/SSR boundary. Document migration and rollback commands here when they exist.

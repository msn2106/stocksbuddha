import type { MigrationInterface, QueryRunner } from "typeorm";
/** Serialize external storage mutations without holding tenant row locks or pooled connections. */
export class DocumentStorageLeases1794182400000 implements MigrationInterface {
  name = "DocumentStorageLeases1794182400000";
  /** Add recoverable, fenced leases; the platform scope uses the literal platform key. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE document_storage_leases (
scope_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
lease_until DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Keep applied schema changes forward-only, consistent with the other migrations. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

/** Immutable foundation migration; recover partial MariaDB DDL explicitly instead of automatic reversal. */
export class CreateAuthVerifications1793491200004 implements MigrationInterface {
  name = "CreateAuthVerifications1793491200004";
  /** Create the reviewed table with database-enforced tenant and state constraints. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE auth_verifications (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,identifier VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,value TEXT NOT NULL,
expires_at DATETIME(3) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), KEY ix_identifier(identifier),KEY ix_expiry(expires_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Refuse automatic destructive rollback of retained application records. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

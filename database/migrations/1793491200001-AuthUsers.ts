import type { MigrationInterface, QueryRunner } from "typeorm";

/** Immutable foundation migration; recover partial MariaDB DDL explicitly instead of automatic reversal. */
export class CreateAuthUsers1793491200001 implements MigrationInterface {
  name = "CreateAuthUsers1793491200001";
  /** Create the reviewed table with database-enforced tenant and state constraints. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE auth_users (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, name VARCHAR(160) NOT NULL,
email VARCHAR(254) COLLATE utf8mb4_bin NOT NULL UNIQUE,
email_verified TINYINT UNSIGNED NOT NULL DEFAULT 0 CHECK(email_verified IN (0,1)), image VARCHAR(2048) NULL,
platform_role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL CHECK(platform_role IS NULL OR platform_role='owner'),
created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Refuse automatic destructive rollback of retained application records. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

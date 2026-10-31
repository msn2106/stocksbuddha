import type { MigrationInterface, QueryRunner } from "typeorm";

/** Immutable foundation migration; recover partial MariaDB DDL explicitly instead of automatic reversal. */
export class CreateTenants1793491200000 implements MigrationInterface {
  name = "CreateTenants1793491200000";
  /** Create the reviewed table with database-enforced tenant and state constraints. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE tenants (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, slug VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','suspended','closed')),
is_synthetic TINYINT UNSIGNED NOT NULL DEFAULT 0 CHECK(is_synthetic IN (0,1)),
display_name VARCHAR(80) NOT NULL, legal_name VARCHAR(100) NOT NULL, registration_number VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
monogram VARCHAR(3) NOT NULL, contact_email VARCHAR(254) NULL, contact_phone VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
settings_json JSON NOT NULL CHECK(JSON_TYPE(settings_json)='OBJECT' AND OCTET_LENGTH(settings_json) <= 16384), published_revision INT UNSIGNED NULL,
publication_version INT UNSIGNED NOT NULL DEFAULT 0, lock_version INT UNSIGNED NOT NULL DEFAULT 1 CHECK(lock_version > 0), created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), KEY ix_publication(id,published_revision)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Refuse automatic destructive rollback of retained application records. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

/** Immutable foundation migration; recover partial MariaDB DDL explicitly instead of automatic reversal. */
export class CreateWebsites1793491200006 implements MigrationInterface {
  name = "CreateWebsites1793491200006";
  /** Create the reviewed table with database-enforced tenant and state constraints. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE website_revisions (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,revision INT UNSIGNED NOT NULL CHECK(revision > 0),
base_revision INT UNSIGNED NULL,base_publication_version INT UNSIGNED NOT NULL,
status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
snapshot_json JSON NOT NULL CHECK(JSON_TYPE(snapshot_json)='OBJECT' AND OCTET_LENGTH(snapshot_json) <= 524288),snapshot_sha256 VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK(snapshot_sha256 REGEXP '^[0-9a-f]{64}$'),
created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,published_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,published_at DATETIME(3) NULL,lock_version INT UNSIGNED NOT NULL DEFAULT 1 CHECK(lock_version > 0),created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
CHECK((status='draft' AND published_at IS NULL) OR (status='published' AND published_at IS NOT NULL)),
CHECK(base_revision IS NULL OR base_revision<>revision),
UNIQUE KEY uq_revision(tenant_id,revision),UNIQUE KEY uq_owner_id(tenant_id,id),KEY ix_status(tenant_id,status,revision),
KEY ix_creator(tenant_id,created_by),KEY ix_publisher(tenant_id,published_by),KEY ix_base(tenant_id,base_revision),
FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,FOREIGN KEY (tenant_id,created_by) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
FOREIGN KEY (tenant_id,published_by) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,FOREIGN KEY (tenant_id,base_revision) REFERENCES website_revisions(tenant_id,revision) ON DELETE RESTRICT ON UPDATE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Refuse automatic destructive rollback of retained application records. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

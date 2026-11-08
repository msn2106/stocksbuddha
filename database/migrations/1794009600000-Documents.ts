import type { MigrationInterface, QueryRunner } from "typeorm";
/** Retain private document metadata separately from Drive bytes and public website content. */
export class CreateDocuments1794009600000 implements MigrationInterface {
  name = "CreateDocuments1794009600000";
  /** Enforce tenant/customer references and append-only object identities. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE documents (
id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
customer_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
kind VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK(kind IN ('kyc','mitc','recommendation','general','contract','owner')),
original_name VARCHAR(160) NOT NULL,
mime_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK(mime_type IN ('application/pdf','image/jpeg','image/png')),
byte_size INT UNSIGNED NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),
sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
drive_file_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
drive_folder_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
uploaded_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
CHECK((kind IN ('contract','owner') AND tenant_id IS NULL AND customer_id IS NULL) OR (kind='general' AND tenant_id IS NOT NULL AND customer_id IS NULL) OR (kind IN ('kyc','mitc','recommendation') AND tenant_id IS NOT NULL AND customer_id IS NOT NULL)),
KEY ix_documents_scope(tenant_id,customer_id,created_at,id),
FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
FOREIGN KEY(tenant_id,customer_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
FOREIGN KEY(uploaded_by) REFERENCES auth_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Preserve evidence with explicit forward recovery rather than destructive rollback. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

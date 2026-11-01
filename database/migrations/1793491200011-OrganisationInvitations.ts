import type { MigrationInterface, QueryRunner } from "typeorm";

/** Store tenant-bound, expiring invitation grants without storing bearer tokens. */
export class CreateOrganisationInvitations1793491200011 implements MigrationInterface {
  name = "CreateOrganisationInvitations1793491200011";
  /** Add constrained invitation state; membership is granted only by the acceptance transaction. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE organisation_invitations (
id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
email VARCHAR(254) COLLATE utf8mb4_bin NOT NULL,
role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK(role IN ('owner','analyst','support')),
created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
expires_at DATETIME(3) NOT NULL,accepted_at DATETIME(3) NULL,
accepted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,revoked_at DATETIME(3) NULL,
delivery_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(delivery_status IN ('pending','sent','failed')),
created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
CHECK(expires_at>created_at),CHECK((accepted_at IS NULL AND accepted_by IS NULL) OR (accepted_at IS NOT NULL AND accepted_by IS NOT NULL)),
CHECK(accepted_at IS NULL OR revoked_at IS NULL),
KEY ix_tenant_email(tenant_id,email),KEY ix_expiry(expires_at),
FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
FOREIGN KEY(created_by) REFERENCES auth_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
FOREIGN KEY(accepted_by) REFERENCES auth_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Retain invitation evidence and require explicit forward recovery. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

/** Immutable foundation migration; recover partial MariaDB DDL explicitly instead of automatic reversal. */
export class CreateMemberships1793491200005 implements MigrationInterface {
  name = "CreateMemberships1793491200005";
  /** Create the reviewed table with database-enforced tenant and state constraints. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE tenant_memberships (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'subscriber' CHECK(role IN ('owner','analyst','support','subscriber')),
status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
full_name VARCHAR(160) NULL,mobile VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,mobile_verified_at DATETIME(3) NULL,
profile_json JSON NOT NULL CHECK(JSON_TYPE(profile_json)='OBJECT' AND OCTET_LENGTH(profile_json) <= 8192),capabilities_json JSON NOT NULL CHECK(JSON_TYPE(capabilities_json)='OBJECT' AND OCTET_LENGTH(capabilities_json) <= 4096),
onboarding_stage VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'not_started' CHECK(onboarding_stage IN ('not_started','profile_pending','verification_pending','agreement_pending','complete')),
revoked_at DATETIME(3) NULL,lock_version INT UNSIGNED NOT NULL DEFAULT 1 CHECK(lock_version > 0),created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
CHECK((status='revoked' AND revoked_at IS NOT NULL) OR (status='active' AND revoked_at IS NULL)),
UNIQUE KEY uq_member(tenant_id,user_id),UNIQUE KEY uq_owner_id(tenant_id,id),KEY ix_user_status(user_id,status),KEY ix_role(tenant_id,status,role,id),
FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Refuse automatic destructive rollback of retained application records. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

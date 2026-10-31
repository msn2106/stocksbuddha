import type { MigrationInterface, QueryRunner } from "typeorm";

/** Immutable foundation migration; recover partial MariaDB DDL explicitly instead of automatic reversal. */
export class CreateAudit1793491200007 implements MigrationInterface {
  name = "CreateAudit1793491200007";
  /** Create the reviewed table with database-enforced tenant and state constraints. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE audit_events (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,scope VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK(scope IN ('tenant','platform')),tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
actor_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK(actor_type IN ('user','system','migration')),actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,actor_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
action VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,entity_type VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,entity_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,reason VARCHAR(500) NULL,
metadata_json JSON NOT NULL CHECK(JSON_TYPE(metadata_json)='OBJECT' AND OCTET_LENGTH(metadata_json) <= 16384),operation_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,request_sha256 VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
occurred_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
CHECK((scope='tenant' AND tenant_id IS NOT NULL) OR (scope='platform' AND tenant_id IS NULL)),
CHECK((actor_type='user' AND actor_user_id IS NOT NULL) OR (actor_type<>'user' AND actor_user_id IS NULL)),
CHECK(actor_membership_id IS NULL OR (tenant_id IS NOT NULL AND actor_user_id IS NOT NULL)),
CHECK((operation_key IS NULL AND request_sha256 IS NULL) OR (operation_key IS NOT NULL AND request_sha256 IS NOT NULL AND request_sha256 REGEXP '^[0-9a-f]{64}$')),
KEY ix_tenant_time(tenant_id,occurred_at,id),KEY ix_entity(tenant_id,entity_type,entity_id,occurred_at),KEY ix_scope(scope,occurred_at,id),
KEY ix_actor(actor_user_id),KEY ix_member(tenant_id,actor_membership_id),
FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,FOREIGN KEY (actor_user_id) REFERENCES auth_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,FOREIGN KEY (tenant_id,actor_membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Refuse automatic destructive rollback of retained application records. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

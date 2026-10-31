import type { MigrationInterface, QueryRunner } from "typeorm";

/** Immutable foundation migration; recover partial MariaDB DDL explicitly instead of automatic reversal. */
export class CreateAuthSessions1793491200003 implements MigrationInterface {
  name = "CreateAuthSessions1793491200003";
  /** Create the reviewed table with database-enforced tenant and state constraints. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE auth_sessions (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,token VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
expires_at DATETIME(3) NOT NULL,ip_address VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NULL,user_agent TEXT NULL,created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
CHECK(expires_at > created_at), CHECK(user_agent IS NULL OR OCTET_LENGTH(user_agent)<=4096),
KEY ix_user(user_id),KEY ix_expiry(expires_at),FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Refuse automatic destructive rollback of retained application records. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

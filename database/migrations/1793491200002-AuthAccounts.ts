import type { MigrationInterface, QueryRunner } from "typeorm";

/** Immutable foundation migration; recover partial MariaDB DDL explicitly instead of automatic reversal. */
export class CreateAuthAccounts1793491200002 implements MigrationInterface {
  name = "CreateAuthAccounts1793491200002";
  /** Create the reviewed table with database-enforced tenant and state constraints. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE auth_accounts (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, provider_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, account_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
password VARCHAR(512) NULL,access_token TEXT NULL,refresh_token TEXT NULL,id_token TEXT NULL,
access_token_expires_at DATETIME(3) NULL,refresh_token_expires_at DATETIME(3) NULL,scope TEXT NULL,created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
UNIQUE KEY uq_provider(provider_id,account_id), KEY ix_user(user_id), FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Refuse automatic destructive rollback of retained application records. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

/** Add durable identity-scoped password-reset email reservations without changing existing authentication data. */
export class RecoveryEmailLimits1794355200000 implements MigrationInterface {
  name = "RecoveryEmailLimits1794355200000";
  /** Index rolling-day and cooldown lookups without storing recipients, messages or reset tokens. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE recovery_email_sends (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_at DATETIME(3) NOT NULL,
      KEY ix_recovery_email_user(user_id,created_at),
      FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Preserve quota evidence; recover schema changes through an explicit forward migration. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

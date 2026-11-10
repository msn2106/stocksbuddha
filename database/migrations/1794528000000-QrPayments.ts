import type { MigrationInterface, QueryRunner } from "typeorm";

/** Retain private QR configuration and immutable order-bound payment/review evidence. */
export class QrPayments1794528000000 implements MigrationInterface {
  name = "QrPayments1794528000000";
  /** Separate manual payment attempts from Cashfree sessions and retain references across rejected orders. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      "ALTER TABLE subscription_orders ADD payment_method VARCHAR(16) NULL CHECK(payment_method IN ('qr','cashfree'))",
    );
    await runner.query(
      "UPDATE subscription_orders SET payment_method='cashfree' WHERE payment_session IS NOT NULL",
    );
    await runner.query(`CREATE TABLE ra_qr_settings (
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      config_cipher MEDIUMTEXT NOT NULL, version INT UNSIGNED NOT NULL,
      FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE qr_payment_attempts (
      order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      config_cipher MEDIUMTEXT NOT NULL, proof_cipher MEDIUMTEXT NULL,
      reference_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      status VARCHAR(16) NOT NULL CHECK(status IN ('started','submitted','approved','rejected')),
      version INT UNSIGNED NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      submitted_at DATETIME(3) NULL, reviewed_at DATETIME(3) NULL,
      reviewed_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      reason_cipher TEXT NULL,
      UNIQUE KEY uq_qr_reference(tenant_id,reference_hash),
      KEY ix_qr_review(tenant_id,status,created_at),
      FOREIGN KEY(tenant_id,order_id) REFERENCES subscription_orders(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(reviewed_by) REFERENCES auth_users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Payment evidence requires forward recovery rather than destructive rollback. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; retained payment evidence cannot be dropped",
    );
  }
}

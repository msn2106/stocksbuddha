import type { MigrationInterface, QueryRunner } from "typeorm";

/** Add private RA integration settings without putting secrets into published website revisions. */
export class TenantIntegrations1794441600000 implements MigrationInterface {
  name = "TenantIntegrations1794441600000";
  /** Retain one independently versioned encrypted record per tenant/provider category. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      "ALTER TABLE sms_settings MODIFY config_cipher MEDIUMTEXT NOT NULL",
    );
    await runner.query(`CREATE TABLE tenant_integrations (
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK(kind IN ('telegram','payment')),
      config_cipher TEXT NOT NULL, version INT UNSIGNED NOT NULL,
      PRIMARY KEY(tenant_id,kind),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Preserve retained credentials and audit references during forward-only recovery. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

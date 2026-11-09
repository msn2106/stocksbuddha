import type { MigrationInterface, QueryRunner } from "typeorm";
const uuid = "CHAR(36) CHARACTER SET ascii COLLATE ascii_bin";
/** Add tenant-owned offers, encrypted KYC, immutable checkout evidence and a durable delivery queue. */
export class InvestorOnboarding1794096000000 implements MigrationInterface {
  name = "InvestorOnboarding1794096000000";
  /** Create constrained business records without changing any existing evidence tables. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE auth_users ADD COLUMN signup_phone VARCHAR(20) NULL`,
    );
    await runner.query(`CREATE TABLE ra_agreement_settings (
      tenant_id ${uuid} PRIMARY KEY, terms TEXT NOT NULL, contact VARCHAR(254) NOT NULL, address VARCHAR(1000) NOT NULL,
      gstin VARCHAR(20) NOT NULL DEFAULT '', annual_limit INT UNSIGNED NOT NULL CHECK(annual_limit>0), reviewed BOOLEAN NOT NULL DEFAULT FALSE,
      version INT UNSIGNED NOT NULL DEFAULT 1, FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE subscription_plans (
      id ${uuid} PRIMARY KEY, tenant_id ${uuid} NOT NULL, name VARCHAR(120) NOT NULL, description VARCHAR(4000) NOT NULL,
      days SMALLINT UNSIGNED NOT NULL CHECK(days BETWEEN 1 AND 365), price INT UNSIGNED NOT NULL CHECK(price>0),
      tax_bps SMALLINT UNSIGNED NOT NULL CHECK(tax_bps<=3000), active BOOLEAN NOT NULL DEFAULT TRUE, version INT UNSIGNED NOT NULL DEFAULT 1,
      UNIQUE KEY uq_plan_scope(tenant_id,id), FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE discount_codes (
      id ${uuid} PRIMARY KEY, tenant_id ${uuid} NOT NULL, code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      type VARCHAR(8) NOT NULL CHECK(type IN ('percent','fixed')), value INT UNSIGNED NOT NULL CHECK(value>0), plan_id ${uuid} NULL,
      starts_at DATETIME(3) NOT NULL, ends_at DATETIME(3) NOT NULL, usage_limit INT UNSIGNED NOT NULL CHECK(usage_limit>0),
      per_user INT UNSIGNED NOT NULL CHECK(per_user>0), active BOOLEAN NOT NULL DEFAULT TRUE, version INT UNSIGNED NOT NULL DEFAULT 1,
      CHECK(ends_at>starts_at), CHECK(type<>'percent' OR value<=100), UNIQUE KEY uq_coupon(tenant_id,code), UNIQUE KEY uq_coupon_scope(tenant_id,id),
      FOREIGN KEY(tenant_id,plan_id) REFERENCES subscription_plans(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE investor_kyc (
      membership_id ${uuid} PRIMARY KEY, tenant_id ${uuid} NOT NULL, profile_cipher TEXT NOT NULL, pan_hash CHAR(64) NULL,
      family_hash CHAR(64) NULL, status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','changes','rejected','verified','skipped_dev')),
      version INT UNSIGNED NOT NULL DEFAULT 1, reason VARCHAR(1000) NOT NULL DEFAULT '', provider VARCHAR(40) NOT NULL DEFAULT 'kfin_manual',
      provider_status VARCHAR(80) NOT NULL DEFAULT '', reference VARCHAR(200) NOT NULL DEFAULT '', evidence_id ${uuid} NULL,
      reviewed_by ${uuid} NULL, checked_at DATETIME(3) NULL, submitted_at DATETIME(3) NULL,
      UNIQUE KEY uq_kyc_scope(tenant_id,membership_id), UNIQUE KEY uq_kyc_pan(tenant_id,pan_hash),
      FOREIGN KEY(tenant_id,membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(evidence_id) REFERENCES documents(id) ON DELETE RESTRICT,
      FOREIGN KEY(reviewed_by) REFERENCES auth_users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE kyc_history (
      id ${uuid} PRIMARY KEY, tenant_id ${uuid} NOT NULL, membership_id ${uuid} NOT NULL, version INT UNSIGNED NOT NULL,
      snapshot_cipher TEXT NOT NULL, actor_id ${uuid} NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      UNIQUE KEY uq_kyc_history(tenant_id,membership_id,version),
      FOREIGN KEY(tenant_id,membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(actor_id) REFERENCES auth_users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE subscription_orders (
      id ${uuid} PRIMARY KEY, tenant_id ${uuid} NOT NULL, membership_id ${uuid} NOT NULL, plan_id ${uuid} NOT NULL, coupon_id ${uuid} NULL,
      request_key ${uuid} NOT NULL, snapshot_cipher LONGTEXT NOT NULL, agreement_hash CHAR(64) NOT NULL, family_hash CHAR(64) NOT NULL,
      subtotal INT UNSIGNED NOT NULL, discount INT UNSIGNED NOT NULL, tax INT UNSIGNED NOT NULL, total INT UNSIGNED NOT NULL,
      days SMALLINT UNSIGNED NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'quoted' CHECK(status IN ('quoted','signed','payment_pending','paid','cancelled')),
      dev BOOLEAN NOT NULL DEFAULT FALSE, otp_hash CHAR(64) NULL, otp_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0, otp_sent_at DATETIME(3) NULL,
      otp_expires_at DATETIME(3) NULL, signature_cipher TEXT NULL, signed_at DATETIME(3) NULL,
      expires_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), paid_at DATETIME(3) NULL, last_reconciled_at DATETIME(3) NULL,
      starts_at DATETIME(3) NULL, ends_at DATETIME(3) NULL, payment_id VARCHAR(128) NULL, payment_session TEXT NULL,
      agreement_id ${uuid} NULL, invoice_id ${uuid} NULL,
      UNIQUE KEY uq_order_scope(tenant_id,id), UNIQUE KEY uq_order_retry(tenant_id,membership_id,request_key), UNIQUE KEY uq_payment(tenant_id,payment_id),
      KEY ix_orders_member(tenant_id,membership_id,created_at), KEY ix_orders_family(tenant_id,family_hash,paid_at),
      CHECK(discount<=subtotal), CHECK(total=subtotal-discount+tax),
      FOREIGN KEY(tenant_id,membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,plan_id) REFERENCES subscription_plans(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,coupon_id) REFERENCES discount_codes(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(agreement_id) REFERENCES documents(id) ON DELETE RESTRICT, FOREIGN KEY(invoice_id) REFERENCES documents(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE onboarding_deliveries (
      order_id ${uuid} PRIMARY KEY, status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent')),
      attempts INT UNSIGNED NOT NULL DEFAULT 0, available_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), lease_until DATETIME(3) NULL,
      sent_at DATETIME(3) NULL, FOREIGN KEY(order_id) REFERENCES subscription_orders(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Retain legal and financial evidence; recover through a reviewed forward migration. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

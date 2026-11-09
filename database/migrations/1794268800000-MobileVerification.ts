import type { MigrationInterface, QueryRunner } from "typeorm";

/** Add private SMS configuration, bounded OTP state and retained communications without changing existing verification. */
export class MobileVerification1794268800000 implements MigrationInterface {
  name = "MobileVerification1794268800000";
  /** Keep tenant configuration separate from public website snapshots and recovery identity separate from KYC. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE sms_settings (
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      config_cipher TEXT NOT NULL, version INT UNSIGNED NOT NULL,
      vendor_user_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      KEY ix_sms_vendor(vendor_user_hash),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(
      `CREATE TABLE sms_mutex (id INT PRIMARY KEY) ENGINE=InnoDB`,
    );
    await runner.query("INSERT INTO sms_mutex(id) VALUES (1)");
    await runner.query(`CREATE TABLE sms_challenges (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      purpose VARCHAR(16) NOT NULL CHECK(purpose IN ('verify','recover')),
      mobile_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      mobile_cipher TEXT NOT NULL, code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      credential_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      sends INT NOT NULL DEFAULT 0, attempts INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL, sent_at DATETIME(3) NULL, expires_at DATETIME(3) NULL,
      consumed_at DATETIME(3) NULL,
      KEY ix_sms_flow(tenant_id,user_id,purpose,created_at),
      FOREIGN KEY (tenant_id,membership_id) REFERENCES tenant_memberships(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE sms_events (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      challenge_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      mobile_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      ip_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      kind VARCHAR(16) NOT NULL CHECK(kind IN ('send','wrong')),
      status VARCHAR(16) NOT NULL CHECK(status IN ('reserved','accepted','uncertain','wrong')),
      request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      evidence_cipher TEXT NULL, message_id VARCHAR(30) NULL, balance VARCHAR(40) NULL,
      created_at DATETIME(3) NOT NULL,
      UNIQUE KEY uq_sms_request(tenant_id,user_id,request_key),
      KEY ix_sms_mobile(mobile_hash,kind,created_at), KEY ix_sms_account(user_id,kind,created_at),
      KEY ix_sms_ip(ip_hash,kind,created_at), KEY ix_sms_tenant(tenant_id,kind,created_at), KEY ix_sms_global(kind,created_at),
      FOREIGN KEY (challenge_id) REFERENCES sms_challenges(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE sms_security_notices (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      attempts INT NOT NULL DEFAULT 0, available_at DATETIME(3) NOT NULL,
      lease_until DATETIME(3) NULL, sent_at DATETIME(3) NULL,
      KEY ix_sms_notice_queue(sent_at,available_at),
      FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE account_recovery_mobiles (
      user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      mobile_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      mobile_cipher TEXT NOT NULL, verified_at DATETIME(3) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Preserve client evidence; destructive reversal requires explicit operator recovery. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; automatic destructive rollback is disabled",
    );
  }
}

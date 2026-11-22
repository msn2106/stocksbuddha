import type { MigrationInterface, QueryRunner } from "typeorm";

/** Persist private bot identities, single-account bindings and a durable delivery queue. */
export class TelegramDelivery1794787200000 implements MigrationInterface {
  name = "TelegramDelivery1794787200000";
  /** Add scoped bindings and uniqueness constraints without modifying existing evidence. */
  async up(r: QueryRunner): Promise<void> {
    const uuid = "CHAR(36) CHARACTER SET ascii COLLATE ascii_bin";
    await r.query(`CREATE TABLE telegram_bots (
      tenant_id ${uuid} PRIMARY KEY, bot_id VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      username VARCHAR(64) NOT NULL, token_hash CHAR(64) NOT NULL, secret_cipher TEXT NOT NULL,
      FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB`);
    await r.query(`CREATE TABLE telegram_links (
      tenant_id ${uuid} NOT NULL, membership_id ${uuid} NOT NULL,
      bot_id VARCHAR(24) NOT NULL, telegram_user_id VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      contact_cipher TEXT NOT NULL, mobile_hash CHAR(64) NOT NULL, linked_at DATETIME(3) NOT NULL,
      PRIMARY KEY(tenant_id,membership_id), UNIQUE KEY telegram_account(tenant_id,telegram_user_id),
      FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
      FOREIGN KEY(membership_id) REFERENCES tenant_memberships(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB`);
    await r.query(`CREATE TABLE telegram_invites (
      tenant_id ${uuid} NOT NULL, membership_id ${uuid} NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE,
      telegram_user_id VARCHAR(24) NULL, expires_at DATETIME(3) NOT NULL,
      PRIMARY KEY(tenant_id,membership_id),
      FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
      FOREIGN KEY(membership_id) REFERENCES tenant_memberships(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB`);
    await r.query(`CREATE TABLE telegram_updates (
      tenant_id ${uuid} NOT NULL, update_id BIGINT UNSIGNED NOT NULL, received_at DATETIME(3) NOT NULL,
      PRIMARY KEY(tenant_id,update_id), KEY telegram_update_cleanup(received_at),
      FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB`);
    await r.query(`CREATE TABLE telegram_deliveries (
      id ${uuid} PRIMARY KEY, tenant_id ${uuid} NOT NULL, revision_id ${uuid} NOT NULL,
      membership_id ${uuid} NOT NULL, bot_id VARCHAR(24) NOT NULL,
      status VARCHAR(20) NOT NULL, attempts INT UNSIGNED NOT NULL DEFAULT 0,
      available_at DATETIME(3) NOT NULL, lease_until DATETIME(3) NULL,
      UNIQUE KEY telegram_delivery(tenant_id,revision_id,membership_id), KEY telegram_queue(status,available_at),
      FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
      FOREIGN KEY(revision_id) REFERENCES research_revisions(id) ON DELETE RESTRICT,
      FOREIGN KEY(membership_id) REFERENCES tenant_memberships(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB`);
  }
  /** Retain delivered evidence; recovery uses a reviewed forward migration. */
  async down(): Promise<void> {
    throw new Error("Forward recovery required for Telegram delivery evidence");
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";
/** Persist private declarations, immutable audit versions and research access foundations. */
export class MarketSetup1794614400001 implements MigrationInterface {
  name = "MarketSetup1794614400001";
  /** Retain history independently of the mutable current projection. */
  async up(r: QueryRunner): Promise<void> {
    await r.query(
      `CREATE TABLE ra_market_state (tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, version INT UNSIGNED NOT NULL, state_cipher LONGTEXT NOT NULL, FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT) ENGINE=InnoDB`,
    );
    await r.query(
      `CREATE TABLE ra_market_events (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, actor_id VARCHAR(255) NOT NULL, version INT UNSIGNED NOT NULL, action VARCHAR(40) NOT NULL, snapshot_cipher LONGTEXT NOT NULL, created_at DATETIME(3) NOT NULL, UNIQUE KEY market_version(tenant_id,version), FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT) ENGINE=InnoDB`,
    );
    await r.query(
      `CREATE TABLE research_plan_offerings (tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, offering VARCHAR(20) NOT NULL, PRIMARY KEY(tenant_id,plan_id,offering), FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT) ENGINE=InnoDB`,
    );
    await r.query(
      `CREATE TABLE research_order_offerings (tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, offering VARCHAR(20) NOT NULL, PRIMARY KEY(tenant_id,order_id,offering), FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT) ENGINE=InnoDB`,
    );
    await r.query(
      `CREATE TABLE research_revisions (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, recommendation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, version INT UNSIGNED NOT NULL, snapshot_cipher LONGTEXT NOT NULL, created_at DATETIME(3) NOT NULL, UNIQUE KEY research_version(tenant_id,recommendation_id,version), FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT) ENGINE=InnoDB`,
    );
    await r.query(
      `CREATE TABLE research_deliveries (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, revision_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, channel VARCHAR(20) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending', attempts INT UNSIGNED NOT NULL DEFAULT 0, created_at DATETIME(3) NOT NULL, UNIQUE KEY research_delivery(tenant_id,revision_id,membership_id,channel), FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT) ENGINE=InnoDB`,
    );
  }
  /** Research evidence is retained; recover with a forward migration. */
  async down(): Promise<void> {
    throw new Error("Forward recovery required for research evidence");
  }
}

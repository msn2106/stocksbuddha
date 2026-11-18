import type { MigrationInterface, QueryRunner } from "typeorm";
/** Add encrypted draft projections and frozen recipient grants without changing earlier evidence tables. */
export class ResearchPublishing1794700800000 implements MigrationInterface {
  name = "ResearchPublishing1794700800000";
  /** Tenant locks serialize writes; revisions and deliveries preserve published history. */
  async up(r: QueryRunner): Promise<void> {
    const uuid = "CHAR(36) CHARACTER SET ascii COLLATE ascii_bin";
    await r.query(
      `CREATE TABLE research_items (id ${uuid} PRIMARY KEY,tenant_id ${uuid} NOT NULL,version INT UNSIGNED NOT NULL,status VARCHAR(20) NOT NULL,draft_cipher LONGTEXT NOT NULL,latest_revision_id ${uuid} NULL,created_at DATETIME(3) NOT NULL,updated_at DATETIME(3) NOT NULL,KEY research_tenant(tenant_id,updated_at,id),FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT) ENGINE=InnoDB`,
    );
    await r.query(
      `CREATE TABLE research_recipients (tenant_id ${uuid} NOT NULL,recommendation_id ${uuid} NOT NULL,membership_id ${uuid} NOT NULL,granted_at DATETIME(3) NOT NULL,PRIMARY KEY(tenant_id,recommendation_id,membership_id),KEY research_member(tenant_id,membership_id),FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,FOREIGN KEY(recommendation_id) REFERENCES research_items(id) ON DELETE RESTRICT,FOREIGN KEY(membership_id) REFERENCES tenant_memberships(id) ON DELETE RESTRICT) ENGINE=InnoDB`,
    );
    await r.query(
      `CREATE TABLE research_groups (id ${uuid} PRIMARY KEY,tenant_id ${uuid} NOT NULL,name VARCHAR(160) NOT NULL,version INT UNSIGNED NOT NULL,members_cipher LONGTEXT NOT NULL,FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT) ENGINE=InnoDB`,
    );
    await r.query(
      "ALTER TABLE research_deliveries ADD COLUMN read_at DATETIME(3) NULL",
    );
  }
  /** Published evidence is retained; recovery requires a reviewed forward migration. */
  async down(): Promise<void> {
    throw new Error("Forward recovery required for published research");
  }
}

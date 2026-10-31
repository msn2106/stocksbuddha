import type { MigrationInterface, QueryRunner } from "typeorm";
/** Complete the circular tenant/publication ownership constraint after both tables exist. */
export class AddPublication1793491200008 implements MigrationInterface {
  name = "AddPublication1793491200008";
  /** Prevent a tenant from pointing at another tenant's website. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      "ALTER TABLE tenants ADD CONSTRAINT fk_tenants_publication FOREIGN KEY (id,published_revision) REFERENCES website_revisions(tenant_id,revision) ON DELETE RESTRICT ON UPDATE RESTRICT",
    );
  }
  /** Refuse implicit removal of an isolation constraint. */
  async down(): Promise<void> {
    throw new Error("Forward recovery required");
  }
}

import type { MigrationInterface, QueryRunner } from "typeorm";

/** Keep each RA's private stationery configuration separately versioned from legal wording and website drafts. */
export class LetterheadSettings1794614400000 implements MigrationInterface {
  name = "LetterheadSettings1794614400000";
  /** Store encrypted normalized PDF content and printable-area settings behind the owning tenant. */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE ra_letterhead_settings (
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      config_cipher LONGTEXT NOT NULL, version INT UNSIGNED NOT NULL CHECK(version > 0),
      FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  /** Preserve retained configuration through forward recovery instead of destructive rollback. */
  async down(): Promise<void> {
    throw new Error(
      "Forward recovery required; retained letterheads cannot be dropped",
    );
  }
}

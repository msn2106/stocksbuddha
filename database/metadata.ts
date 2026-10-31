import type { QueryRunner } from "typeorm";
import { createHash } from "node:crypto";

const uuid = "CHAR(36) CHARACTER SET ascii COLLATE ascii_bin";
export const metadataSql = [
  `CREATE TABLE IF NOT EXISTS migrations (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, timestamp BIGINT NOT NULL, name VARCHAR(255) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS migration_attempts (
    id ${uuid} PRIMARY KEY,run_id ${uuid} NOT NULL,migration_name VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    migration_timestamp BIGINT NOT NULL CHECK(migration_timestamp>0),migration_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK(migration_checksum REGEXP '^[0-9a-f]{64}$'),
    release_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,runner_version VARCHAR(64) NOT NULL,
    direction VARCHAR(8) NOT NULL DEFAULT 'up' CHECK(direction IN ('up','down')),
    status VARCHAR(16) NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed','interrupted','reconciled')),
    started_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),finished_at DATETIME(3) NULL,error_code VARCHAR(64) NULL,error_summary VARCHAR(1000) NULL,
    resolution_json JSON NULL CHECK(resolution_json IS NULL OR (JSON_TYPE(resolution_json)='OBJECT' AND OCTET_LENGTH(resolution_json)<=8192)),
    CHECK((status='running' AND finished_at IS NULL) OR (status<>'running' AND finished_at IS NOT NULL)),
    CHECK(status<>'reconciled' OR (resolution_json IS NOT NULL AND JSON_CONTAINS_PATH(resolution_json,'all','$.schemaVersion','$.operator','$.priorStatus','$.decision','$.time','$.evidence')=1 AND JSON_UNQUOTE(JSON_EXTRACT(resolution_json,'$.schemaVersion'))='1')),
    UNIQUE KEY uq_run(run_id,migration_name,direction),KEY ix_migration(migration_name,started_at,id),KEY ix_status(status,started_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export const bootstrapChecksum = createHash("sha256")
  .update(JSON.stringify(metadataSql))
  .digest("hex");

/** Bootstrap metadata and compare its normalized server DDL to a temporary table made from the approved definition. */
export async function bootstrapMetadata(runner: QueryRunner) {
  for (const [index, name] of ["migrations", "migration_attempts"].entries()) {
    const sql = metadataSql[index];
    await runner.query(sql);
    const reference = `sb_metadata_reference_${index}`;
    await runner.query(
      sql.replace(
        `CREATE TABLE IF NOT EXISTS ${name}`,
        `CREATE TEMPORARY TABLE ${reference}`,
      ),
    );
    try {
      const actual = await runner.query(`SHOW CREATE TABLE ${name}`);
      const expected = await runner.query(`SHOW CREATE TABLE ${reference}`);
      /** Remove only table identity, temporary marker and next auto-increment counter from server-normalized DDL. */
      const normalize = (ddl: string) =>
        ddl
          .replace(/CREATE TEMPORARY TABLE/g, "CREATE TABLE")
          .replace(
            /`sb_metadata_reference_\d`|`migrations`|`migration_attempts`/g,
            "`metadata`",
          )
          .replace(/ AUTO_INCREMENT=\d+/g, "");
      if (
        normalize(actual[0]["Create Table"]) !==
        normalize(expected[0]["Create Table"])
      )
        throw new Error(`Metadata schema drift: ${name}`);
    } finally {
      await runner.query(`DROP TEMPORARY TABLE ${reference}`);
    }
  }
}

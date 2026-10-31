import { randomUUID } from "node:crypto";
import { DataSource, Migration, MigrationExecutor } from "typeorm";
import { migrationClasses } from "./catalog";
import { bootstrapMetadata, bootstrapChecksum } from "./metadata";
import type { MigrationManifest } from "./manifest";

/** Run or inspect reviewed migrations under a connection-scoped lock shared with the actual DDL connection. */
export async function runMigrations(
  db: DataSource,
  manifest: MigrationManifest,
  apply: boolean,
) {
  if (
    !manifest.release ||
    manifest.bootstrapChecksum !== bootstrapChecksum ||
    manifest.release.length > 128 ||
    Object.keys(manifest.checksums).length !== migrationClasses.length
  )
    throw new Error("Invalid release manifest");
  const lock = db.createQueryRunner();
  await lock.connect();
  const lockName = `sb:${db.options.database}:migrate`;
  let acquired = false;
  try {
    if (lockName.length > 64)
      throw new Error("Migration lock name exceeds limit");
    const result = await lock.query("SELECT GET_LOCK(?, 30) AS acquired", [
      lockName,
    ]);
    if (Number(result[0].acquired) !== 1)
      throw new Error("Migration lock unavailable");
    acquired = true;
    await bootstrapMetadata(lock);
    const executed: { name: string }[] = await lock.query(
      "SELECT name FROM migrations ORDER BY id",
    );
    const attempts: {
      migration_name: string;
      migration_checksum: string;
      status: string;
    }[] = await lock.query(
      "SELECT migration_name,migration_checksum,status FROM migration_attempts ORDER BY started_at,id",
    );
    if (
      attempts.some(
        (row) => row.status !== "succeeded" && row.status !== "reconciled",
      )
    )
      throw new Error(
        "Migration history needs explicit operator reconciliation; automatic retry refused",
      );
    for (const row of attempts)
      if (manifest.checksums[row.migration_name] !== row.migration_checksum)
        throw new Error("Migration source checksum mismatch");
    for (const row of executed)
      if (
        !manifest.checksums[row.name] ||
        !attempts.some(
          (attempt) =>
            attempt.migration_name === row.name &&
            ["succeeded", "reconciled"].includes(attempt.status),
        )
      )
        throw new Error("Unknown or untracked applied migration");
    const names = migrationClasses.map((Class) => new Class().name);
    if (
      executed.some((row, index) => row.name !== names[index]) ||
      attempts.some(
        (row) =>
          row.status === "succeeded" &&
          !executed.some((applied) => applied.name === row.migration_name),
      )
    )
      throw new Error(
        "Applied migration order/history mismatch; operator reconciliation required",
      );
    const status = migrationClasses.map((Class) => {
      const instance = new Class();
      const name = instance.name;
      if (!/^[a-f0-9]{64}$/.test(manifest.checksums[name] ?? ""))
        throw new Error("Missing migration checksum");
      return { name, applied: executed.some((row) => row.name === name) };
    });
    if (!apply) return status;
    const runId = randomUUID();
    const executor = new MigrationExecutor(db, lock);
    for (const Class of migrationClasses) {
      const instance = new Class();
      if (executed.some((row) => row.name === instance.name)) continue;
      const id = randomUUID();
      const timestamp = Number(instance.name.slice(-13));
      // Autocommit metadata uses another pool connection; DDL and its lock stay on the same connection.
      await db.query(
        "INSERT INTO migration_attempts(id,run_id,migration_name,migration_timestamp,migration_checksum,release_id,runner_version) VALUES (?,?,?,?,?,?,?)",
        [
          id,
          runId,
          instance.name,
          timestamp,
          manifest.checksums[instance.name],
          manifest.release,
          "1",
        ],
      );
      try {
        await executor.executeMigration(
          new Migration(undefined, timestamp, instance.name, instance),
        );
        await db.query(
          "UPDATE migration_attempts SET status='succeeded',finished_at=UTC_TIMESTAMP(3) WHERE id=?",
          [id],
        );
      } catch {
        await db.query(
          "UPDATE migration_attempts SET status='failed',finished_at=UTC_TIMESTAMP(3),error_code='MIGRATION_FAILED',error_summary='Inspect database state and deployment diagnostics before explicit reconciliation' WHERE id=?",
          [id],
        );
        throw new Error(
          `Migration failed: ${instance.name}; partial DDL may exist`,
        );
      }
    }
    return status.map((row) => ({ ...row, applied: true }));
  } finally {
    try {
      if (acquired) await lock.query("SELECT RELEASE_LOCK(?)", [lockName]);
    } finally {
      await lock.release();
    }
  }
}

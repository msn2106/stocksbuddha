import { fileURLToPath } from "node:url";
import path from "node:path";
import { databaseConfig, createDatabase } from "./config";
import { loadManifest } from "./manifest";
import { runMigrations } from "./runner";
import { seedDemo } from "./seeds/demo";

/** Execute an explicitly targeted migration/status/dev-seed command without exposing driver errors or credentials. */
export async function databaseCommand(
  args: string[],
  env = process.env,
  adapters = { createDatabase, loadManifest, runMigrations, seedDemo },
) {
  const [command, targetFlag, target] = args;
  if (
    !["migrate", "status", "seed"].includes(command) ||
    targetFlag !== "--target" ||
    !["dev", "prod"].includes(target) ||
    args.length !== 3
  )
    throw new Error("Usage: migrate|status|seed --target dev|prod");
  if (target === "prod" && env.DB_ENV !== "prod")
    throw new Error(
      "Production target requires DB_ENV=prod as well as --target prod",
    );
  if (command === "seed" && target !== "dev")
    throw new Error("Demo seeds cannot target production");
  const db = adapters.createDatabase(databaseConfig(env, target), 3, 0);
  await db.initialize();
  try {
    if (command === "seed") {
      await adapters.seedDemo(db, target);
      return { seeded: true };
    }
    return await adapters.runMigrations(
      db,
      await adapters.loadManifest(target === "prod"),
      command === "migrate",
    );
  } finally {
    await db.destroy();
  }
}

/** Report sanitized CLI results through injectable command/output adapters. */
export async function databaseCli(
  args: string[],
  command = databaseCommand,
  output = console,
) {
  try {
    output.log(JSON.stringify(await command(args), null, 2));
    return 0;
  } catch {
    output.error(
      "Database command failed. Check target/configuration, readiness and migration_attempts. Credentials and raw database errors are intentionally suppressed.",
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await databaseCli(process.argv.slice(2));
}

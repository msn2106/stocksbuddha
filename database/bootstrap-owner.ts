import { fileURLToPath } from "node:url";
import path from "node:path";
import { databaseConfig, createDatabase } from "./config";
import { bootstrapOwner } from "../backend/src/organisations/bootstrap";

/** Execute an operator-only bootstrap against an explicitly selected environment and always release its pool. */
export async function bootstrapCommand(
  args: string[],
  env = process.env,
  factory = createDatabase,
) {
  if (
    args.length !== 4 ||
    args[0] !== "--email" ||
    args[2] !== "--target" ||
    !["dev", "prod"].includes(args[3]) ||
    env.DB_ENV !== args[3]
  )
    throw new Error(
      "Usage: --email verified@example.com --target dev|prod with matching DB_ENV",
    );
  const db = factory(databaseConfig(env, args[3]));
  await db.initialize();
  try {
    return await bootstrapOwner(db, args[1]);
  } finally {
    await db.destroy();
  }
}
/** Report bounded operator results without exposing credentials or driver errors. */
export async function bootstrapCli(
  args: string[],
  command = bootstrapCommand,
  output: Pick<Console, "log" | "error"> = console,
) {
  try {
    output.log(JSON.stringify(await command(args)));
    return 0;
  } catch {
    output.error(
      "Owner bootstrap failed. Check explicit target, verified account, existing owner and database settings.",
    );
    return 1;
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await bootstrapCli(process.argv.slice(2));

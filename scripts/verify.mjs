import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Run repository checks in dependency order, returning the first failing status. */
export function verify(execute = spawnSync, platform = process.platform) {
  const npm = platform === "win32" ? "npm.cmd" : "npm";
  // Build runs type checking and must finish before the production browser checks.
  for (const script of [
    "security:check",
    "format:check",
    "lint",
    "test:coverage",
    "test:integration",
    "build",
    "test:e2e",
  ]) {
    const result = execute(npm, ["run", script], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) return result.status ?? 1;
  }

  return 0;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = verify();

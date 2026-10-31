import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

// Build runs type checking and must finish before the production browser checks.
for (const script of [
  "security:check",
  "format:check",
  "test",
  "build",
  "test:e2e",
]) {
  const result = spawnSync(npm, ["run", script], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

import { defineConfig } from "tsup";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const buildEnv = new URL("../.env.sentry-build-plugin", import.meta.url);
if (existsSync(buildEnv)) process.loadEnvFile(fileURLToPath(buildEnv));

export default defineConfig({
  entry: ["src/main.ts", "src/instrument.ts"],
  sourcemap: true,
  // tsup writes files after esbuild's onEnd, so upload only after tsup finishes.
  onSuccess: async () => {
    if (!process.env.SENTRY_AUTH_TOKEN) return;
    execFileSync("sentry-cli", ["sourcemaps", "inject", "dist"], {
      stdio: "inherit",
    });
    execFileSync(
      "sentry-cli",
      [
        "sourcemaps",
        "upload",
        "--org",
        "stocks-buddha",
        "--project",
        "stocksbuddha-backend",
        "dist",
      ],
      { stdio: "inherit" },
    );
  },
  format: ["esm"],
  outDir: "dist",
  clean: true,
  noExternal: ["@ra/contracts"],
  external: ["vite"],
});

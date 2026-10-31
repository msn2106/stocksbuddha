import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default defineConfig(({ isSsrBuild, command }) => {
  const buildEnv = new URL("../.env.sentry-build-plugin", import.meta.url);
  if (command === "build" && existsSync(buildEnv))
    process.loadEnvFile(fileURLToPath(buildEnv));
  return {
    build: { sourcemap: process.env.SENTRY_AUTH_TOKEN ? "hidden" : false },
    plugins: [
      react(),
      tailwindcss(),
      ...(process.env.SENTRY_AUTH_TOKEN
        ? sentryVitePlugin({
            org: "stocks-buddha",
            project: isSsrBuild
              ? "stocksbuddha-backend"
              : "stocksbuddha-frontend",
            authToken: process.env.SENTRY_AUTH_TOKEN,
            telemetry: false,
            sourcemaps: {
              assets: isSsrBuild ? "./dist/server/**" : "./dist/client/**",
              filesToDeleteAfterUpload: [
                isSsrBuild
                  ? "./dist/server/**/*.map"
                  : "./dist/client/**/*.map",
              ],
            },
          })
        : []),
    ],
    ssr: { noExternal: ["@ra/contracts"] },
  };
});

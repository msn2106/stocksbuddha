import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: [
    "flow.ts",
    "onboarding-flow.ts",
    "settings-flow.ts",
    "qr-payments-flow.ts",
  ],
  workers: 1,
  outputDir: "../../test-results-organisations",
  use: {
    baseURL: "http://127.0.0.1:3111",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node --env-file=backend/.env --import tsx tests/organisation/server.ts",
    cwd: new URL("../../", import.meta.url).pathname,
    url: "http://127.0.0.1:3111/api/ready",
    reuseExistingServer: false,
    timeout: 60000,
  },
});

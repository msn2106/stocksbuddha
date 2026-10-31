import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:3100/api/health",
    env: {
      PORT: "3100",
      DATABASE_MODE: "fixtures",
      ALLOW_PUBLIC_PREVIEW: "true",
    },
    reuseExistingServer: false,
  },
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BrowserOptions } from "@sentry/react";
import { configureBrowserMonitoring } from "../src/instrument";

test("browser monitoring is opt-in, limits tracing targets and keeps request data private", () => {
  const configs: BrowserOptions[] = [];
  const initialize = (options: BrowserOptions = {}) => {
    configs.push(options);
    return undefined;
  };
  configureBrowserMonitoring({}, initialize);
  assert.equal(configs.length, 0);
  configureBrowserMonitoring(
    { VITE_SENTRY_DSN: "https://test@example.com/1", MODE: "development" },
    initialize,
  );
  configureBrowserMonitoring(
    {
      VITE_SENTRY_DSN: "https://test@example.com/1",
      MODE: "production",
      PROD: true,
    },
    initialize,
  );
  configureBrowserMonitoring(
    {
      VITE_SENTRY_DSN: "https://test@example.com/1",
      VITE_SENTRY_ENVIRONMENT: "staging",
      VITE_SENTRY_RELEASE: "commit-sha",
      VITE_SENTRY_TRACES_SAMPLE_RATE: "0.25",
    },
    initialize,
  );
  assert.deepEqual(
    configs.map((config) => config.tracesSampleRate),
    [1, 0.1, 0.25],
  );
  assert.deepEqual(
    configs.map((config) => config.environment),
    ["development", "production", "staging"],
  );
  assert.equal(configs[2]!.release, "commit-sha");
  for (const config of configs) {
    assert.deepEqual(config.dataCollection, {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    });
    const target = config.tracePropagationTargets![0] as RegExp;
    assert.ok(target.test("/api/ra/stocksbuddha"));
    assert.ok(!target.test("https://another.example/api"));
  }
});

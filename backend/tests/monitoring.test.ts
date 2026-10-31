import { test } from "node:test";
import assert from "node:assert/strict";
import type { NodeOptions } from "@sentry/node";
import { configureServerMonitoring } from "../src/instrument";

test("server monitoring is opt-in and never collects authentication or database payloads", () => {
  const configs: NodeOptions[] = [];
  const initialize = (options: NodeOptions = {}) => {
    configs.push(options);
    return undefined;
  };
  configureServerMonitoring({}, initialize);
  assert.equal(configs.length, 0);
  configureServerMonitoring(
    { SENTRY_DSN: "https://test@example.com/1" },
    initialize,
  );
  configureServerMonitoring(
    { SENTRY_DSN: "https://test@example.com/1", NODE_ENV: "production" },
    initialize,
  );
  configureServerMonitoring(
    {
      SENTRY_DSN: "https://test@example.com/1",
      SENTRY_ENVIRONMENT: "staging",
      SENTRY_RELEASE: "commit-sha",
      SENTRY_TRACES_SAMPLE_RATE: "0.25",
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
  for (const config of configs)
    assert.deepEqual(config.dataCollection, {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
    });
});

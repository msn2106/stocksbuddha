import { test } from "node:test";
import assert from "node:assert/strict";
import { isProductionDeployment } from "../src/deployment";
import { merchants } from "../src/onboarding/cashfree";
import { devEnabled } from "../src/onboarding/domain";
import { createPersistence } from "../src/database/runtime";

const hostedDev = { NODE_ENV: "production", APP_ENV: "dev", DB_ENV: "dev" };

test("deployment policy preserves defaults and rejects explicit environment mismatches", () => {
  assert.equal(isProductionDeployment({}), false);
  assert.equal(isProductionDeployment({ NODE_ENV: "production" }), true);
  assert.equal(isProductionDeployment(hostedDev), false);
  assert.equal(
    isProductionDeployment({ APP_ENV: "dev", DB_ENV: "dev" }),
    false,
  );
  assert.equal(
    isProductionDeployment({
      NODE_ENV: "production",
      APP_ENV: "production",
      DB_ENV: "prod",
    }),
    true,
  );
  for (const env of [
    { APP_ENV: "" },
    { APP_ENV: "staging" },
    { ...hostedDev, DB_ENV: "prod" },
    { ...hostedDev, DB_ENV: undefined },
    { ...hostedDev, APP_ENV: "production" },
    { APP_ENV: "production", DB_ENV: "prod", NODE_ENV: "development" },
  ])
    assert.throws(() => isProductionDeployment(env), /APP_ENV/);
});

test("hosted dev allows sandbox only and bypasses require separate opt-in", () => {
  const sandbox = JSON.stringify({
    alpha: { clientId: "test", clientSecret: "test", mode: "sandbox" },
  });
  const live = JSON.stringify({
    alpha: { clientId: "test", clientSecret: "test", mode: "production" },
  });
  assert.equal(
    merchants({ ...hostedDev, CASHFREE_MERCHANTS_JSON: sandbox }).get("alpha")
      ?.mode,
    "sandbox",
  );
  assert.throws(
    () =>
      merchants({
        ...hostedDev,
        CASHFREE_MERCHANTS_JSON: live,
        ONBOARDING_PRODUCTION_APPROVED: "true",
      }),
    /production_payments_not_approved/,
  );
  const production = {
    NODE_ENV: "production",
    APP_ENV: "production",
    DB_ENV: "prod",
  };
  assert.throws(
    () => merchants({ ...production, CASHFREE_MERCHANTS_JSON: sandbox }),
    /sandbox_forbidden/,
  );
  assert.throws(
    () => merchants({ ...production, CASHFREE_MERCHANTS_JSON: live }),
    /production_payments_not_approved/,
  );
  assert.equal(
    merchants({
      ...production,
      CASHFREE_MERCHANTS_JSON: live,
      ONBOARDING_PRODUCTION_APPROVED: "true",
    }).get("alpha")?.mode,
    "production",
  );
  assert.equal(devEnabled(hostedDev), false);
  assert.equal(devEnabled({ ...hostedDev, ONBOARDING_DEV_SKIP: "true" }), true);
  assert.equal(
    devEnabled({ ...production, ONBOARDING_DEV_SKIP: "true" }),
    false,
  );
});

test("invalid deployment settings fail before database access even without merchants", async () => {
  const invalid = { ...hostedDev, DB_ENV: "prod" };
  assert.throws(() => merchants(invalid), /APP_ENV must match/);
  await assert.rejects(
    createPersistence(invalid, () => {
      throw new Error("database accessed");
    }),
    /APP_ENV must match/,
  );
});

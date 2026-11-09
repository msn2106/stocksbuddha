import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { IntegrationSettingsService } from "../src/integrations/service";
import { OnboardingService } from "../src/onboarding/service";
import { onboardingFixture } from "./onboarding-fixture";

/** Extend the business fixture with isolated encrypted private integration rows. */
function fixture() {
  const f = onboardingFixture();
  f.memory.exec(
    "CREATE TABLE tenant_integrations(tenant_id TEXT,kind TEXT,config_cipher TEXT,version INTEGER,PRIMARY KEY(tenant_id,kind))",
  );
  const env: NodeJS.ProcessEnv = { ...f.env };
  return { ...f, env, integrations: new IntegrationSettingsService(f.db, env) };
}
const telegram = {
  version: 0,
  botToken: "123456789:synthetic-private-token",
  chatId: "-1001234567890",
  inviteLink: "https://t.me/+exampleInvite",
};
const payment = {
  version: 0,
  provider: "cashfree",
  enabled: true,
  mode: "sandbox",
  clientId: "TEST_client",
  clientSecret: "synthetic-private-merchant-secret",
};

test("private integrations enforce fresh owner/tenant authorization, retain secrets and preserve optimistic versions", async () => {
  const f = fixture();
  try {
    assert.throws(
      () => new IntegrationSettingsService(f.db, {}),
      /integration_key_required/,
    );
    await assert.rejects(
      f.integrations.read(f.investor, "telegram"),
      /forbidden/,
    );
    await assert.rejects(
      f.integrations.read(
        { ...f.admin, tenantId: f.otherTenantId },
        "telegram",
      ),
      /forbidden/,
    );
    await assert.rejects(
      f.integrations.read(f.admin, "unknown"),
      /invalid_integration/,
    );
    await assert.rejects(
      f.integrations.save(f.admin, "unknown", {}),
      /invalid_integration/,
    );
    await assert.rejects(
      f.integrations.save(f.admin, "telegram", {}),
      /invalid_integration_settings/,
    );
    assert.equal(
      (await f.integrations.read(f.admin, "telegram")).configured,
      false,
    );
    await assert.rejects(
      f.integrations.save(f.admin, "telegram", {
        ...telegram,
        botToken: undefined,
      }),
      /integration_credentials_required/,
    );
    await f.integrations.save(f.admin, "telegram", telegram);
    const saved = await f.integrations.read(f.admin, "telegram");
    assert.equal(saved.configured, true);
    assert.equal(saved.version, 1);
    assert.equal(saved.deliveryAvailable, false);
    assert.ok(!JSON.stringify(saved).includes(telegram.botToken));
    assert.ok(
      !String(
        (await f.query("SELECT config_cipher FROM tenant_integrations"))[0]
          .config_cipher,
      ).includes(telegram.botToken),
    );
    await assert.rejects(
      f.integrations.save(f.admin, "telegram", telegram),
      /version_conflict/,
    );
    await f.integrations.save(f.admin, "telegram", {
      ...telegram,
      version: 1,
      botToken: undefined,
      inviteLink: "",
    });
    assert.equal(
      (await f.integrations.read(f.admin, "telegram")).configured,
      true,
    );
    assert.equal(
      (
        await f.integrations.read(
          { token: "foreign-token", tenantId: f.otherTenantId },
          "telegram",
        )
      ).configured,
      false,
    );
    for (const value of [
      { ...telegram, inviteLink: "https://evil.example/invite" },
      { ...telegram, chatId: "not-a-channel" },
    ])
      await assert.rejects(
        f.integrations.save(f.admin, "telegram", value),
        /invalid_integration_settings/,
      );
    await f.query(
      "UPDATE tenant_memberships SET capabilities_json=? WHERE id=?",
      [JSON.stringify({ deny: ["website:edit"] }), f.adminMemberId],
    );
    await assert.rejects(f.integrations.read(f.admin, "telegram"), /forbidden/);
  } finally {
    f.close();
  }
});

test("Cashfree settings use current tenant credentials, support server fallback and cannot rotate after checkout or bypass live gates", async () => {
  const f = fixture();
  try {
    assert.equal(
      (await f.integrations.read(f.admin, "payment")).source,
      "none",
    );
    assert.equal(await f.integrations.gateway("alpha", f.gateway), f.gateway);
    await assert.rejects(
      f.integrations.save(f.admin, "payment", {
        ...payment,
        clientSecret: undefined,
      }),
      /integration_credentials_required/,
    );
    await assert.rejects(
      f.integrations.save(f.admin, "payment", {
        ...payment,
        mode: "production",
      }),
      /production_payments_not_approved/,
    );
    await f.integrations.save(f.admin, "payment", payment);
    const read = await f.integrations.read(f.admin, "payment");
    assert.equal(read.source, "saved");
    assert.ok(!JSON.stringify(read).includes(payment.clientSecret));
    assert.equal((await f.integrations.gateway("alpha"))?.mode, "sandbox");
    const onboarding = new OnboardingService(f.db, {
      ...f.options,
      resolveGateway: (slug, manager) =>
        f.integrations.gateway(slug, undefined, manager),
    });
    assert.equal((await onboarding.read(f.investor)).paymentEnabled, true);
    await f.integrations.save(f.admin, "payment", {
      ...payment,
      version: 1,
      enabled: false,
      clientSecret: undefined,
    });
    assert.equal(await f.integrations.gateway("alpha", f.gateway), undefined);
    assert.equal((await onboarding.read(f.investor)).paymentEnabled, false);
    await f.query(
      "INSERT INTO subscription_orders(id,tenant_id,membership_id,status) VALUES (?,?,?,'quoted')",
      [randomUUID(), f.tenantId, f.memberId],
    );
    assert.equal((await f.integrations.read(f.admin, "payment")).locked, true);
    await assert.rejects(
      f.integrations.save(f.admin, "payment", { ...payment, version: 2 }),
      /payment_settings_locked/,
    );
    f.env.CASHFREE_MERCHANTS_JSON = JSON.stringify({
      beta: {
        clientId: "env-client",
        clientSecret: "env-private-secret",
        mode: "sandbox",
      },
    });
    const beta = { token: "foreign-token", tenantId: f.otherTenantId };
    const old = await f.integrations.read(beta, "payment");
    assert.equal(old.source, "environment");
    assert.equal(old.configured, true);
    assert.ok(!JSON.stringify(old).includes("env-private-secret"));
    await f.integrations.save(beta, "payment", {
      ...payment,
      clientSecret: undefined,
    });
    assert.equal((await f.integrations.read(beta, "payment")).source, "saved");
    f.env.NODE_ENV = "production";
    await assert.rejects(
      f.integrations.save(beta, "payment", { ...payment, version: 1 }),
      /sandbox_forbidden_in_production/,
    );
    f.env.DB_ENV = "prod";
    f.env.ONBOARDING_PRODUCTION_APPROVED = "true";
    await f.integrations.save(beta, "payment", {
      ...payment,
      version: 1,
      mode: "production",
    });
    assert.equal((await f.integrations.gateway("beta"))?.mode, "production");
  } finally {
    f.close();
  }
});

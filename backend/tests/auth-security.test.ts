import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { Pool } from "mysql2/promise";
import * as Sentry from "@sentry/node";
import { clientIp, trustedProxies } from "../src/auth/client-ip";
import { authMailer } from "../src/auth/email";
import { databaseRateLimiter } from "../src/auth/rate-limit";
import { requestMonitoring, monitorTenant } from "../src/monitoring";
import { configureServerMonitoring, redactAuthUrl } from "../src/instrument";

test("proxy trust follows explicit right-to-left boundaries and discards spoofed or malformed hops", () => {
  const trust = trustedProxies("127.0.0.1,10.0.0.0/24,2001:db8::/64");
  const request = (remoteAddress?: string, value?: unknown) =>
    ({
      socket: { remoteAddress },
      headers: { "x-forwarded-for": value },
    }) as unknown as Request;
  assert.equal(
    clientIp(request("::ffff:127.0.0.1", "203.0.113.4, 10.0.0.7"), trust),
    "203.0.113.4",
  );
  assert.equal(
    clientIp(request("127.0.0.1", "192.0.2.9, 203.0.113.4"), trust),
    "203.0.113.4",
  );
  assert.equal(
    clientIp(request("203.0.113.5", "192.0.2.9"), trust),
    "203.0.113.5",
  );
  assert.equal(clientIp(request("127.0.0.1", "bad"), trust), "127.0.0.1");
  assert.equal(
    clientIp(request("127.0.0.1", Array(34).fill("1.1.1.1").join(",")), trust),
    "127.0.0.1",
  );
  assert.equal(clientIp(request("127.0.0.1"), trust), "127.0.0.1");
  assert.equal(clientIp(request(), trust), "unknown");
  assert.equal(trust("2001:db8::1"), true);
  assert.equal(
    clientIp(request("127.0.0.1", "1.1.1.1"), trustedProxies()),
    "127.0.0.1",
  );
  for (const value of [
    "true",
    "1",
    "0.0.0.0/0",
    "127.0.0.1/33",
    "::/129",
    "127.0.0.1/no",
    "127.0.0.1/8/2",
  ])
    assert.throws(() => trustedProxies(value));
});

test("Resend delivery is explicit, bounded, origin-checked and never propagates provider secrets", async () => {
  assert.equal(authMailer({}), undefined);
  for (const env of [
    { NODE_ENV: "production" },
    { RESEND_API_KEY: "test" },
    { AUTH_EMAIL_FROM: "bad\nsender" },
  ])
    assert.throws(() => authMailer(env));
  const env = {
    RESEND_API_KEY: "secret",
    AUTH_EMAIL_FROM: "Accounts <accounts@example.test>",
    AUTH_BASE_URL: "https://example.test",
  };
  const sent: { subject: string; text: string }[] = [];
  const mail = authMailer(env, (async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.ok(init?.signal);
    sent.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 200 });
  }) as typeof fetch)!;
  for (const kind of ["verify", "reset"] as const)
    await mail({
      to: "user@example.test",
      url: "https://example.test/api/auth/link",
      kind,
    });
  assert.match(sent[0].subject, /Verify/);
  assert.match(sent[1].subject, /Reset/);
  await assert.rejects(
    mail({ to: "user@example.test", url: "https://evil.test/", kind: "reset" }),
    /origin/,
  );
  for (const transport of [
    async () => new Response("secret provider payload", { status: 429 }),
    async () => {
      throw new Error("private recipient");
    },
  ])
    await assert.rejects(
      authMailer(env, transport as typeof fetch)!({
        to: "user@example.test",
        url: "https://example.test/link",
        kind: "verify",
      }),
      { message: "Authentication email delivery failed" },
    );
});

test("shared limiter resets expired windows, denies full buckets and releases resources on failure", async () => {
  const state = {
    elapsed: 0,
    hits: 0,
    failed: false,
    released: 0,
    rolledBack: 0,
  };
  const calls: string[] = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {
      state.rolledBack++;
    },
    release: () => {
      state.released++;
    },
    execute: async (sql: string, params: unknown[]) => {
      calls.push(sql);
      assert.ok(!params.includes("raw-ip"));
      if (state.failed) throw new Error("unavailable");
      if (sql.startsWith("SELECT"))
        return [[{ hits: state.hits, elapsed: state.elapsed }]];
      return [[]];
    },
  };
  const limiter = databaseRateLimiter({
    getConnection: async () => connection,
  } as unknown as Pool);
  assert.deepEqual(await limiter.consume("raw-ip", { max: 3, window: 60 }), {
    allowed: true,
    retryAfter: null,
  });
  state.hits = 3;
  state.elapsed = 2;
  assert.deepEqual(await limiter.consume("raw-ip", { max: 3, window: 60 }), {
    allowed: false,
    retryAfter: 58,
  });
  state.elapsed = 61;
  assert.equal(
    (await limiter.consume("raw-ip", { max: 3, window: 60 })).allowed,
    true,
  );
  assert.ok(calls.some((sql) => sql.includes("SET hits=1")));
  state.failed = true;
  await assert.rejects(
    limiter.consume("raw-ip", { max: 3, window: 60 }),
    /unavailable/,
  );
  assert.equal(state.released, 4);
  assert.equal(state.rolledBack, 1);
});

test("concurrent monitoring scopes retain their own request and resolved tenant tags", async () => {
  Sentry.init({ integrations: [], tracesSampleRate: 1 });
  const results = await Promise.all(
    ["alpha", "beta"].map(
      (tenant) =>
        new Promise<Record<string, unknown>>((resolve) => {
          requestMonitoring(
            {} as Request,
            { setHeader: () => {} } as unknown as Response,
            () => {
              Sentry.startSpan({ name: "request" }, async () => {
                monitorTenant(tenant);
                await new Promise<void>((done) => setImmediate(done));
                resolve(Sentry.getIsolationScope().getScopeData().tags);
              });
            },
          );
        }),
    ),
  );
  assert.equal(results[0].tenant_id, "alpha");
  assert.equal(results[1].tenant_id, "beta");
  assert.notEqual(results[0].request_id, results[1].request_id);
  assert.equal(
    Sentry.getIsolationScope().getScopeData().tags.tenant_id,
    undefined,
  );
  await Sentry.close();
});

test("monitoring redacts reset credentials in event URLs and streamed spans", () => {
  assert.equal(
    redactAuthUrl(
      "https://example.test/api/auth/reset-password/secret?token=secret",
    ),
    "https://example.test/api/auth/reset-password/[Filtered]?token=[Filtered]",
  );
  configureServerMonitoring(
    { SENTRY_DSN: "https://test@example.test/1" },
    (options) => {
      const event = {
        type: undefined,
        request: { url: "/api/auth/reset-password/private" },
        transaction: "GET /api/auth/reset-password/private",
      };
      options!.beforeSend!(event, {});
      assert.ok(!JSON.stringify(event).includes("private"));
      options!.beforeSend!({ type: undefined }, {});
      const span = {
        name: "GET /api/auth/reset-password/private",
        attributes: { "url.full": "https://example.test/?token=private" },
      };
      options!.beforeSendSpan!(span as never);
      assert.ok(!JSON.stringify(span).includes("private"));
      return undefined;
    },
  );
});

test("configured authentication installs shared counters and framework-owned verification/reset callbacks", async () => {
  const { createPool } = await import("mysql2/promise");
  const { authOptions } = await import("../src/auth/config");
  const pool = createPool({ host: "127.0.0.1" });
  try {
    const messages: string[] = [];
    const options = authOptions(
      pool,
      "a-secret-with-at-least-thirty-two-characters",
      "https://example.test",
      {
        sharedRateLimit: true,
        mailer: async (message) => {
          messages.push(message.kind);
        },
      },
    );
    assert.ok(options.rateLimit?.customStorage?.consume);
    assert.equal(options.emailAndPassword?.requireEmailVerification, true);
    assert.equal(options.emailAndPassword?.revokeSessionsOnPasswordReset, true);
    assert.equal(options.emailVerification?.autoSignInAfterVerification, false);
    await options.emailVerification!.sendVerificationEmail!({
      user: { email: "test@example.test" },
      url: "https://example.test/verify",
    } as never);
    await options.emailAndPassword!.sendResetPassword!({
      user: { email: "test@example.test" },
      url: "https://example.test/reset",
    } as never);
    assert.deepEqual(messages, ["verify", "reset"]);
  } finally {
    await pool.end();
  }
});

test("monitoring annotates an existing request span without leaking global tags", async () => {
  Sentry.init({ integrations: [], tracesSampleRate: 1 });
  Sentry.startSpan({ name: "outer request" }, () => {
    requestMonitoring(
      {} as Request,
      { setHeader: () => {} } as unknown as Response,
      () => {
        monitorTenant("tenant");
        assert.equal(
          Sentry.spanToJSON(Sentry.getActiveSpan()!).attributes["tenant.id"],
          "tenant",
        );
      },
    );
  });
  await Sentry.close();
});

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

test("Hostinger SMTP validates complete credentials, TLS and sender identity before enabling mail", async () => {
  assert.equal(authMailer({}), undefined);
  const env = {
    SMTP_HOST: "smtp.hostinger.com",
    SMTP_PORT: "465",
    SMTP_USER: "support@example.test",
    SMTP_PASSWORD: "mailbox-secret",
    AUTH_EMAIL_FROM: "support@example.test",
    AUTH_BASE_URL: "https://example.test",
  };
  for (const invalid of [
    { NODE_ENV: "production" },
    { SMTP_HOST: "smtp.hostinger.com" },
    { ...env, SMTP_PASSWORD: "" },
    { ...env, SMTP_USER: "bad\nuser" },
    { ...env, AUTH_EMAIL_FROM: "other@example.test" },
    { ...env, AUTH_EMAIL_FROM: "bad\nsender" },
    { ...env, SMTP_HOST: "evil.test" },
    { ...env, SMTP_PORT: "25" },
    { ...env, AUTH_BASE_URL: "invalid" },
    { ...env, SMTP_USER: "invalid" },
  ])
    assert.throws(() => authMailer(invalid));
  for (const port of [undefined, "465", "587"]) {
    let closed = 0;
    const sent: { subject?: string; text?: string }[] = [];
    const mail = authMailer({ ...env, SMTP_PORT: port }, (options) => {
      assert.equal(options.host, "smtp.hostinger.com");
      assert.equal(options.port, port === "587" ? 587 : 465);
      assert.equal(options.secure, port !== "587");
      assert.equal(options.requireTLS, true);
      assert.deepEqual(options.auth, {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      });
      assert.equal(options.tls?.rejectUnauthorized, true);
      assert.equal(options.connectionTimeout, 10000);
      assert.equal(options.greetingTimeout, 10000);
      assert.equal(options.socketTimeout, 10000);
      assert.equal(options.logger, false);
      assert.equal(options.debug, false);
      assert.equal(options.disableFileAccess, true);
      assert.equal(options.disableUrlAccess, true);
      return {
        sendMail: async (message) => {
          assert.equal(message.from, env.AUTH_EMAIL_FROM);
          assert.equal(message.to, "user@example.test");
          sent.push(message as { subject: string; text: string });
          return { accepted: ["user@example.test"], rejected: [] };
        },
        close: () => {
          closed++;
        },
      };
    })!;
    for (const kind of ["verify", "reset", "invite"] as const)
      await mail({
        to: "user@example.test",
        url: "https://example.test/link",
        fullName: "Ada Lovelace",
        kind,
      });
    assert.match(sent[0].subject!, /Verify/);
    assert.match(sent[1].subject!, /Reset/);
    assert.match(sent[2].text!, /this invitation confirms the invited email/);
    assert.match(sent[2].text!, /^Hello Ada Lovelace,/);
    assert.doesNotMatch(sent[0].text!, /Hello Ada/);
    assert.equal(closed, 3);
    await assert.rejects(
      mail({
        to: "user@example.test",
        url: "https://evil.test/link",
        kind: "verify",
      }),
      /origin/,
    );
    await assert.rejects(
      mail({
        to: "bad\nrecipient@example.test",
        url: "https://example.test/link",
        kind: "verify",
      }),
      /recipient/,
    );
  }
});

test("SMTP failures and rejected recipients redact credentials and always close the transport", async () => {
  const env = {
    SMTP_USER: "support@example.test",
    SMTP_PASSWORD: "secret",
    AUTH_EMAIL_FROM: "support@example.test",
    AUTH_BASE_URL: "https://example.test",
  };
  for (const outcome of ["throw", "rejected", "unaccepted"]) {
    let closed = 0;
    const mail = authMailer(env, () => ({
      sendMail: async () => {
        if (outcome === "throw")
          throw new Error("private provider credentials and recipient");
        return {
          accepted: outcome === "rejected" ? ["user@example.test"] : [],
          rejected: outcome === "rejected" ? ["user@example.test"] : [],
        };
      },
      close: () => {
        closed++;
      },
    }))!;
    await assert.rejects(
      mail({
        to: "user@example.test",
        url: "https://example.test/link",
        kind: "verify",
      }),
      { message: "Authentication email delivery failed" },
    );
    assert.equal(closed, 1);
  }
  const mail = authMailer(env, () => {
    throw new Error("secret config");
  })!;
  await assert.rejects(
    mail({
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

test("SMTP total deadline releases the transport without retaining timers or secrets", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let closed = 0;
  const mail = authMailer(
    {
      SMTP_USER: "support@example.test",
      SMTP_PASSWORD: "secret",
      AUTH_EMAIL_FROM: "support@example.test",
      AUTH_BASE_URL: "https://example.test",
    },
    () => ({
      sendMail: () => new Promise(() => {}),
      close: () => {
        closed++;
      },
    }),
  )!;
  const delivery = mail({
    to: "user@example.test",
    url: "https://example.test/link",
    kind: "verify",
  });
  const rejected = assert.rejects(delivery, {
    message: "Authentication email delivery failed",
  });
  context.mock.timers.tick(10000);
  await rejected;
  assert.equal(closed, 1);
});

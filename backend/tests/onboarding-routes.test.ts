import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import type { AuthRoutesDependencies } from "../src/auth/routes";
import type { Workspace } from "../src/auth/workspaces";
import { mountOnboarding } from "../src/onboarding/routes";
import type { OnboardingService } from "../src/onboarding/service";
import { OnboardingError } from "../src/onboarding/domain";
import { tenants } from "../src/tenants/tenants";
/** Exercise real Express onboarding routing and parsers with controlled session and service adapters. */
function harness() {
  const state = {
    signedIn: true,
    verified: true,
    role: "owner",
    failure: null as unknown,
    calls: [] as { operation: string; input: unknown[] }[],
  };
  const auth = {
    api: {
      getSession: async () =>
        state.signedIn
          ? {
              user: {
                id: "user",
                name: "User",
                email: "user@test.local",
                emailVerified: state.verified,
              },
              session: { token: "private-token" },
            }
          : null,
    },
  } as unknown as AuthRoutesDependencies["auth"];
  const store = {
    find: async (_user: string, slug: string) =>
      slug === tenants[0].slug
        ? ({
            tenant: tenants[0],
            membership: { role: state.role },
            capabilities: [],
          } as unknown as Workspace)
        : null,
  } as AuthRoutesDependencies["store"];
  const service = new Proxy(
    {},
    {
      get:
        (_target, operation) =>
        async (...input: unknown[]) => {
          state.calls.push({ operation: String(operation), input });
          if (state.failure) throw state.failure;
          return { ok: true };
        },
    },
  ) as OnboardingService;
  const app = express();
  mountOnboarding(app, {
    auth,
    store,
    service,
    origin: "http://localhost:3000",
    page: (res, _next, tenant, view) => {
      res.json({ tenant, view });
    },
  });
  /** Stream a literal request through Express and collect the HTTP response as the browser would. */
  async function request(
    url: string,
    method = "GET",
    body?: Buffer,
    headers: Record<string, string> = {},
  ) {
    const chunks: Buffer[] = [];
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    });
    const req = new IncomingMessage(socket as Socket);
    req.url = url;
    req.method = method;
    req.httpVersion = "1.0";
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 0;
    req.complete = true;
    req.headers = {
      host: "localhost:3000",
      ...(body
        ? {
            "content-length": String(body.length),
            "content-type": "application/json",
          }
        : {}),
      ...headers,
    };
    const res = new ServerResponse(req);
    res.assignSocket(socket as Socket);
    try {
      await new Promise<void>((resolve, reject) => {
        res.on("finish", resolve);
        res.on("error", reject);
        app(req, res);
        if (body) req.push(body);
        req.push(null);
      });
      return {
        status: res.statusCode,
        headers: res.getHeaders(),
        body: Buffer.concat(chunks)
          .toString()
          .split("\r\n\r\n")
          .slice(1)
          .join("\r\n\r\n"),
      };
    } finally {
      socket.destroy();
    }
  }
  return { state, request };
}

const path = `/api/workspaces/${tenants[0].slug}/onboarding`;
const origin = { origin: "http://localhost:3000" };
test("onboarding APIs derive identity and tenant, enforce origin, parse bounded JSON and route every supported action", async () => {
  const { state, request } = harness();
  assert.equal(
    (await request(`${path}?customer=selected&before=cursor`)).status,
    200,
  );
  assert.deepEqual(state.calls[0].input, [
    { token: "private-token", tenantId: tenants[0].id },
    "selected",
    "cursor",
  ]);
  assert.equal(
    (await request(`${path}?customer[bad]=x&before[bad]=x`)).status,
    200,
  );
  for (const action of [
    "plan",
    "coupon",
    "settings",
    "kyc-save",
    "kyc-submit",
    "review",
    "quote",
    "code",
    "sign",
    "skip",
    "payment",
    "confirm",
    "cancel",
  ]) {
    assert.equal(
      (
        await request(
          `${path}/${action}`,
          "POST",
          Buffer.from('{"orderId":"test"}'),
          origin,
        )
      ).status,
      200,
      action,
    );
  }
  assert.equal(
    (await request(`${path}/unknown`, "POST", Buffer.from("{}"), origin))
      .status,
    404,
  );
  assert.equal(
    (await request(`${path}/quote`, "POST", Buffer.from("[]"), origin)).status,
    400,
  );
  assert.equal(
    (await request(`${path}/quote`, "POST", undefined, origin)).status,
    400,
  );
  assert.equal(
    (await request(`${path}/quote`, "POST", Buffer.from("bad-json"), origin))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        `${path}/quote`,
        "POST",
        Buffer.from(JSON.stringify({ value: "x".repeat(66000) })),
        origin,
      )
    ).status,
    413,
  );
  assert.equal(
    (await request(`${path}/quote`, "POST", Buffer.from("{}"))).status,
    403,
  );
  state.role = "support";
  assert.equal((await request(path)).status, 403);
  state.role = "subscriber";
  assert.equal((await request(path)).status, 200);
  assert.equal(
    (await request("/api/workspaces/unknown/onboarding")).status,
    404,
  );
  state.verified = false;
  assert.equal((await request(path)).status, 401);
  state.signedIn = false;
  assert.equal((await request(path)).status, 401);
});
test("onboarding routes sanitize errors and webhook raw bytes without requiring a browser session", async () => {
  const { state, request } = harness();
  state.failure = new Error("secret database details");
  const response = await request(path);
  assert.equal(response.status, 503);
  assert.ok(!response.body.includes("secret"));
  state.failure = new OnboardingError("specific_failure", 409);
  assert.equal((await request(path)).status, 409);
  state.failure = { code: "ER_DUP_ENTRY" };
  assert.equal((await request(path)).status, 409);
  state.failure = null;
  state.signedIn = false;
  const raw = Buffer.from('{"type":"event"}');
  assert.equal(
    (
      await request("/api/onboarding/webhooks/alpha", "POST", raw, {
        "x-webhook-timestamp": "timestamp",
        "x-webhook-signature": "signature",
      })
    ).status,
    200,
  );
  assert.deepEqual(state.calls.at(-1)?.input, [
    "alpha",
    raw,
    "timestamp",
    "signature",
  ]);
  assert.equal(
    (await request("/api/onboarding/webhooks/alpha", "POST")).status,
    400,
  );
  assert.equal(
    (await request("/api/onboarding/webhooks/alpha", "POST", raw)).status,
    200,
  );
});
test("onboarding pages scope investor/admin navigation and redirect unauthenticated sessions", async () => {
  const { state, request } = harness();
  const base = `/ra/${tenants[0].slug}`;
  for (const suffix of ["plans", "users", "users/member-id"]) {
    const result = await request(`${base}/workspace/${suffix}`);
    assert.equal(result.status, 200);
    const projection = JSON.parse(result.body);
    assert.equal(projection.view.area, "organisation");
    assert.equal(projection.view.onboardingEnabled, true);
  }
  assert.equal((await request(`${base}/account/onboarding`)).status, 403);
  state.role = "subscriber";
  const investor = await request(`${base}/account/onboarding`);
  assert.equal(investor.status, 200);
  assert.equal(JSON.parse(investor.body).view.section, "onboarding");
  assert.equal((await request(`${base}/workspace/users`)).status, 403);
  assert.equal((await request("/ra/unknown/account/onboarding")).status, 403);
  state.verified = false;
  assert.equal((await request(`${base}/account/onboarding`)).status, 303);
  state.signedIn = false;
  assert.equal((await request(`${base}/workspace/users`)).status, 303);
});

test("queue status and retry routes derive their context from the authenticated workspace", async () => {
  const { request, state } = harness();
  const base = `/api/workspaces/${tenants[0].slug}/onboarding`;
  assert.equal((await request(`${base}/jobs`)).status, 200);
  assert.equal(state.calls.at(-1)?.operation, "queueStatus");
  assert.equal(
    (
      await request(
        `${base}/retry-job`,
        "POST",
        Buffer.from(JSON.stringify({ orderId: "order" })),
        { origin: "http://localhost:3000" },
      )
    ).status,
    200,
  );
  assert.equal(state.calls.at(-1)?.operation, "retryJob");
});

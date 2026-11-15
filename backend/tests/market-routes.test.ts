import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import type { AuthRoutesDependencies } from "../src/auth/routes";
import type { Workspace } from "../src/auth/workspaces";
import { mountMarket } from "../src/market/routes";
import type { MarketService } from "../src/market/service";
import { OnboardingError } from "../src/onboarding/domain";
import { tenants } from "../src/tenants/tenants";
/** Exercise real Express market routing and parsers with controlled session and service adapters. */
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
  ) as MarketService;
  const app = express();
  mountMarket(app, {
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

test("market API authorizes verified owners, binds tenant context, limits payloads and sanitizes errors", async () => {
  const { state, request } = harness();
  const base = `/api/workspaces/${tenants[0].slug}/market`;
  const origin = { origin: "http://localhost:3000" };
  const body = Buffer.from(JSON.stringify({ keys: ["NSE_EQ|INE1"] }));
  for (const [url, method, payload] of [
    [base, "GET", undefined],
    [`${base}/instruments`, "GET", undefined],
    [`${base}/instruments?q=EX&type=EQ&expiry=2026-11-30`, "GET", undefined],
    [base, "POST", body],
    [`${base}/check`, "POST", body],
  ] as const) {
    const r = await request(url, method, payload, origin);
    assert.equal(r.status, 200);
    assert.equal(r.headers["cache-control"], "no-store");
  }
  assert.deepEqual(state.calls[2], {
    operation: "search",
    input: [
      { token: "private-token", tenantId: tenants[0].id },
      "EX",
      "EQ",
      "2026-11-30",
    ],
  });
  assert.deepEqual(state.calls[4].input[1], ["NSE_EQ|INE1"]);
  assert.equal((await request(base, "POST", body)).status, 403);
  assert.equal(
    (await request(base, "POST", body, { origin: "https://wrong.test" }))
      .status,
    403,
  );
  for (const keys of [
    undefined,
    "bad",
    [7],
    ["x".repeat(160)],
    Array(11).fill("x"),
  ])
    assert.equal(
      (
        await request(
          `${base}/check`,
          "POST",
          Buffer.from(JSON.stringify({ keys })),
          origin,
        )
      ).status,
      400,
    );
  assert.equal(
    (await request(base, "POST", Buffer.from("x".repeat(33000)), origin))
      .status,
    413,
  );
  state.failure = new OnboardingError("market_version_conflict", 409);
  assert.equal((await request(base)).status, 409);
  state.failure = new Error("private database credentials");
  const failed = await request(base);
  assert.equal(failed.status, 503);
  assert.ok(!failed.body.includes("credentials"));
  state.failure = null;
  assert.equal((await request("/api/workspaces/missing/market")).status, 403);
  state.role = "subscriber";
  assert.equal((await request(base)).status, 403);
  state.role = "owner";
  state.verified = false;
  assert.equal((await request(base)).status, 401);
  state.verified = true;
  state.signedIn = false;
  assert.equal((await request(base)).status, 401);
});
test("market page redirects unverified visitors and never renders another tenant or investor workspace", async () => {
  const { state, request } = harness();
  const url = `/ra/${tenants[0].slug}/workspace/market`;
  let r = await request(url);
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).view.section, "market");
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal((await request("/ra/missing/workspace/market")).status, 403);
  state.role = "subscriber";
  assert.equal((await request(url)).status, 403);
  state.role = "owner";
  state.verified = false;
  r = await request(url);
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, `/ra/${tenants[0].slug}/login`);
  state.signedIn = false;
  assert.equal((await request(url)).status, 303);
});

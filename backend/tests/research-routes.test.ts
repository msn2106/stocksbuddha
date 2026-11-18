import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import type { AuthRoutesDependencies } from "../src/auth/routes";
import type { Workspace } from "../src/auth/workspaces";
import { mountResearch } from "../src/research/routes";
import type { ResearchService } from "../src/research/service";
import { OnboardingError } from "../src/onboarding/domain";
import { tenants } from "../src/tenants/tenants";
/** Exercise real Express research routing and parsers with controlled session and service adapters. */
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
  ) as ResearchService;
  const app = express();
  mountResearch(app, {
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

test("research routes bind current tenant, require origin and verified roles, and expose safe errors", async () => {
  const { state, request } = harness();
  const base = `/api/workspaces/${tenants[0].slug}/recommendations`;
  const origin = { origin: "http://localhost:3000" };
  const body = Buffer.from(JSON.stringify({ version: 2 }));
  for (const [path, method] of [
    ["?page=1", "GET"],
    ["/options", "GET"],
    ["/report", "GET"],
    ["", "POST"],
    ["/groups", "POST"],
    ["/report/preview", "POST"],
    ["/report/publish", "POST"],
    ["/report/close", "POST"],
    ["/report/read", "POST"],
  ]) {
    const r = await request(
      base + path,
      method,
      method === "POST" ? body : undefined,
      origin,
    );
    assert.equal(r.status, 200);
    assert.equal(r.headers["cache-control"], "no-store");
  }
  assert.deepEqual(state.calls[0], {
    operation: "list",
    input: [{ token: "private-token", tenantId: tenants[0].id }, 1],
  });
  assert.equal((await request(base, "POST", body)).status, 403);
  state.role = "analyst";
  assert.equal((await request(base)).status, 403);
  state.role = "subscriber";
  assert.equal((await request(base)).status, 200);
  state.verified = false;
  assert.equal((await request(base)).status, 401);
  state.verified = true;
  state.failure = new OnboardingError("research_version_conflict", 409);
  assert.equal((await request(base)).status, 409);
  state.failure = new Error("private database details");
  const failed = await request(base);
  assert.equal(failed.status, 503);
  assert.doesNotMatch(failed.body, /private database/);
  state.failure = null;
  assert.equal(
    (
      await request(
        base,
        "POST",
        Buffer.from('"' + "x".repeat(140000) + '"'),
        origin,
      )
    ).status,
    413,
  );
  state.role = "owner";
  assert.equal(
    (await request(`/ra/${tenants[0].slug}/workspace/recommendations`)).status,
    200,
  );
  assert.equal(
    (await request(`/ra/${tenants[0].slug}/account/recommendations`)).status,
    403,
  );
  state.signedIn = false;
  assert.equal(
    (await request(`/ra/${tenants[0].slug}/account/recommendations`)).status,
    303,
  );
});

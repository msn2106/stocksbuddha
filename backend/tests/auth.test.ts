import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import type { DataSource } from "typeorm";
import { createPublicApp } from "../src/app";
import {
  createAuthRoutes,
  type AuthRoutesDependencies,
} from "../src/auth/routes";
import { MariaDbWorkspaceStore, type Workspace } from "../src/auth/workspaces";
import { DatabaseConflict } from "../src/database/operations";
import { currentAuthTenant } from "../src/auth/tenant-context";
import { tenants } from "../src/tenants/tenants";
import { makePage } from "../../packages/contracts/tests/fixtures";
import { canAccessTenant, type TenantRole } from "../src/access/authorization";

const tenant = tenants[0];
const memberId = randomUUID(),
  userId = randomUUID(),
  key = randomUUID();
const origin = "http://localhost:3000";
/** Control identity, stored membership, auth responses and transaction failures independently. */
function harness(options: Partial<AuthRoutesDependencies> = {}) {
  const workspace: Workspace = {
    tenant: structuredClone(tenant),
    membership: {
      id: memberId,
      userId,
      tenantId: tenant.id,
      role: "owner",
      status: "active",
      version: 1,
    },
    capabilities: ["staff:manage", "website:edit"],
  };
  const state = {
    signedIn: true,
    available: true,
    membershipAvailable: true,
    workspaces: [workspace],
    authStatus: 200,
    authCode: "",
    failure: null as Error | null,
    sessionFailure: false,
  };
  const calls: unknown[][] = [];
  const dependencies: AuthRoutesDependencies = {
    baseURL: origin,
    auth: {
      handler: async (request: Request) => {
        calls.push([
          "auth",
          request.url,
          request.headers.get("cookie"),
          request.headers.get("x-auth-client-ip"),
          request.method === "POST" ? await request.text() : "",
          currentAuthTenant(),
        ]);
        return new Response(JSON.stringify({ code: state.authCode }), {
          status: state.authStatus,
          headers: {
            "set-cookie":
              "better-auth.session_token=signed; HttpOnly; SameSite=Lax; Path=/",
            "content-type": "application/json",
          },
        });
      },
      api: {
        getSession: (async ({ headers }: { headers: Headers }) => {
          calls.push(["session", headers.get("cookie")]);
          if (state.sessionFailure) throw new Error("private driver error");
          return state.signedIn
            ? {
                user: { id: userId, name: "User", email: "user@example.test" },
                session: {
                  token: "server-token",
                  expiresAt: new Date("2026-12-01"),
                },
              }
            : null;
        }) as AuthRoutesDependencies["auth"]["api"]["getSession"],
      },
    },
    store: {
      list: async (id) => {
        calls.push(["list", id]);
        return state.workspaces;
      },
      find: async (id, slug) => {
        calls.push(["find", id, slug]);
        return state.available &&
          state.membershipAvailable &&
          slug === tenant.slug
          ? workspace
          : null;
      },
      tenant: async (slug) =>
        state.available && slug === tenant.slug ? tenant : null,
      members: async (id) => {
        calls.push(["members", id]);
        return [workspace.membership];
      },
    },
    operations: {
      enroll: async (context) => {
        calls.push(["enroll", context]);
        if (state.failure) throw state.failure;
        return { membershipId: memberId };
      },
      changeMembership: async (...args) => {
        calls.push(["change", ...args]);
        if (state.failure) throw state.failure;
        return { membershipId: memberId, version: 2 };
      },
    },
  };
  const app = createPublicApp({
    authentication: createAuthRoutes({ ...dependencies, ...options }),
    resolvePage: async () => makePage(),
    renderPage: async (data) => ({
      template: "<!--app-html-->",
      html: JSON.stringify(data.account ?? "public"),
      head: "",
      data: "",
      lang: "en",
    }),
    onError: () => {},
  });
  /** Exercise actual Express middleware and parsers over an in-memory HTTP transport. */
  async function request(
    url: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const chunks: Buffer[] = [];
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    const req = new IncomingMessage(socket as Socket);
    req.url = url;
    req.method = method;
    req.httpVersion = "1.0";
    req.httpVersionMajor = 1;
    req.complete = true;
    req.httpVersionMinor = 0;
    const data = body === undefined ? undefined : JSON.stringify(body);
    req.headers = {
      host: "localhost:3000",
      cookie: "better-auth.session_token=signed",
      ...(data
        ? {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(data)),
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
        if (data) req.push(data);
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
  return { state, calls, workspace, request };
}

test("auth forms forward only credentials, preserve cookies, reject foreign origins and handle failed sign-in/out", async () => {
  const { request, state, calls } = harness();
  for (const path of ["/ra/stocksbuddha/login", "/ra/stocksbuddha/signup"]) {
    const form = await request(path);
    assert.equal(form.status, 200);
    assert.ok(JSON.parse(form.body).mode);
    assert.match(
      String(form.headers["content-security-policy"]),
      /frame-ancestors 'none'/,
    );
    assert.equal(
      (await request(path, "POST", {}, { origin: "https://evil.test" })).status,
      403,
    );
    const result = await request(
      path,
      "POST",
      {
        email: "u@example.test",
        password: "password123",
        name: "Name",
        platform_role: "owner",
        role: "owner",
        signupTenantId: "forged",
        loginTenantId: "forged",
      },
      { origin },
    );
    assert.equal(result.status, 303);
    assert.equal(result.headers.location, "/ra/stocksbuddha/workspace");
    assert.ok(result.headers["set-cookie"]);
    assert.equal(String(calls.at(-1)).includes("platform_role"), false);
    assert.equal(String(calls.at(-1)?.[4]).includes("forged"), false);
    assert.equal(calls.at(-1)?.[5], tenant.id);
    assert.equal(currentAuthTenant(), null);
    state.authStatus = 400;
    assert.match(
      (await request(path, "POST", {}, { origin })).body,
      /credentials/,
    );
    state.authStatus = 200;
  }
  assert.equal((await request("/ra/stocksbuddha/logout", "POST")).status, 403);
  assert.equal(
    (await request("/ra/stocksbuddha/logout", "POST", undefined, { origin }))
      .headers.location,
    "/ra/stocksbuddha/login",
  );
  state.authStatus = 401;
  assert.equal(
    (await request("/ra/stocksbuddha/logout", "POST", undefined, { origin }))
      .status,
    401,
  );
  state.authStatus = 200;
  assert.equal((await request("/api/auth/get-session", "GET")).status, 200);
  assert.equal(
    (
      await request(
        "/api/auth/sign-in/email",
        "POST",
        {},
        { origin, "x-auth-client-ip": "forged" },
      )
    ).status,
    200,
  );
  assert.equal(calls.at(-1)?.[3], "unknown");
  assert.equal(calls.at(-1)?.[5], null);
  const publicPage = await request("/ra/stocksbuddha");
  assert.equal(publicPage.headers["content-security-policy"], undefined);
});

test("private pages and APIs require sessions and current tenant membership on every request", async () => {
  const { request, state, calls, workspace } = harness();
  state.signedIn = false;
  for (const path of [
    "/api/session",
    "/api/workspaces",
    "/api/workspaces/stocksbuddha/members",
    "/api/workspaces/unknown",
  ])
    assert.equal((await request(path)).status, 401);
  assert.equal(
    (await request("/ra/stocksbuddha/workspace")).headers.location,
    "/ra/stocksbuddha/login",
  );
  assert.equal(
    calls.some((call) => call[0] === "find"),
    false,
  );
  state.signedIn = true;
  const session = await request("/api/session");
  assert.equal(session.status, 200);
  assert.equal(session.body.includes("server-token"), false);
  for (const path of [
    "/api/workspaces",
    "/api/workspaces/stocksbuddha",
    "/workspace",
    "/ra/stocksbuddha/workspace",
    "/api/workspaces/stocksbuddha/members",
  ])
    assert.equal((await request(path)).status, 200);
  assert.deepEqual(
    calls.find((call) => call[0] === "find"),
    ["find", userId, "stocksbuddha"],
  );
  for (const path of [
    "/api/workspaces/beta",
    "/api/workspaces/INVALID",
    "/ra/beta/workspace",
    "/ra/stocksbuddha/workspace/unknown",
    "/api/session/unknown",
  ])
    assert.equal((await request(path)).status, 404);
  assert.equal(
    (
      await request(
        "/api/workspaces/stocksbuddha?userId=other&tenantId=beta",
        "GET",
        undefined,
        { "x-tenant-id": "beta" },
      )
    ).status,
    200,
  );
  state.available = false;
  assert.equal((await request("/api/workspaces/stocksbuddha")).status, 404);
  state.available = true;
  workspace.capabilities = [];
  workspace.membership.role = "subscriber";
  assert.match(
    (await request("/ra/stocksbuddha/workspace")).body,
    /subscriber/,
  );
  assert.equal(
    (await request("/api/workspaces/stocksbuddha/members")).status,
    403,
  );
  state.workspaces = [];
  assert.match((await request("/workspace")).body, /"workspaces":\[\]/);
  state.sessionFailure = true;
  const failure = await request("/api/session");
  assert.equal(failure.status, 500);
  assert.equal(failure.body.includes("driver"), false);
});

test("membership mutations enforce origin, capability, validation and guarded transaction outcomes", async () => {
  const { request, state, calls, workspace } = harness();
  const path = `/api/workspaces/stocksbuddha/members/${memberId}`;
  const headers = { origin, "idempotency-key": key };
  const body = {
    role: "analyst",
    active: true,
    version: 1,
    userId: "forged",
    tenantId: "beta",
  };
  assert.equal((await request(path, "PATCH", body)).status, 403);
  workspace.capabilities = [];
  assert.equal((await request(path, "PATCH", body, headers)).status, 403);
  workspace.capabilities = ["staff:manage"];
  for (const change of [
    { role: "platform-owner" },
    { active: "true" },
    { version: 0 },
    { version: 1.5 },
  ])
    assert.equal(
      (await request(path, "PATCH", { ...body, ...change }, headers)).status,
      400,
    );
  assert.equal((await request(path, "PATCH", body, { origin })).status, 400);
  assert.equal(
    (
      await request(
        "/api/workspaces/stocksbuddha/members/bad",
        "PATCH",
        body,
        headers,
      )
    ).status,
    400,
  );
  assert.equal((await request(path, "PATCH", body, headers)).status, 200);
  assert.deepEqual(calls.at(-1)?.slice(0, 2), [
    "change",
    { token: "server-token", tenantId: tenant.id, key },
  ]);
  for (const [code, status] of [
    ["unauthorized", 401],
    ["forbidden", 403],
    ["last_owner", 409],
    ["stale_membership", 409],
    ["idempotency_conflict", 409],
  ] as const) {
    state.failure = new DatabaseConflict(code);
    assert.equal((await request(path, "PATCH", body, headers)).status, status);
  }
  state.failure = new Error("private sql error");
  assert.equal((await request(path, "PATCH", body, headers)).status, 500);
  const enroll = "/api/workspaces/stocksbuddha/membership";
  assert.equal((await request(enroll, "POST")).status, 403);
  assert.equal(
    (await request("/api/workspaces/INVALID/membership", "POST", {}, headers))
      .status,
    404,
  );
  assert.equal((await request(enroll, "POST", {}, { origin })).status, 400);
  for (const [code, status] of [
    ["unauthorized", 401],
    ["enrollment_unavailable", 403],
    ["idempotency_conflict", 409],
  ] as const) {
    state.failure = new DatabaseConflict(code);
    assert.equal((await request(enroll, "POST", {}, headers)).status, status);
  }
  state.failure = new Error("private sql error");
  assert.equal((await request(enroll, "POST", {}, headers)).status, 500);
  state.failure = null;
  assert.equal(
    (await request(enroll, "POST", { role: "owner" }, headers)).status,
    200,
  );
});

test("MariaDB workspace projections enforce active memberships and role policy without platform-owner bypass", async () => {
  let activeTenant = true,
    found = true,
    role: TenantRole | string = "owner";
  let overrides: unknown = "{}";
  const calls: unknown[][] = [];
  const db = {
    query: async (sql: string, params: unknown[]) => {
      calls.push([sql, params]);
      if (sql.includes("JOIN tenants"))
        return activeTenant && found
          ? [
              {
                id: tenant.id,
                slug: tenant.slug,
                status: "active",
                is_synthetic: 0,
                display_name: tenant.profile.name,
                legal_name: tenant.profile.legalName,
                registration_number: tenant.profile.registration,
                monogram: tenant.profile.monogram,
                membership_id: memberId,
                membership_role: role,
                membership_status: "active",
                membership_version: 1,
                capabilities_json: overrides,
              },
            ]
          : [];
      if (sql.includes("FROM tenants"))
        return activeTenant
          ? [
              {
                id: tenant.id,
                slug: tenant.slug,
                status: "active",
                display_name: tenant.profile.name,
                legal_name: tenant.profile.legalName,
                registration_number: tenant.profile.registration,
                monogram: tenant.profile.monogram,
                is_synthetic: 0,
              },
            ]
          : [];
      if (sql.includes("ORDER BY id")) return [];
      return found
        ? [
            {
              id: memberId,
              role,
              status: "active",
              lock_version: 1,
              capabilities_json: overrides,
            },
          ]
        : [];
    },
  } as unknown as DataSource;
  const store = new MariaDbWorkspaceStore(db);
  for (const r of ["owner", "analyst", "support", "subscriber"] as const) {
    role = r;
    const result = await store.find(userId, tenant.slug);
    assert.ok(result);
    for (const capability of [
      "staff:manage",
      "website:edit",
      "research:publish",
      "subscribers:read",
    ] as const)
      assert.equal(
        result.capabilities.includes(capability),
        canAccessTenant(
          { userId, platformRole: "owner" },
          tenant,
          [result.membership],
          capability,
        ),
      );
  }
  assert.equal((await store.list(userId)).length, 1);
  await store.members(tenant.id);
  assert.deepEqual(calls.at(-1)?.[1], [tenant.id]);
  role = "forged";
  assert.equal(await store.find(userId, tenant.slug), null);
  role = "owner";
  found = false;
  assert.equal(await store.find(userId, tenant.slug), null);
  found = true;
  for (const value of [
    null,
    { allow: ["staff:manage"] },
    { deny: ["website:edit"] },
  ]) {
    overrides = value;
    assert.equal(await store.find(userId, tenant.slug), null);
    assert.deepEqual(await store.list(userId), []);
  }
  overrides = { allow: [], deny: [] };
  assert.ok(await store.find(userId, tenant.slug));
  activeTenant = false;
  assert.deepEqual(await store.list(userId), []);
});

test("workspace chooser serves many memberships and concurrent identities within a five-connection pool", async () => {
  let active = 0,
    peak = 0;
  const identities = Array.from({ length: 5 }, () => randomUUID());
  const calls: string[] = [];
  const db = {
    query: async (sql: string, params: string[]) => {
      if (active === 5) throw new Error("pool_exhausted");
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.match(sql, /WHERE m.user_id=\?/);
        assert.match(sql, /m.status='active'/);
        assert.match(sql, /t.status='active'/);
        calls.push(params[0]);
        return Array.from({ length: 12 }, (_, index) => ({
          id: randomUUID(),
          slug: `workspace-${index}`,
          status: "active",
          is_synthetic: 1,
          display_name: `${params[0]} workspace ${index}`,
          legal_name: "Synthetic Workspace",
          registration_number: null,
          monogram: "WS",
          membership_id: randomUUID(),
          membership_role: index % 2 ? "analyst" : "owner",
          membership_status: "active",
          membership_version: 3,
          capabilities_json: '{"allow":[],"deny":[]}',
        }));
      } finally {
        active--;
      }
    },
  } as unknown as DataSource;
  const store = new MariaDbWorkspaceStore(db);
  const results = await Promise.all(identities.map((id) => store.list(id)));
  for (const [index, workspaces] of results.entries()) {
    assert.equal(workspaces.length, 12);
    for (const [position, workspace] of workspaces.entries()) {
      assert.equal(workspace.membership.userId, identities[index]);
      assert.equal(workspace.membership.tenantId, workspace.tenant.id);
      assert.equal(workspace.membership.version, 3);
      assert.ok(workspace.tenant.profile.name.startsWith(identities[index]));
      assert.deepEqual(
        workspace.capabilities,
        position % 2
          ? ["research:publish"]
          : [
              "website:edit",
              "research:publish",
              "subscribers:read",
              "staff:manage",
            ],
      );
    }
  }
  assert.equal(calls.length, identities.length);
  assert.deepEqual(calls, identities);
  assert.equal(peak, 5);
  assert.equal(active, 0);
});

test("workspace chooser excludes invalid or unsupported membership facts and propagates database errors", async () => {
  const row = {
    id: tenant.id,
    slug: tenant.slug,
    status: "active",
    is_synthetic: 0,
    display_name: tenant.profile.name,
    legal_name: tenant.profile.legalName,
    registration_number: tenant.profile.registration,
    monogram: tenant.profile.monogram,
    membership_id: memberId,
    membership_role: "owner",
    membership_status: "active",
    membership_version: 1,
    capabilities_json: "{}",
  };
  let rows: unknown[] = [];
  const store = new MariaDbWorkspaceStore({
    query: async () => rows,
  } as unknown as DataSource);
  for (const change of [
    { status: "suspended" },
    { membership_status: "revoked" },
    { membership_role: "unknown" },
    { capabilities_json: null },
    { capabilities_json: { allow: ["staff:manage"] } },
    { capabilities_json: { deny: ["website:edit"] } },
  ]) {
    rows = [{ ...row, ...change }];
    assert.deepEqual(await store.list(userId), []);
  }
  rows = [row];
  assert.equal((await store.list(userId)).length, 1);
  rows = [{ ...row, capabilities_json: "invalid JSON" }];
  await assert.rejects(store.list(userId), SyntaxError);
  const failing = new MariaDbWorkspaceStore({
    query: async () => {
      throw new Error("unavailable");
    },
  } as unknown as DataSource);
  await assert.rejects(failing.list(userId), /unavailable/);
});

test("verification, recovery and explicit joining retain tenant context and protect reset tokens", async () => {
  const { request, state, calls } = harness({ emailEnabled: true });
  const headers = { origin };
  const base = "/ra/stocksbuddha";
  const signup = await request(
    `${base}/signup`,
    "POST",
    { email: "test@example.test", password: "test-password", name: "Test" },
    headers,
  );
  assert.match(signup.body, /verify-email/);
  state.authStatus = 403;
  state.authCode = "EMAIL_NOT_VERIFIED";
  assert.match(
    (
      await request(
        `${base}/login`,
        "POST",
        { email: "test@example.test" },
        headers,
      )
    ).body,
    /verify-email/,
  );
  state.authStatus = 400;
  state.authCode = "OTHER";
  assert.equal(
    (await request(`${base}/login`, "POST", {}, headers)).status,
    400,
  );
  state.authStatus = 200;
  for (const mode of ["verify-email", "forgot-password", "reset-password"]) {
    assert.equal((await request(`${base}/${mode}`)).status, 200);
    assert.equal((await request(`${base}/${mode}`, "POST", {})).status, 403);
    const result = await request(
      `${base}/${mode}`,
      "POST",
      { email: "test@example.test", password: "new-password" },
      { ...headers, cookie: "sb-password-reset=abcdefghijklmnopqrstuvwx" },
    );
    assert.equal(result.status, 200);
    state.authStatus = 400;
    assert.equal(
      (await request(`${base}/${mode}`, "POST", {}, headers)).status,
      400,
    );
    state.authStatus = 200;
  }
  const token = "abcdefghijklmnopqrstuvwx";
  const reset = await request(`${base}/reset-password?token=${token}`);
  assert.equal(reset.status, 303);
  assert.equal(reset.headers.location, `${base}/reset-password`);
  assert.match(String(reset.headers["set-cookie"]), /HttpOnly/);
  assert.ok(!reset.body.includes(token));
  assert.match(
    (await request(`${base}/reset-password?error=INVALID_TOKEN`)).body,
    /credentials/,
  );
  assert.match(
    (await request(`${base}/reset-password?token=bad`)).body,
    /reset-password/,
  );
  assert.equal((await request(`${base}/join`)).status, 303);
  state.membershipAvailable = false;
  assert.equal((await request(`${base}/join`)).status, 200);
  assert.equal((await request(`${base}/join`, "POST")).status, 403);
  assert.equal(
    (await request(`${base}/join`, "POST", {}, headers)).status,
    303,
  );
  state.failure = new DatabaseConflict("enrollment_unavailable");
  assert.equal(
    (await request(`${base}/join`, "POST", {}, headers)).status,
    403,
  );
  state.failure = new Error("internal");
  assert.equal(
    (await request(`${base}/join`, "POST", {}, headers)).status,
    500,
  );
  state.signedIn = false;
  assert.equal((await request(`${base}/join`)).status, 303);
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "auth" && String(call[4]).includes("/ra/stocksbuddha/join"),
    ),
  );
  const disabled = harness();
  for (const mode of ["verify-email", "forgot-password", "reset-password"]) {
    assert.match((await disabled.request(`${base}/${mode}`)).body, /service/);
    assert.equal(
      (await disabled.request(`${base}/${mode}`, "POST", {}, headers)).status,
      503,
    );
  }
});

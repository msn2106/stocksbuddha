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
import { makePage, makeWebsite } from "../../packages/contracts/tests/fixtures";
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
    email: "user@example.test",
    emailVerified: true,
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
            "retry-after": "10",
          },
        });
      },
      api: {
        getSession: (async ({ headers }: { headers: Headers }) => {
          calls.push(["session", headers.get("cookie")]);
          if (state.sessionFailure) throw new Error("private driver error");
          return state.signedIn
            ? {
                user: {
                  id: userId,
                  name: "User",
                  email: state.email,
                  emailVerified: state.emailVerified,
                },
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
      html: JSON.stringify(data.preview ? data : (data.account ?? "public")),
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
  const { request, state, calls, workspace } = harness();
  workspace.membership.role = "subscriber";
  for (const path of ["/ra/stocksbuddha/login", "/ra/stocksbuddha/signup"]) {
    state.signedIn = !path.endsWith("/signup");
    const form = await request(path);
    state.signedIn = true;
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
    assert.equal(result.headers.location, "/ra/stocksbuddha/account");
    assert.ok(result.headers["set-cookie"]);
    assert.equal(
      String(calls.filter((call) => call[0] === "auth").at(-1)).includes(
        "platform_role",
      ),
      false,
    );
    assert.equal(
      String(calls.filter((call) => call[0] === "auth").at(-1)?.[4]).includes(
        "forged",
      ),
      false,
    );
    assert.equal(
      calls.filter((call) => call[0] === "auth").at(-1)?.[5],
      tenant.id,
    );
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
  assert.equal(calls.filter((call) => call[0] === "auth").at(-1)?.[5], null);
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
    "/workspaces",
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
  assert.match((await request("/ra/stocksbuddha/account")).body, /subscriber/);
  assert.equal(
    (await request("/api/workspaces/stocksbuddha/members")).status,
    403,
  );
  state.workspaces = [];
  assert.match((await request("/workspaces")).body, /"workspaces":\[\]/);
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
  const { request, state, calls, workspace } = harness({ emailEnabled: true });
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
  workspace.membership.role = "subscriber";
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
  workspace.membership.role = "subscriber";
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

test("organisation login requires staff membership and platform login requires the separate stored platform grant", async () => {
  const { request, state, workspace } = harness();
  const body = {
    email: "user@example.test",
    password: "password123",
    audience: "organisation",
  };
  assert.equal(
    (await request("/ra/stocksbuddha/login", "POST", body, { origin })).headers
      .location,
    "/ra/stocksbuddha/workspace",
  );
  workspace.membership.role = "subscriber";
  const denied = await request("/ra/stocksbuddha/login", "POST", body, {
    origin,
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers["set-cookie"], undefined);
  assert.match(denied.body, /subscriber_only/);
  state.membershipAvailable = false;
  assert.equal(
    (await request("/ra/stocksbuddha/login", "POST", body, { origin })).status,
    403,
  );
  let owner = false;
  const platform = harness({
    organisations: {
      isPlatformOwner: async () => owner,
      list: async () => [],
    } as never,
  });
  assert.equal((await platform.request("/workspace/login")).status, 200);
  assert.equal(
    (await platform.request("/workspace/login", "POST", body, { origin }))
      .status,
    403,
  );
  assert.equal((await platform.request("/workspace")).status, 403);
  owner = true;
  assert.equal(
    (await platform.request("/workspace/login", "POST", body, { origin }))
      .headers.location,
    "/workspace",
  );
  assert.match((await platform.request("/workspace")).body, /platform_owner/);
  assert.equal(
    (await platform.request("/workspace/organisations")).status,
    200,
  );
  assert.equal((await platform.request("/workspace/unknown")).status, 404);
  platform.state.signedIn = false;
  assert.equal(
    (await platform.request("/workspace")).headers.location,
    "/workspace/login",
  );
});

test("platform setup, tenant invitations and acceptance enforce origins, membership and safe delivery failures", async () => {
  let expired = false,
    failed = false,
    denied = false;
  const events: unknown[][] = [];
  const credential = "a".repeat(64);
  const invitation = {
    id: "invite-id",
    token: credential,
    email: "user@example.test",
    role: "owner",
    tenant,
  };
  const service = {
    isPlatformOwner: async () => true,
    list: async () => [{ ...tenant, administrators: 1 }],
    create: async () => {
      events.push(["create"]);
      return tenant;
    },
    invite: async (...args: unknown[]) => {
      events.push(["invite", ...args]);
      if (denied) throw new DatabaseConflict("forbidden");
      return invitation;
    },
    delivered: async (...args: unknown[]) => {
      events.push(["delivery", ...args]);
    },
    preview: async (slug: string, token: string) =>
      !expired && slug === tenant.slug && token === credential
        ? invitation
        : null,
    invitations: async () => [],
    members: async () => [],
    accept: async () => {
      if (denied) throw new DatabaseConflict("invitation_unavailable");
      return { role: "owner" };
    },
  };
  const mailer = async () => {
    if (failed) throw new Error("private provider details");
    events.push(["sent"]);
  };
  const app = harness({ organisations: service as never, mailer });
  const headers = { origin, cookie: `sb-org-invite=${credential}` };
  assert.equal((await app.request("/workspace/organisations")).status, 200);
  assert.equal(
    (await app.request("/workspace/organisations", "POST", {})).status,
    403,
  );
  assert.equal(
    (
      await app.request(
        "/workspace/organisations",
        "POST",
        { email: "user@example.test" },
        headers,
      )
    ).headers.location,
    "/workspace/organisations?sent=1",
  );
  assert.equal(
    (
      await app.request(
        "/workspace/invitations",
        "POST",
        { tenantId: tenant.id, email: "user@example.test" },
        headers,
      )
    ).status,
    303,
  );
  failed = true;
  assert.equal(
    (await app.request("/workspace/invitations", "POST", {}, headers)).status,
    400,
  );
  assert.ok(events.some((e) => e[0] === "delivery" && e[2] === false));
  failed = false;
  denied = true;
  assert.equal(
    (await app.request("/workspace/invitations", "POST", {}, headers)).status,
    400,
  );
  denied = false;
  const noMail = harness({ organisations: service as never });
  assert.equal(
    (await noMail.request("/workspace/organisations", "POST", {}, headers))
      .status,
    503,
  );
  const exchange = await app.request(
    `/ra/stocksbuddha/invitation?token=${credential}`,
  );
  assert.equal(exchange.status, 303);
  assert.match(String(exchange.headers["set-cookie"]), /HttpOnly/);
  assert.equal(
    (
      await app.request(
        "/ra/stocksbuddha/invitation",
        "GET",
        undefined,
        headers,
      )
    ).status,
    200,
  );
  app.state.signedIn = false;
  assert.equal(
    (
      await app.request(
        "/ra/stocksbuddha/invitation",
        "GET",
        undefined,
        headers,
      )
    ).status,
    200,
  );
  assert.equal(
    (await app.request("/ra/stocksbuddha/invitation", "POST", {}, headers))
      .headers.location,
    "/ra/stocksbuddha/login?audience=organisation",
  );
  app.state.signedIn = true;
  assert.equal(
    (await app.request("/ra/stocksbuddha/invitation", "POST", {})).status,
    403,
  );
  denied = true;
  assert.equal(
    (await app.request("/ra/stocksbuddha/invitation", "POST", {}, headers))
      .status,
    403,
  );
  denied = false;
  assert.equal(
    (await app.request("/ra/stocksbuddha/invitation", "POST", {}, headers))
      .headers.location,
    "/ra/stocksbuddha/workspace",
  );
  expired = true;
  assert.equal(
    (
      await app.request(
        "/ra/stocksbuddha/invitation",
        "GET",
        undefined,
        headers,
      )
    ).status,
    404,
  );
  assert.equal(
    (await app.request("/ra/stocksbuddha/invitation", "POST", {}, headers))
      .status,
    404,
  );
  expired = false;
  assert.equal(
    (await app.request("/ra/stocksbuddha/workspace/team")).status,
    200,
  );
  assert.equal(
    (await app.request("/ra/stocksbuddha/workspace/team", "POST", {})).status,
    403,
  );
  assert.equal(
    (
      await app.request(
        "/ra/stocksbuddha/workspace/team",
        "POST",
        { email: "user@example.test", role: "analyst" },
        headers,
      )
    ).status,
    303,
  );
  denied = true;
  assert.equal(
    (await app.request("/ra/stocksbuddha/workspace/team", "POST", {}, headers))
      .status,
    403,
  );
  denied = false;
  assert.equal(
    (
      await noMail.request(
        "/ra/stocksbuddha/workspace/team",
        "POST",
        {},
        headers,
      )
    ).status,
    503,
  );
  app.workspace.capabilities = [];
  assert.equal(
    (await app.request("/ra/stocksbuddha/workspace/team")).status,
    403,
  );
  assert.equal(
    (await app.request("/ra/stocksbuddha/workspace/team", "POST", {}, headers))
      .status,
    403,
  );
  app.state.signedIn = false;
  assert.equal(
    (await app.request("/ra/stocksbuddha/workspace/team")).headers.location,
    "/ra/stocksbuddha/login?audience=organisation",
  );
  assert.equal(
    (await app.request("/ra/stocksbuddha/workspace/team", "POST", {}, headers))
      .status,
    303,
  );
});

test("platform credential failures, guest access and draft-tenant invitation login use the appropriate isolated boundaries", async () => {
  const service = {
    isPlatformOwner: async () => true,
    list: async () => [],
    accept: async () => ({ role: "owner" }),
    preview: async () => ({
      tenant,
      email: "user@example.test",
      role: "owner",
    }),
  } as never;
  const app = harness({ organisations: service });
  app.state.authStatus = 401;
  assert.equal(
    (await app.request("/workspace/login", "POST", {}, { origin })).status,
    401,
  );
  assert.equal((await app.request("/workspace/login", "POST", {})).status, 403);
  app.state.authStatus = 200;
  app.state.signedIn = false;
  assert.equal(
    (await app.request("/workspace/login", "POST", {}, { origin })).status,
    403,
  );
  app.state.signedIn = true;
  app.state.available = false;
  assert.equal(
    (
      await app.request("/ra/stocksbuddha/login", "GET", undefined, {
        cookie: "sb-org-invite=" + "a".repeat(64),
      })
    ).status,
    200,
  );
  const invited = await app.request(
    "/ra/stocksbuddha/login",
    "POST",
    { audience: "organisation", email: "user@example.test" },
    { origin, cookie: "sb-org-invite=" + "a".repeat(64) },
  );
  assert.equal(invited.headers.location, "/ra/stocksbuddha/workspace");
});

test("invitation provider failure keeps a safe retryable team form and records failed delivery", async () => {
  let outcome: unknown;
  const service = {
    preview: async () => null,
    invitations: async () => [],
    members: async () => [],
    invite: async () => ({
      id: "invite",
      email: "person@example.test",
      tenant,
      token: "a".repeat(64),
    }),
    delivered: async (_id: string, sent: boolean) => {
      outcome = sent;
    },
  } as never;
  const app = harness({
    organisations: service,
    mailer: async () => {
      throw new Error("private provider error");
    },
  });
  const result = await app.request(
    "/ra/stocksbuddha/workspace/team",
    "POST",
    { email: "person@example.test", role: "analyst" },
    { origin },
  );
  assert.equal(result.status, 502);
  assert.match(result.body, /invitation/);
  assert.equal(result.body.includes("private provider"), false);
  assert.equal(outcome, false);
});

test("platform recovery is tenant-independent, origin-protected and keeps verification/reset callbacks in workspace", async () => {
  const app = harness({ emailEnabled: true });
  for (const mode of ["verify-email", "forgot-password", "reset-password"]) {
    const path = `/workspace/${mode}`;
    const page = await app.request(path);
    assert.equal(page.status, 200);
    assert.equal(JSON.parse(page.body).audience, "platform");
    assert.equal((await app.request(path, "POST", {})).status, 403);
    const result = await app.request(
      path,
      "POST",
      {
        email: "owner@example.test",
        password: "new-password-123",
      },
      { origin, cookie: "sb-platform-password-reset=reset-credential-value" },
    );
    assert.equal(result.status, 200);
    const call = app.calls.filter((c) => c[0] === "auth").at(-1)!;
    assert.equal(call.at(-1), null);
    const payload = JSON.parse(String(call[4]));
    if (mode === "verify-email")
      assert.equal(payload.callbackURL, `${origin}/workspace/login`);
    if (mode === "forgot-password")
      assert.equal(payload.redirectTo, `${origin}/workspace/reset-password`);
    if (mode === "reset-password") {
      assert.equal(payload.token, "reset-credential-value");
      assert.equal(JSON.parse(result.body).mode, "login");
      assert.match(
        String(result.headers["set-cookie"]),
        /Max-Age=0|Expires=Thu, 01 Jan 1970/,
      );
    }
  }
  const token = "platform-reset-token-123456";
  const reset = await app.request(`/workspace/reset-password?token=${token}`);
  assert.equal(reset.status, 303);
  assert.equal(reset.headers.location, "/workspace/reset-password");
  assert.match(
    String(reset.headers["set-cookie"]),
    /sb-platform-password-reset=.*Path=\/workspace\/reset-password.*HttpOnly.*SameSite=Strict/,
  );
  assert.doesNotMatch(reset.body, new RegExp(token));
  assert.match(
    (await app.request("/workspace/reset-password?error=INVALID_TOKEN")).body,
    /credentials/,
  );
  app.state.authStatus = 400;
  assert.equal(
    (await app.request("/workspace/forgot-password", "POST", {}, { origin }))
      .status,
    400,
  );
  const disabled = harness();
  for (const mode of ["verify-email", "forgot-password", "reset-password"]) {
    assert.match(
      (await disabled.request(`/workspace/${mode}`)).body,
      /service/,
    );
    assert.equal(
      (await disabled.request(`/workspace/${mode}`, "POST", {}, { origin }))
        .status,
      503,
    );
  }
  assert.equal((await app.request("/workspace/signup")).status, 404);
});

test("recovery cannot restore a missing tenant membership or let subscribers enter the staff workspace", async () => {
  const app = harness();
  app.state.membershipAvailable = false;
  assert.equal((await app.request("/ra/stocksbuddha/account")).status, 404);
  app.state.membershipAvailable = true;
  app.workspace.membership.role = "subscriber";
  assert.equal((await app.request("/ra/stocksbuddha/workspace")).status, 403);
  assert.equal((await app.request("/ra/stocksbuddha/account")).status, 200);
});

test("tenant logout revokes the shared session even when the organisation is unavailable", async () => {
  const { request, state, calls } = harness();
  state.available = false;
  assert.equal(
    (
      await request("/ra/stocksbuddha/logout", "POST", undefined, {
        origin: "https://evil.test",
      })
    ).status,
    403,
  );
  const result = await request("/ra/stocksbuddha/logout", "POST", undefined, {
    origin,
  });
  assert.equal(result.status, 303);
  assert.equal(result.headers.location, "/ra/stocksbuddha/login");
  assert.ok(result.headers["set-cookie"]);
  assert.ok(
    calls.some(
      (call) => call[0] === "auth" && String(call[1]).endsWith("/sign-out"),
    ),
  );
  assert.equal(
    (await request("/logout", "POST", undefined, { origin })).headers.location,
    "/#access",
  );
});

test("tenant credential and recovery forms preserve throttling status, retry delay and a distinct error", async () => {
  const { request, state } = harness({ emailEnabled: true });
  state.authStatus = 429;
  for (const mode of [
    "login",
    "signup",
    "verify-email",
    "forgot-password",
    "reset-password",
  ]) {
    const result = await request(
      `/ra/stocksbuddha/${mode}`,
      "POST",
      { email: "u@example.test", password: "password123" },
      { origin },
    );
    assert.equal(result.status, 429);
    assert.equal(result.headers["retry-after"], "10");
    assert.equal(JSON.parse(result.body).error, "throttled");
  }
});

test("website editor scopes reads, saves and previews to fresh tenant owners and rejects foreign writes", async () => {
  const site = makeWebsite();
  const snapshot = {
    schemaVersion: 1 as const,
    publicProfile: tenant.profile,
    branding: site.branding,
    languages: site.languages,
    layout: site.layout,
    content: site.content,
  };
  const saved = { id: randomUUID(), revision: 2, version: 1 };
  const writes: unknown[] = [];
  const h = harness({
    websiteOperations: {
      readWebsite: async (context) => {
        writes.push(context);
        return { ...saved, snapshot };
      },
      createDraft: async (context, value) => {
        writes.push([context, value]);
        return saved;
      },
      saveDraft: async (context, id, version, value) => {
        writes.push([context, id, version, value]);
        return { ...saved, version: version + 1 };
      },
      publish: async () => {
        throw new DatabaseConflict("stale_publication");
      },
    },
  });
  const api = `/api/workspaces/${tenant.slug}/website`;
  assert.equal(
    (await h.request(`/ra/${tenant.slug}/workspace/website`)).status,
    200,
  );
  assert.equal((await h.request(api)).status, 200);
  const preview = await h.request(
    `/ra/${tenant.slug}/workspace/website/preview?lang=hi`,
  );
  assert.equal(preview.status, 200);
  assert.equal(JSON.parse(preview.body).locale, "hi");
  assert.equal(JSON.parse(preview.body).preview, true);
  assert.match(
    String(preview.headers["content-security-policy"]),
    /frame-ancestors 'self'/,
  );
  assert.equal(
    (
      await h.request(
        api,
        "POST",
        { action: "save", id: null, version: 0, snapshot },
        { origin: "https://attacker.test" },
      )
    ).status,
    403,
  );
  const headers = { origin, "idempotency-key": randomUUID() };
  const body = { action: "save", id: null, version: 0, snapshot };
  assert.equal((await h.request(api, "POST", body, headers)).status, 200);
  assert.deepEqual((writes.at(-1) as unknown[])[0], {
    token: "server-token",
    tenantId: tenant.id,
    key: headers["idempotency-key"],
  });
  assert.equal(
    (
      await h.request(
        api,
        "POST",
        { ...body, action: "publish", ...saved },
        headers,
      )
    ).status,
    409,
  );
  for (const role of ["analyst", "support", "subscriber"] as const) {
    h.workspace.membership.role = role;
    assert.equal((await h.request(api)).status, 403);
    assert.equal(
      (await h.request(`/ra/${tenant.slug}/workspace/website/preview`)).status,
      403,
    );
    assert.equal((await h.request(api, "POST", body, headers)).status, 403);
  }
  h.workspace.membership.role = "owner";
  h.workspace.capabilities = [];
  assert.equal((await h.request(api)).status, 403);
  h.state.signedIn = false;
  assert.equal((await h.request(api)).status, 401);
});

test("website mutations validate envelopes, propagate safe field errors and retain concurrency failures", async () => {
  const site = makeWebsite();
  const snapshot = {
    schemaVersion: 1 as const,
    publicProfile: tenant.profile,
    branding: site.branding,
    languages: site.languages,
    layout: site.layout,
    content: site.content,
  };
  const id = randomUUID();
  let failure: unknown;
  let complete = true;
  const writes: unknown[][] = [];
  const h = harness({
    websiteOperations: {
      readWebsite: async () => ({
        id,
        version: 3,
        revision: 2,
        snapshot: { ...snapshot, content: complete ? snapshot.content : {} },
      }),
      createDraft: async (...args) => {
        if (failure) throw failure;
        writes.push(args);
        return { id, version: 1, revision: 2 };
      },
      saveDraft: async (...args) => {
        if (failure) throw failure;
        writes.push(args);
        return { id, version: 4, revision: 2 };
      },
      publish: async (...args) => {
        if (failure) throw failure;
        writes.push(args);
        return { id, version: 4, revision: 2 };
      },
    },
  });
  const api = `/api/workspaces/${tenant.slug}/website`;
  const headers = { origin, "idempotency-key": randomUUID() };
  const body = { action: "save", id, version: 3, snapshot };
  for (const change of [
    { action: "unknown" },
    { id: "invalid" },
    { id: 123 },
    { version: "3" },
    { version: -1 },
    { version: 0 },
    { action: "publish", id: null },
    { action: "rebase", id: null },
  ])
    assert.equal(
      (await h.request(api, "POST", { ...body, ...change }, headers)).status,
      400,
    );
  assert.equal((await h.request(api, "POST", body, { origin })).status, 400);
  assert.equal((await h.request(api, "POST", undefined, headers)).status, 400);
  assert.equal((await h.request(api, "POST", body, headers)).status, 200);
  assert.equal(
    (await h.request(api, "POST", { ...body, action: "rebase" }, headers))
      .status,
    200,
  );
  assert.equal(writes.at(-1)?.[4], true);
  assert.equal(
    (await h.request(api, "POST", { ...body, action: "publish" }, headers))
      .status,
    200,
  );
  for (const code of [
    "unauthorized",
    "forbidden",
    "tenant_unavailable",
    "stale_draft",
    "idempotency_conflict",
  ]) {
    failure = new DatabaseConflict(code);
    const response = await h.request(api, "POST", body, headers);
    assert.equal(
      response.status,
      ["unauthorized", "forbidden", "tenant_unavailable"].includes(code)
        ? 403
        : 409,
    );
    assert.equal(JSON.parse(response.body).error, code);
  }
  const { websiteSnapshotSchema } = await import("@ra/contracts");
  const invalid = websiteSnapshotSchema.safeParse({});
  assert.equal(invalid.success, false);
  if (!invalid.success) failure = invalid.error;
  const validation = await h.request(api, "POST", body, headers);
  assert.equal(validation.status, 422);
  assert.ok(JSON.parse(validation.body).issues.length);
  for (const message of [
    "Default language must be enabled",
    "HTML is not supported in website snapshots",
    "Snapshot exceeds 512 KiB",
  ]) {
    failure = new Error(message);
    const response = await h.request(api, "POST", body, headers);
    assert.equal(response.status, 422);
    assert.deepEqual(JSON.parse(response.body).issues, [message]);
  }
  failure = new Error("private database detail");
  const failed = await h.request(api, "POST", body, headers);
  assert.equal(failed.status, 500);
  assert.equal(failed.body.includes("private database detail"), false);
  const preview = `/ra/${tenant.slug}/workspace/website/preview`;
  const defaultLanguage = await h.request(`${preview}?lang=unsupported`);
  assert.equal(JSON.parse(defaultLanguage.body).locale, "en");
  complete = false;
  assert.equal((await h.request(preview)).status, 422);
});

test("authenticated-mode platform entry points do not default to an RA", async () => {
  const { request, state } = harness();
  for (const [path, destination] of [
    ["/login", "/?lang=en#access"],
    ["/signin?lang=hi", "/?lang=hi#access"],
    ["/signup", "/?lang=en#contact"],
  ]) {
    assert.equal((await request(path!)).headers.location, destination);
  }
  state.signedIn = false;
  assert.equal((await request("/workspaces")).headers.location, "/#access");
});

test("team actions require the tenant admin and matching origin, resend stored grants and revoke without SMTP", async () => {
  const actions: unknown[][] = [];
  const service = {
    invitations: async () => [],
    members: async () => [],
    resend: async (...args: unknown[]) => {
      actions.push(["resend", ...args]);
      return {
        id: "new",
        email: "person@example.test",
        fullName: "Ada",
        tenant,
        token: "a".repeat(64),
      };
    },
    delivered: async () => {},
    revokeInvitation: async (...args: unknown[]) => {
      actions.push(["revokeInvitation", ...args]);
    },
    revokeMember: async (...args: unknown[]) => {
      actions.push(["revokeMember", ...args]);
    },
  } as never;
  const mail: unknown[] = [];
  const app = harness({
    organisations: service,
    mailer: async (message) => {
      mail.push(message);
    },
  });
  const path = "/ra/stocksbuddha/workspace/team";
  for (const action of ["resend", "revokeInvitation", "revokeMember"]) {
    assert.equal(
      (await app.request(path, "POST", { action, id: "stored-id" })).status,
      403,
    );
    const response = await app.request(
      path,
      "POST",
      {
        action,
        id: "stored-id",
        email: "attacker@example.test",
        role: "owner",
      },
      { origin },
    );
    assert.equal(response.status, 303);
    assert.deepEqual(actions.at(-1)?.slice(0, 4), [
      action,
      "server-token",
      tenant.id,
      "stored-id",
    ]);
  }
  assert.equal(mail.length, 1);
  assert.equal((mail[0] as { fullName: string }).fullName, "Ada");
  app.state.workspaces[0].membership.role = "analyst";
  for (const action of ["resend", "revokeInvitation", "revokeMember"])
    assert.equal(
      (await app.request(path, "POST", { action, id: "stored-id" }, { origin }))
        .status,
      403,
    );
  const offline = harness({ organisations: service });
  assert.equal(
    (
      await offline.request(
        path,
        "POST",
        { action: "revokeMember", id: "stored-id" },
        { origin },
      )
    ).status,
    303,
  );
  assert.equal(
    (
      await offline.request(
        path,
        "POST",
        { action: "resend", id: "stored-id" },
        { origin },
      )
    ).status,
    503,
  );
});

test("valid invitations guide mismatched and unverified accounts and switching keeps the invitation", async () => {
  let accepted = 0;
  const credential = "a".repeat(64);
  const service = {
    preview: async (_slug: string, token: string) =>
      token === credential
        ? { tenant, email: "invited@example.test", role: "analyst" }
        : null,
    accept: async () => {
      accepted++;
    },
  } as never;
  const app = harness({ organisations: service, emailEnabled: true });
  const path = "/ra/stocksbuddha/invitation";
  const headers = { origin, cookie: `sb-org-invite=${credential}` };
  const wrong = await app.request(path, "GET", undefined, headers);
  assert.equal(JSON.parse(wrong.body).invitationIdentity, "different");
  assert.equal(JSON.parse(wrong.body).signedIn, true);
  for (const method of ["GET", "POST"]) {
    const unavailable = await app.request(path, method, {}, { origin });
    assert.equal(unavailable.status, 404);
    assert.equal(JSON.parse(unavailable.body).signedIn, true);
  }
  assert.equal((await app.request(path, "POST", {}, headers)).status, 403);
  assert.equal(accepted, 0);
  assert.equal(
    (
      await app.request(
        `${path}/switch-account`,
        "POST",
        {},
        { cookie: headers.cookie },
      )
    ).status,
    403,
  );
  const switched = await app.request(
    `${path}/switch-account`,
    "POST",
    {},
    headers,
  );
  assert.equal(switched.headers.location, path);
  assert.ok(switched.headers["set-cookie"]);
  assert.ok(
    app.calls.some(
      (call) => call[0] === "auth" && String(call[1]).endsWith("/sign-out"),
    ),
  );
  app.state.email = "invited@example.test";
  app.state.emailVerified = false;
  assert.equal(
    JSON.parse((await app.request(path, "GET", undefined, headers)).body)
      .invitationIdentity,
    "unverified",
  );
  assert.equal((await app.request(path, "POST", {}, headers)).status, 403);
  assert.equal(accepted, 0);
  const verification = await app.request(
    "/ra/stocksbuddha/verify-email",
    "GET",
    undefined,
    headers,
  );
  assert.match(verification.body, /invited@example.test/);
  await app.request(
    "/ra/stocksbuddha/verify-email",
    "POST",
    { email: "invited@example.test" },
    headers,
  );
  const verificationRequest = [...app.calls]
    .reverse()
    .find(
      (call) =>
        call[0] === "auth" &&
        String(call[1]).endsWith("/send-verification-email"),
    );
  assert.equal(
    JSON.parse(String(verificationRequest?.[4])).callbackURL,
    `${origin}${path}`,
  );
  app.state.emailVerified = true;
  const ready = JSON.parse(
    (await app.request(path, "GET", undefined, headers)).body,
  );
  assert.equal(ready.autoAcceptInvitation, true);
  assert.equal(accepted, 0);
  assert.equal((await app.request(path, "POST", {}, headers)).status, 303);
  assert.equal(accepted, 1);
});

test("invited signup is prefilled, email-bound, origin-protected and uses the chosen password without ordinary signup or another acceptance", async () => {
  const token = "a".repeat(64);
  const events: unknown[][] = [];
  const service = {
    preview: async () => ({
      tenant,
      email: "invited@example.test",
      fullName: "Invited Person",
      role: "analyst",
      accountExists: false,
    }),
    register: async (...args: unknown[]) => {
      events.push(args);
      app.state.signedIn = true;
      app.workspace.membership.role = "analyst";
      return { role: "analyst", email: "invited@example.test" };
    },
    accept: async () => {
      throw Error("must not accept twice");
    },
  } as never;
  const app = harness({ organisations: service, emailEnabled: true });
  app.state.signedIn = false;
  app.state.email = "invited@example.test";
  const headers = { origin, cookie: `sb-org-invite=${token}` };
  const page = JSON.parse(
    (
      await app.request(
        "/ra/stocksbuddha/invitation",
        "GET",
        undefined,
        headers,
      )
    ).body,
  );
  assert.equal(page.mode, "signup");
  assert.equal(page.email, "invited@example.test");
  assert.equal(page.name, "Invited Person");
  const body = {
    email: "invited@example.test",
    name: "Invited Person",
    password: "Chosen-password-123",
    role: "owner",
    emailVerified: true,
  };
  assert.equal(
    (await app.request("/ra/stocksbuddha/signup", "POST", body)).status,
    403,
  );
  assert.equal(
    (
      await app.request(
        "/ra/stocksbuddha/signup",
        "POST",
        { ...body, email: "attacker@example.test" },
        headers,
      )
    ).status,
    403,
  );
  assert.equal(events.length, 0);
  const result = await app.request(
    "/ra/stocksbuddha/signup",
    "POST",
    body,
    headers,
  );
  assert.equal(result.headers.location, "/ra/stocksbuddha/workspace");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].slice(0, 4), [
    tenant.id,
    token,
    "Invited Person",
    "Chosen-password-123",
  ]);
  assert.equal(
    app.calls.some((call) => String(call[1]).endsWith("/sign-up/email")),
    false,
  );
  assert.match(String(result.headers["set-cookie"]), /sb-org-invite=;/);
});

test("subscribers cannot accept staff invitations, and staff cannot use the Investor capsule", async () => {
  let accepted = 0;
  const service = {
    preview: async () => ({
      tenant,
      email: "user@example.test",
      role: "analyst",
      accountExists: true,
    }),
    accept: async () => {
      accepted++;
    },
  } as never;
  const app = harness({ organisations: service, emailEnabled: true });
  const body = {
    email: "user@example.test",
    password: "Existing-password-123",
  };
  const headers = { origin, cookie: "sb-org-invite=" + "a".repeat(64) };
  app.workspace.membership.role = "subscriber";
  assert.equal(
    (
      await app.request(
        "/ra/stocksbuddha/login",
        "POST",
        { ...body, audience: "investor" },
        headers,
      )
    ).headers.location,
    "/ra/stocksbuddha/account",
  );
  const conflict = await app.request(
    "/ra/stocksbuddha/login",
    "POST",
    { ...body, audience: "organisation" },
    headers,
  );
  assert.equal(conflict.status, 403);
  assert.equal(JSON.parse(conflict.body).error, "subscriber_conflict");
  assert.equal(accepted, 0);
  for (const role of ["owner", "analyst", "support"] as const) {
    app.workspace.membership.role = role;
    const result = await app.request(
      "/ra/stocksbuddha/login",
      "POST",
      { ...body, audience: "investor" },
      { origin },
    );
    assert.equal(result.status, 403);
    assert.equal(JSON.parse(result.body).error, "staff_only");
    assert.equal((await app.request("/ra/stocksbuddha/account")).status, 403);
    assert.equal(
      (await app.request("/ra/stocksbuddha/account/settings?role=subscriber"))
        .status,
      403,
    );
    assert.equal((await app.request("/ra/stocksbuddha/join")).status, 403);
  }
});

test("ordinary signup still requires email verification and ignores client invitation/role/verification flags", async () => {
  let registered = false;
  const app = harness({
    emailEnabled: true,
    organisations: {
      preview: async () => null,
      register: async () => {
        registered = true;
      },
    } as never,
  });
  const result = await app.request(
    "/ra/stocksbuddha/signup",
    "POST",
    {
      email: "public@example.test",
      name: "Public",
      password: "Chosen-password-123",
      emailVerified: true,
      role: "owner",
      invitedEmail: "public@example.test",
    },
    { origin },
  );
  assert.equal(JSON.parse(result.body).mode, "verify-email");
  assert.equal(registered, false);
  const call = app.calls.find(
    (call) => call[0] === "auth" && String(call[1]).endsWith("/sign-up/email"),
  )!;
  const body = JSON.parse(String(call[4]));
  assert.equal(body.emailVerified, undefined);
  assert.equal(body.role, undefined);
  assert.equal(body.invitedEmail, undefined);
});

test("an expired invite setup form cannot fall back to ordinary account creation", async () => {
  const app = harness({
    emailEnabled: true,
    organisations: { preview: async () => null } as never,
  });
  const result = await app.request(
    "/ra/stocksbuddha/signup",
    "POST",
    {
      invitation: "1",
      email: "expired@example.test",
      name: "Expired",
      password: "Chosen-password-123",
    },
    { origin, cookie: "sb-org-invite=" + "a".repeat(64) },
  );
  assert.equal(result.status, 403);
  assert.equal(JSON.parse(result.body).mode, "invitation");
  assert.equal(
    app.calls.some((call) => call[0] === "auth"),
    false,
  );
});

test("signup discloses own staff conflicts only to the authenticated account holder, scoped to this RA", async () => {
  const app = harness({ emailEnabled: true });
  for (const role of ["owner", "analyst", "support"] as const) {
    app.workspace.membership.role = role;
    for (const method of ["GET", "POST"]) {
      const result = await app.request(
        "/ra/stocksbuddha/signup",
        method,
        { email: app.state.email, password: "Existing-password-123" },
        { origin },
      );
      assert.equal(result.status, 409);
      assert.equal(JSON.parse(result.body).error, "staff_only");
      assert.equal(JSON.parse(result.body).audience, "organisation");
    }
  }
  const anonymous = harness({ emailEnabled: true });
  anonymous.state.signedIn = false;
  const neutral = await anonymous.request(
    "/ra/stocksbuddha/signup",
    "POST",
    {
      email: "staff@example.test",
      name: "Name",
      password: "Chosen-password-123",
    },
    { origin },
  );
  assert.equal(JSON.parse(neutral.body).mode, "verify-email");
  assert.equal(neutral.body.includes("staff_only"), false);
  assert.equal(
    anonymous.calls.some((call) => call[0] === "find"),
    false,
  );
  app.state.membershipAvailable = false;
  assert.equal((await app.request("/ra/stocksbuddha/signup")).status, 200);
});

test("RA Admin invitation conflicts are displayed safely and never send an email", async () => {
  let delivered = 0;
  const service = {
    invite: async () => {
      throw new DatabaseConflict("subscriber_conflict");
    },
    invitations: async () => [],
    members: async () => [],
  } as never;
  const app = harness({
    organisations: service,
    mailer: async () => {
      delivered++;
    },
  });
  const result = await app.request(
    "/ra/stocksbuddha/workspace/team",
    "POST",
    {
      email: "subscriber@example.test",
      fullName: "Subscriber",
      role: "analyst",
    },
    { origin },
  );
  assert.equal(result.status, 403);
  assert.equal(JSON.parse(result.body).error, "subscriber_conflict");
  assert.equal(delivered, 0);
});

test("invitation signup errors preserve retry guidance, throttle headers and never publish a session or password", async () => {
  for (const code of ["throttled", "account_exists", "invalid_password"]) {
    const app = harness({
      emailEnabled: true,
      organisations: {
        preview: async () => ({
          tenant,
          email: "invitee@example.test",
          fullName: "Invitee",
          role: "analyst",
          accountExists: false,
        }),
        register: async () => {
          throw new DatabaseConflict(code);
        },
      } as never,
    });
    app.state.signedIn = false;
    const result = await app.request(
      "/ra/stocksbuddha/signup",
      "POST",
      {
        email: "invitee@example.test",
        name: "Invitee",
        password: "Chosen-password-123",
        invitation: "1",
      },
      { origin, cookie: "sb-org-invite=" + "a".repeat(64) },
    );
    const page = JSON.parse(result.body);
    assert.equal(result.status, code === "throttled" ? 429 : 403);
    assert.equal(
      page.error,
      code === "invalid_password" ? "credentials" : code,
    );
    assert.equal(page.mode, code === "account_exists" ? "login" : "signup");
    assert.equal(page.email, "invitee@example.test");
    assert.equal(result.body.includes("Chosen-password-123"), false);
    assert.equal(result.headers["set-cookie"], undefined);
    assert.equal(
      app.calls.some((call) => call[0] === "auth"),
      false,
    );
    if (code === "throttled") assert.equal(result.headers["retry-after"], "60");
  }
});

test("a revoked invitation recipient cannot publish the newly authenticated session", async () => {
  const app = harness({
    emailEnabled: true,
    organisations: {
      preview: async () => ({
        tenant,
        email: "user@example.test",
        role: "analyst",
        accountExists: true,
      }),
      accept: async () => {
        throw new DatabaseConflict("membership_revoked");
      },
    } as never,
  });
  // Revoked memberships are absent from the active workspace projection; acceptance
  // still rechecks the stored row and refuses an invitation issued before revocation.
  app.state.membershipAvailable = false;
  const result = await app.request(
    "/ra/stocksbuddha/login",
    "POST",
    {
      audience: "organisation",
      email: "user@example.test",
      password: "Existing-password-123",
    },
    { origin, cookie: "sb-org-invite=" + "a".repeat(64) },
  );
  assert.equal(result.status, 403);
  assert.equal(JSON.parse(result.body).error, "membership_revoked");
  assert.equal(result.headers["set-cookie"], undefined);
  assert.ok(
    app.calls.some(
      (call) => call[0] === "auth" && String(call[1]).endsWith("/sign-out"),
    ),
  );
});

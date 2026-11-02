import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { createPool } from "mysql2/promise";
import { getSchema } from "better-auth/db";
import { authOptions, createAuthentication } from "../src/auth/config";
import { currentAuthTenant, withAuthTenant } from "../src/auth/tenant-context";
import { databaseConfig, createDatabase } from "../../database/config";
import {
  canonicalJson,
  digest,
  snapshotFromFixture,
  validateSnapshot,
} from "../../database/snapshots";
import { tenants } from "../src/tenants/tenants";
import { websites } from "../src/websites/seeds";
import {
  MariaDbTenantRepository,
  MariaDbWebsiteRepository,
} from "../src/database/repositories";
import { TenantOperations } from "../src/database/operations";
import { canAccessTenant } from "../src/access/authorization";
import { createPersistence } from "../src/database/runtime";
import { migrationClasses } from "../../database/catalog";
import { websiteContentKeys } from "@ra/contracts";

const tenant = tenants[0];
const website = websites.find((row) => row.tenantId === tenant.id)!;
const snapshot = snapshotFromFixture(tenant, website);

test("database configuration requires explicit environment, bounded ports and verified production TLS", () => {
  const env = { DB_ENV: "dev", DB_USER: "local", DB_PASSWORD: "test" };
  assert.equal(databaseConfig(env).database, "stocksbuddha_dev");
  for (const change of [
    { DB_ENV: "other" },
    { DB_NAME: "stocksbuddha_prod" },
    { DB_PORT: "0" },
    { DB_PORT: "abc" },
    { DB_USER: "" },
    { DB_PASSWORD: "" },
    { DB_TLS: "maybe" },
    { DB_ENV: "prod" },
  ])
    assert.throws(() => databaseConfig({ ...env, ...change }));
  const prod = databaseConfig({
    ...env,
    DB_ENV: "prod",
    DB_TLS: "true",
    DB_TLS_CA: "certificate",
    DB_HOST: "db.test",
    DB_PORT: "3307",
    DB_NAME: "u123_stocksbuddha_prod",
  });
  assert.equal(prod.ssl?.rejectUnauthorized, true);
  assert.equal(prod.ssl?.ca, "certificate");
  assert.ok(databaseConfig({ ...env, DB_TLS: "true" }).ssl);
  assert.equal(createDatabase(databaseConfig(env)).options.type, "mariadb");
});

test("canonical snapshots preserve order-independent hashes, draft incompleteness and strict publication boundaries", () => {
  const oversized = structuredClone(snapshot);
  oversized.content.en = Object.fromEntries(
    websiteContentKeys.map((key) => [key, "ह".repeat(3000)]),
  );
  oversized.content.hi = structuredClone(oversized.content.en);
  assert.throws(() => validateSnapshot(oversized), /512 KiB/);
  assert.equal(canonicalJson({ b: [null, 2], a: 1 }), '{"a":1,"b":[null,2]}');
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  const draft = structuredClone(snapshot);
  draft.content.hi = {};
  assert.ok(validateSnapshot(draft));
  assert.throws(() => validateSnapshot(draft, true));
  assert.throws(() => validateSnapshot({ ...snapshot, schemaVersion: 2 }));
  assert.throws(() =>
    validateSnapshot({
      ...snapshot,
      publicProfile: {
        ...snapshot.publicProfile,
        name: "<script>bad</script>",
      },
    }),
  );
  const disabled = structuredClone(snapshot);
  disabled.languages.enabled = ["en"];
  assert.throws(() => validateSnapshot(disabled, true));
  const bad = structuredClone(snapshot);
  bad.languages.enabled = ["hi"];
  assert.throws(() => validateSnapshot(bad), /Default/);
});

test("pinned auth schema maps only the four reviewed tables and keeps platform fields server-owned", async () => {
  const pool = createPool({ host: "127.0.0.1" });
  try {
    assert.throws(() => authOptions(pool, "short", "http://localhost"));
    const options = authOptions(
      pool,
      "a-long-local-secret-with-at-least-32-characters",
      "http://localhost:3000",
    );
    assert.throws(() =>
      authOptions(
        pool,
        "a-secret-at-least-32-characters-long",
        "ftp://example.test",
      ),
    );
    assert.throws(() =>
      authOptions(
        pool,
        "a-secret-at-least-32-characters-long",
        "https://example.test/path",
      ),
    );
    assert.equal(
      authOptions(
        pool,
        "a-secret-at-least-32-characters-long",
        "https://example.test",
      ).advanced?.useSecureCookies,
      true,
    );
    assert.deepEqual(Object.keys(getSchema(options)).sort(), [
      "auth_accounts",
      "auth_sessions",
      "auth_users",
      "auth_verifications",
    ]);
    assert.equal(options.user?.additionalFields?.platform_role.input, false);
    const generator = options.advanced?.database?.generateId;
    if (typeof generator === "function")
      assert.match(
        String(generator({ model: "user", size: 36 })),
        /^[0-9a-f-]{36}$/,
      );
    const identity = createAuthentication(
      {
        host: "127.0.0.1",
        port: 3306,
        username: "test",
        password: "test",
        database: "test",
      },
      "a-long-local-secret-with-at-least-32-characters",
      "http://localhost:3000",
      (() => ({})) as never,
    );
    await identity.close();
  } finally {
    await pool.end();
  }
});

test("auth provenance hooks use isolated server context and keep both fields server-owned", async () => {
  const pool = createPool({ host: "127.0.0.1" });
  try {
    const options = authOptions(
      pool,
      "a-secret-at-least-32-characters-long",
      "http://localhost:3000",
    );
    assert.equal(options.user?.additionalFields?.signupTenantId.input, false);
    assert.equal(
      options.user?.additionalFields?.signupTenantId.returned,
      false,
    );
    assert.equal(options.session?.additionalFields?.loginTenantId.input, false);
    assert.equal(
      options.session?.additionalFields?.loginTenantId.returned,
      false,
    );
    const userHook = options.databaseHooks!.user!.create!.before!;
    const sessionHook = options.databaseHooks!.session!.create!.before!;
    assert.equal(currentAuthTenant(), null);
    const contexts = await Promise.all(
      [tenant.id, tenants[2].id].map((tenantId) =>
        withAuthTenant(tenantId, async () => {
          await Promise.resolve();
          const user = await userHook(
            { id: "user", signupTenantId: "forged" } as never,
            null,
          );
          const session = await sessionHook(
            { id: "session", loginTenantId: "forged" } as never,
            null,
          );
          assert.ok(user && typeof user === "object");
          assert.ok(session && typeof session === "object");
          assert.equal(
            (user.data as Record<string, unknown>).signupTenantId,
            tenantId,
          );
          assert.equal(
            (session.data as Record<string, unknown>).loginTenantId,
            tenantId,
          );
          return currentAuthTenant();
        }),
      ),
    );
    assert.deepEqual(contexts, [tenant.id, tenants[2].id]);
    assert.equal(currentAuthTenant(), null);
    const global = await userHook({ id: "global" } as never, null);
    assert.ok(global && typeof global === "object");
    assert.equal((global.data as Record<string, unknown>).signupTenantId, null);
    await assert.rejects(
      withAuthTenant(tenant.id, async () => {
        throw new Error("failed request");
      }),
    );
    assert.equal(currentAuthTenant(), null);
    assert.equal(
      withAuthTenant(tenant.id, () => withAuthTenant(null, currentAuthTenant)),
      null,
    );
  } finally {
    await pool.end();
  }
});

test("runtime selection is explicit, rejects unavailable schema and closes the owned pool", async () => {
  const fixture = await createPersistence({});
  assert.ok(await fixture.ready());
  await fixture.close();
  assert.ok(
    await (
      await createPersistence({
        NODE_ENV: "production",
        DATABASE_MODE: "fixtures",
        ALLOW_PUBLIC_PREVIEW: "true",
      })
    ).ready(),
  );
  await assert.rejects(
    createPersistence({ NODE_ENV: "production", DATABASE_MODE: "fixtures" }),
    /opt-in/,
  );
  await assert.rejects(
    createPersistence({ DATABASE_MODE: "unknown" }),
    /DATABASE_MODE/,
  );
  let closed = 0,
    fail = false;
  const pool = {
    initialize: async () => {},
    query: async (sql: string) => {
      if (fail) throw new Error("unavailable");
      if (sql.includes("SELECT name FROM migrations"))
        return migrationClasses.map((Class) => ({ name: new Class().name }));
      return [];
    },
    destroy: async () => {
      closed++;
    },
  };
  const factory = (() => pool) as unknown as typeof createDatabase;
  const env = {
    DATABASE_MODE: "mariadb",
    DB_ENV: "dev",
    DB_USER: "local",
    DB_PASSWORD: "local",
    AUTH_SECRET: "test-secret-with-at-least-32-characters",
    AUTH_BASE_URL: "http://localhost:3000",
  };
  const runtime = await createPersistence(env, factory);
  assert.ok(await runtime.ready());
  await runtime.close();
  assert.equal(closed, 1);
  for (const invalid of [
    { AUTH_SECRET: "" },
    { AUTH_BASE_URL: "" },
    { AUTH_SECRET: "short" },
    { NODE_ENV: "production" },
  ]) {
    await assert.rejects(createPersistence({ ...env, ...invalid }, factory));
  }
  closed = 1;
  fail = true;
  await assert.rejects(runtime.ready());
  await assert.rejects(createPersistence(env, factory), /schema is not ready/);
  assert.equal(closed, 2);
  const production = await createPersistence(
    { NODE_ENV: "production", ...env },
    factory,
  ).catch(() => null);
  assert.equal(production, null);
});

test("database repository projections bind tenant scope and reject unpublished/corrupt data", async () => {
  let rows: unknown[] = [];
  const calls: unknown[][] = [];
  const db = {
    query: async (...args: unknown[]) => {
      calls.push(args);
      return rows;
    },
  } as unknown as DataSource;
  const tenantsRepo = new MariaDbTenantRepository(db),
    websitesRepo = new MariaDbWebsiteRepository(db);
  assert.equal(await tenantsRepo.findBySlug("missing"), null);
  assert.equal(await websitesRepo.findPublished(tenant.id), null);
  rows = [
    {
      id: tenant.id,
      slug: tenant.slug,
      status: "active",
      is_synthetic: 0,
      display_name: tenant.profile.name,
      legal_name: tenant.profile.legalName,
      registration_number: tenant.profile.registration,
      monogram: tenant.profile.monogram,
    },
  ];
  assert.equal((await tenantsRepo.findBySlug(tenant.slug))?.id, tenant.id);
  const row = {
    tenant_id: tenant.id,
    revision: 1,
    status: "published",
    published_at: "2026-11-01 00:00:00.000",
    snapshot_json: JSON.stringify(snapshot),
    snapshot_sha256: digest(snapshot),
  };
  rows = [row];
  assert.equal(
    (await websitesRepo.findPublished(tenant.id))?.publicProfile.name,
    tenant.profile.name,
  );
  rows = [{ ...row, snapshot_json: snapshot }];
  assert.ok(await websitesRepo.findPublished(tenant.id));
  rows = [{ ...row, snapshot_sha256: "wrong" }];
  await assert.rejects(websitesRepo.findPublished(tenant.id), /integrity/);
  assert.deepEqual(calls.at(-1)?.[1], [tenant.id]);
});

/** Provide current database facts to domain unit tests; real SQL constraints/transactions are tested separately on MariaDB. */
function operationHarness() {
  const userId = randomUUID(),
    membershipId = randomUUID();
  const state = {
    user: { id: userId, platform_role: "owner", email_verified: 1 },
    session: true,
    tenant: { ...tenant, published_revision: 1, publication_version: 1 },
    member: {
      id: membershipId,
      user_id: userId,
      tenant_id: tenant.id,
      role: "owner",
      status: "active",
      lock_version: 1,
      capabilities_json: '{"allow":[],"deny":[]}',
    },
    target: {
      id: membershipId,
      role: "owner",
      status: "active",
      lock_version: 1,
    },
    draft: {
      id: randomUUID(),
      revision: 2,
      status: "draft",
      lock_version: 1,
      base_revision: 1,
      base_publication_version: 1,
      snapshot_json: JSON.stringify(snapshot),
      snapshot_sha256: digest(snapshot),
    },
    owners: [{ id: membershipId, capabilities_json: '{"allow":[],"deny":[]}' }],
    receipt: null as null | Record<string, unknown>,
    missingTenant: false,
    missingMember: false,
    missingDraft: false,
  };
  const manager = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM auth_sessions"))
        return state.session ? [state.user] : [];
      if (sql.includes("FROM auth_users")) return [state.user];
      if (sql.includes("FROM tenants"))
        return state.missingTenant ? [] : [state.tenant];
      if (
        sql.includes("FROM tenant_memberships") &&
        sql.includes("role='owner'")
      )
        return state.owners;
      if (sql.includes("FROM tenant_memberships"))
        return state.missingMember
          ? []
          : [sql.includes("user_id=?") ? state.member : state.target];
      if (sql.includes("FROM audit_events"))
        return state.receipt ? [state.receipt] : [];
      if (sql.includes("MAX(revision)")) return [{ next: 2 }];
      if (sql.includes("FROM website_revisions"))
        return state.missingDraft ? [] : [state.draft];
      if (sql.startsWith("INSERT INTO audit_events"))
        state.receipt = {
          tenant_id: params[1],
          actor_user_id: params[2],
          action: params[4],
          metadata_json: params[7],
          request_sha256: params[9],
        };
      return [];
    },
  };
  const db = {
    transaction: async (callback: (m: typeof manager) => unknown) =>
      callback(manager),
  } as unknown as DataSource;
  const context: { token: string; tenantId: string; key: string } = {
    token: "verified-session-token",
    tenantId: tenant.id,
    key: randomUUID(),
  };
  return { state, ops: new TenantOperations(db), context };
}

test("guarded operations return stable receipts and detect stale state for eligible subscriber enrollment", async () => {
  for (const action of [
    "create",
    "save",
    "rebase",
    "publish",
    "unpublish",
    "enroll",
    "change",
    "provision",
  ]) {
    const { ops, state, context } = operationHarness();
    if (action === "enroll") state.member.role = "subscriber";
    if (action === "change")
      state.owners.push({
        id: randomUUID(),
        capabilities_json: '{"allow":[],"deny":[]}',
      });
    /** Exercise the same semantic request twice to model a lost response. */
    const run = () =>
      action === "create"
        ? ops.createDraft(context, snapshot)
        : action === "save"
          ? ops.saveDraft(context, state.draft.id, 1, snapshot)
          : action === "rebase"
            ? ops.saveDraft(context, state.draft.id, 1, snapshot, true)
            : action === "publish"
              ? ops.publish(context, state.draft.id, 1)
              : action === "unpublish"
                ? ops.unpublish(context)
                : action === "enroll"
                  ? ops.enroll(context)
                  : action === "change"
                    ? ops.changeMembership(
                        context,
                        state.target.id,
                        1,
                        "analyst",
                        false,
                      )
                    : ops.provision(
                        context,
                        { ...tenant, synthetic: false },
                        state.user.id,
                        snapshot,
                      );
    const result = await run();
    assert.ok(result);
    assert.deepEqual(await run(), result);
    state.receipt!.request_sha256 = "different";
    await assert.rejects(run(), /idempotency_conflict/);
  }
  const { ops, state, context } = operationHarness();
  state.missingMember = true;
  assert.ok((await ops.enroll(context)).membershipId);
});

test("transactional website and staff operations agree with the shared capability policy", async () => {
  for (const role of ["owner", "analyst", "support", "subscriber"] as const) {
    for (const capability of ["website:edit", "staff:manage"] as const) {
      const { state, ops, context } = operationHarness();
      state.member.role = role;
      const allowed = canAccessTenant(
        { userId: state.user.id, platformRole: "owner" },
        state.tenant,
        [
          {
            userId: state.member.user_id,
            tenantId: state.member.tenant_id,
            role,
            status: "active",
          },
        ],
        capability,
      );
      const result =
        capability === "website:edit"
          ? ops.createDraft(context, snapshot)
          : ops.changeMembership(context, state.target.id, 1, "owner", true);
      if (allowed) assert.ok(await result);
      else {
        await assert.rejects(result, /forbidden/);
        assert.equal(state.receipt, null);
      }
    }
  }
  for (const field of ["user_id", "tenant_id"] as const) {
    const { state, ops, context } = operationHarness();
    state.member[field] = randomUUID();
    await assert.rejects(ops.createDraft(context, snapshot), /forbidden/);
    assert.equal(state.receipt, null);
  }
});

test("last-owner protection excludes owners with any unsupported capability overrides", async () => {
  for (const overrides of [
    { allow: ["website:edit"], deny: [] },
    { allow: [], deny: ["website:edit"] },
    { deny: ["staff:manage"] },
  ]) {
    const { ops, state, context } = operationHarness();
    state.owners.push({
      id: randomUUID(),
      capabilities_json: JSON.stringify(overrides),
    });
    await assert.rejects(
      ops.changeMembership(context, state.target.id, 1, "analyst", false),
      /last_owner/,
    );
    assert.equal(state.receipt, null);
  }
  const { ops, state, context } = operationHarness();
  state.owners.push({ id: randomUUID(), capabilities_json: "{}" });
  assert.ok(
    await ops.changeMembership(context, state.target.id, 1, "analyst", false),
  );
});

test("operation authorization and conflict failures are explicit and never bypass membership state", async () => {
  const cases = [
    "session",
    "tenant",
    "inactive",
    "member",
    "revoked",
    "role",
    "overrides",
    "key",
    "draft",
    "version",
    "base",
    "generation",
    "checksum",
    "lastowner",
    "badrole",
    "membershipversion",
    "provision",
    "platform",
    "verified",
  ];
  for (const scenario of cases) {
    const { ops, state, context } = operationHarness();
    if (scenario === "session") state.session = false;
    if (scenario === "tenant") state.missingTenant = true;
    if (scenario === "inactive") state.tenant.status = "suspended";
    if (scenario === "member") state.missingMember = true;
    if (scenario === "revoked") state.member.status = "revoked";
    if (scenario === "role") state.member.role = "subscriber";
    if (scenario === "overrides")
      state.member.capabilities_json = '{"allow":[],"deny":["website:edit"]}';
    if (scenario === "key") context.key = "invalid";
    if (scenario === "draft") state.missingDraft = true;
    if (scenario === "version") state.draft.lock_version = 3;
    if (scenario === "base") state.draft.base_revision = 2;
    if (scenario === "generation") state.draft.base_publication_version = 2;
    if (scenario === "checksum") state.draft.snapshot_sha256 = "invalid";
    if (scenario === "platform") state.user.platform_role = "none";
    if (scenario === "verified") state.user.email_verified = 0;
    const run = () =>
      scenario === "lastowner"
        ? ops.changeMembership(context, state.target.id, 1, "subscriber", true)
        : scenario === "badrole"
          ? ops.changeMembership(
              context,
              state.target.id,
              1,
              "unknown" as "owner",
              true,
            )
          : scenario === "membershipversion"
            ? ops.changeMembership(context, state.target.id, 2, "owner", true)
            : scenario === "provision"
              ? ops.provision(
                  context,
                  { ...tenant, synthetic: true },
                  state.user.id,
                  snapshot,
                )
              : ["platform", "verified"].includes(scenario)
                ? ops.provision(
                    context,
                    { ...tenant, synthetic: false },
                    state.user.id,
                    snapshot,
                  )
                : ops.publish(context, state.draft.id, 1);
    await assert.rejects(run(), scenario);
  }
  const enrolled = operationHarness();
  enrolled.state.user.email_verified = 0;
  await assert.rejects(enrolled.ops.enroll(enrolled.context), /enrollment/);
  const revoked = operationHarness();
  revoked.state.member.status = "revoked";
  await assert.rejects(revoked.ops.enroll(revoked.context), /enrollment/);
  const stale = operationHarness();
  stale.state.draft.status = "published";
  await assert.rejects(
    stale.ops.saveDraft(stale.context, stale.state.draft.id, 1, snapshot),
    /stale/,
  );
});

test("RA Admin membership management cannot appoint another administrator through the legacy role-change API", async () => {
  const { ops, state, context } = operationHarness();
  state.user.platform_role = "";
  state.target.role = "subscriber";
  await assert.rejects(
    ops.changeMembership(context, state.target.id, 1, "owner", true),
    /forbidden/,
  );
});

test("editor reads validate checksums and current membership before returning draft data", async () => {
  const { ops, state, context } = operationHarness();
  const draft = await ops.readWebsite(context);
  assert.equal(draft.id, state.draft.id);
  assert.deepEqual(draft.snapshot, snapshot);
  state.draft.snapshot_sha256 = "corrupted";
  await assert.rejects(ops.readWebsite(context), /invalid_snapshot_checksum/);
  state.draft.snapshot_sha256 = digest(snapshot);
  state.member.role = "analyst";
  await assert.rejects(ops.readWebsite(context), /forbidden/);
  state.member.role = "owner";
  state.missingDraft = true;
  const empty = await ops.readWebsite(context);
  assert.equal(empty.id, null);
  assert.deepEqual(empty.snapshot.content, { en: {} });
});

test("subscriber enrollment rejects every staff role and the membership API cannot cross subscriber/staff categories", async () => {
  for (const role of ["owner", "analyst", "support"] as const) {
    const { ops, state, context } = operationHarness();
    state.member.role = role;
    await assert.rejects(ops.enroll(context), /staff_only/);
    assert.equal(state.receipt, null);
  }
  for (const role of ["owner", "analyst", "support"] as const) {
    const { ops, state, context } = operationHarness();
    state.target.role = "subscriber";
    await assert.rejects(
      ops.changeMembership(context, state.target.id, 1, role, true),
      /role_category_conflict/,
    );
    assert.equal(state.receipt, null);
    state.target.role = role;
    await assert.rejects(
      ops.changeMembership(context, state.target.id, 1, "subscriber", true),
      /role_category_conflict/,
    );
    assert.equal(state.receipt, null);
  }
});

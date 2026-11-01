import { test } from "node:test";
import assert from "node:assert/strict";
import type { DataSource } from "typeorm";
import { OrganisationService } from "../src/organisations/service";
import { randomUUID } from "node:crypto";

/** Model trusted database facts and collect bound SQL for transaction and denial tests. */
function harness() {
  const userId = randomUUID(),
    tenantId = randomUUID();
  const state = {
    platform: true,
    verified: true,
    session: true,
    role: "owner",
    status: "active",
    invitedRole: "analyst",
    accepted: false,
    revoked: false,
    expired: false,
    email: "person@example.test",
    inviteEmail: "person@example.test",
    tenantStatus: "active",
    existingRole: null as string | null,
    missingMember: false,
    missingTenant: false,
    missingUser: false,
    overrides: '{"allow":[],"deny":[]}',
  };
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("FROM auth_sessions"))
      return state.session
        ? [
            {
              id: userId,
              email: state.email,
              email_verified: state.verified ? 1 : 0,
              platform_role: state.platform ? "owner" : null,
            },
          ]
        : [];
    if (sql.includes("FROM auth_users"))
      return state.missingUser
        ? []
        : [
            {
              id: userId,
              email: state.email,
              email_verified: state.verified ? 1 : 0,
              platform_role: state.platform ? "owner" : null,
            },
          ];
    if (sql.includes("FROM organisation_invitations"))
      return state.expired
        ? []
        : [
            {
              id: randomUUID(),
              tenant_id: tenantId,
              email: state.inviteEmail,
              role: state.invitedRole,
              created_by: userId,
              accepted_at: state.accepted ? "2026-11-01" : null,
              revoked_at: state.revoked ? "2026-11-01" : null,
            },
          ];
    if (sql.includes("FROM tenants"))
      return state.missingTenant
        ? []
        : [
            {
              id: tenantId,
              slug: "alpha",
              status: state.tenantStatus,
              is_synthetic: 0,
              display_name: "Alpha Research",
              legal_name: "Alpha Research",
              registration_number: null,
              monogram: "ar",
            },
          ];
    if (
      sql.includes("SELECT id,role,status FROM tenant_memberships") &&
      state.missingMember
    )
      return [];
    if (sql.includes("FROM tenant_memberships"))
      return sql.includes("user_id=?")
        ? state.existingRole
          ? [
              {
                id: randomUUID(),
                role: state.existingRole,
                status: state.status,
                capabilities_json: state.overrides,
              },
            ]
          : [
              {
                id: randomUUID(),
                role: state.role,
                status: state.status,
                capabilities_json: state.overrides,
              },
            ]
        : [];
    return [];
  };
  const db = {
    query,
    transaction: async (fn: (m: { query: typeof query }) => unknown) =>
      fn({ query }),
  } as unknown as DataSource;
  return {
    service: new OrganisationService(db),
    state,
    calls,
    userId,
    tenantId,
  };
}

test("organisation creation requires a verified platform owner, validates input and creates a draft without fake published content", async () => {
  const { service, state, calls } = harness();
  const input = {
    slug: "new-ra",
    name: "New Research",
    legalName: "Legal Research",
    monogram: "nr",
  };
  state.platform = false;
  await assert.rejects(service.create("token", input), /forbidden/);
  state.platform = true;
  state.verified = false;
  await assert.rejects(service.create("token", input), /forbidden/);
  state.verified = true;
  await assert.rejects(service.create("token", { ...input, slug: "admin" }));
  const result = await service.create("token", input);
  assert.equal(result.slug, "new-ra");
  assert.ok(
    calls.some(
      (c) => c.sql.includes("INSERT INTO tenants") && c.sql.includes("'draft'"),
    ),
  );
  assert.equal(
    calls.some((c) => c.sql.includes("website_revisions")),
    false,
  );
  assert.ok(calls.some((c) => c.sql.includes("INSERT INTO audit_events")));
});

test("invitations reject self-selected admin roles and inactive/revoked issuers, hash tokens and revoke previous pending grants", async () => {
  const { service, state, calls, tenantId } = harness();
  state.platform = false;
  await assert.rejects(
    service.invite("token", tenantId, "person@example.test", "owner"),
    /forbidden/,
  );
  state.role = "analyst";
  await assert.rejects(
    service.invite("token", tenantId, "person@example.test", "support"),
    /forbidden/,
  );
  state.role = "owner";
  state.status = "revoked";
  await assert.rejects(
    service.invite("token", tenantId, "person@example.test", "support"),
    /forbidden/,
  );
  state.status = "active";
  await assert.rejects(
    service.invite("token", tenantId, "bad-email", "support"),
    /invalid/,
  );
  const invite = await service.invite(
    "token",
    tenantId,
    "PERSON@example.test",
    "analyst",
  );
  assert.match(invite.token, /^[a-f0-9]{64}$/);
  const insert = calls.find((c) =>
    c.sql.includes("INSERT INTO organisation_invitations"),
  )!;
  assert.equal(insert.params.includes(invite.token), false);
  assert.ok(
    calls.some((c) =>
      c.sql.includes("UPDATE organisation_invitations SET revoked_at"),
    ),
  );
  state.tenantStatus = "suspended";
  await assert.rejects(
    service.invite("token", tenantId, "person@example.test", "analyst"),
    /tenant_unavailable/,
  );
});

test("invitation acceptance is verified, email-bound, tenant-bound, single-use and denies revoked membership", async () => {
  const { service, state, tenantId } = harness();
  const token = "a".repeat(64);
  state.session = false;
  await assert.rejects(
    service.accept("session", tenantId, token),
    /unauthorized/,
  );
  state.session = true;
  state.verified = false;
  await assert.rejects(
    service.accept("session", tenantId, token),
    /invitation_unavailable/,
  );
  state.verified = true;
  state.inviteEmail = "someone@example.test";
  await assert.rejects(
    service.accept("session", tenantId, token),
    /invitation_unavailable/,
  );
  state.inviteEmail = state.email;
  state.accepted = true;
  await assert.rejects(
    service.accept("session", tenantId, token),
    /invitation_unavailable/,
  );
  state.accepted = false;
  state.revoked = true;
  await assert.rejects(
    service.accept("session", tenantId, token),
    /invitation_unavailable/,
  );
  state.revoked = false;
  state.expired = true;
  await assert.rejects(
    service.accept("session", tenantId, token),
    /invitation_unavailable/,
  );
  state.expired = false;
  await assert.rejects(
    service.accept("session", randomUUID(), token),
    /invitation_unavailable/,
  );
  state.existingRole = "subscriber";
  state.status = "revoked";
  await assert.rejects(
    service.accept("session", tenantId, token),
    /membership_revoked/,
  );
  state.status = "active";
  const result = await service.accept("session", tenantId, token);
  assert.equal(result.role, "analyst");
});

test("organisation reads require current platform/session permissions and invitation previews do not expose invalid or expired credentials", async () => {
  const { service, state, calls, tenantId } = harness();
  assert.equal(await service.isPlatformOwner("session"), true);
  state.platform = false;
  assert.equal(await service.isPlatformOwner("session"), false);
  await assert.rejects(service.list("session"), /forbidden/);
  state.platform = true;
  assert.equal((await service.list("session"))[0].slug, "alpha");
  assert.equal(await service.preview("alpha", "bad"), null);
  assert.ok(await service.preview("alpha", "a".repeat(64)));
  state.expired = true;
  assert.equal(await service.preview("alpha", "a".repeat(64)), null);
  state.expired = false;
  await service.delivered("invite", true);
  await service.delivered("invite", false);
  assert.deepEqual(
    calls
      .filter((call) => call.sql.includes("delivery_status"))
      .map((call) => call.params),
    [
      ["sent", "invite"],
      ["failed", "invite"],
    ],
  );
  assert.ok(await service.invitations("session", tenantId));
  await assert.rejects(
    service.invite(
      "session",
      tenantId,
      "person@example.test",
      "platform-owner",
    ),
    /invalid_role/,
  );
  await assert.rejects(
    service.accept("session", tenantId, "bad"),
    /invitation_unavailable/,
  );
  state.role = "subscriber";
  state.platform = false;
  await assert.rejects(service.invitations("session", tenantId), /forbidden/);
});

test("new invitation memberships activate draft organisations only for an admin grant, while missing/revoked issuer facts deny acceptance", async () => {
  const { service, state, calls, tenantId } = harness();
  state.missingMember = true;
  state.invitedRole = "owner";
  state.tenantStatus = "draft";
  assert.equal(
    (await service.accept("session", tenantId, "a".repeat(64))).role,
    "owner",
  );
  assert.ok(
    calls.some((call) => call.sql.includes("INSERT INTO tenant_memberships")),
  );
  assert.ok(
    calls.some((call) =>
      call.sql.includes("UPDATE tenants SET status='active'"),
    ),
  );
  state.invitedRole = "analyst";
  assert.equal(
    (await service.accept("session", tenantId, "a".repeat(64))).role,
    "analyst",
  );
  state.missingTenant = true;
  assert.equal(await service.preview("alpha", "a".repeat(64)), null);
  await assert.rejects(
    service.invite("session", tenantId, "person@example.test", "analyst"),
    /tenant_unavailable/,
  );
  state.missingTenant = false;
  state.missingUser = true;
  await assert.rejects(
    service.accept("session", tenantId, "a".repeat(64)),
    /invitation_unavailable/,
  );
  state.missingUser = false;
  state.platform = false;
  state.role = "analyst";
  state.tenantStatus = "active";
  await assert.rejects(
    service.accept("session", tenantId, "a".repeat(64)),
    /invitation_unavailable/,
  );
  state.role = "owner";
  state.overrides = JSON.stringify({ allow: ["staff:manage"], deny: [] });
  await assert.rejects(
    service.invite("session", tenantId, "person@example.test", "analyst"),
    /forbidden/,
  );
  state.overrides = JSON.stringify({ allow: [], deny: ["staff:manage"] });
  await assert.rejects(
    service.accept("session", tenantId, "a".repeat(64)),
    /invitation_unavailable/,
  );
});

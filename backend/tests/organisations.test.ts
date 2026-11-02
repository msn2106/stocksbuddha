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
    recipientRole: null as string | null,
    recipientStatus: "active",
    registered: false,
    rateHits: 0,
    rateElapsed: 0,
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
    targetUserId: randomUUID(),
    targetStatus: "active",
    overrides: '{"allow":[],"deny":[]}',
  };
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT m.role,m.status FROM tenant_memberships"))
      return state.recipientRole
        ? [{ role: state.recipientRole, status: state.recipientStatus }]
        : [];
    if (sql.startsWith("SELECT id,role,status FROM tenant_memberships"))
      return state.existingRole && !state.missingMember
        ? [
            {
              id: "recipient-member",
              role: state.existingRole,
              status: state.status,
            },
          ]
        : [];
    if (sql.startsWith("SELECT hits,TIMESTAMPDIFF"))
      return [{ hits: state.rateHits, elapsed: state.rateElapsed }];
    if (sql.startsWith("SELECT id FROM auth_users WHERE email="))
      return state.registered ? [{ id: userId }] : [];
    if (
      sql.startsWith("SELECT id,role,status FROM tenant_memberships") &&
      params[1] !== userId
    )
      return [];
    if (sql.startsWith("SELECT user_id FROM tenant_memberships"))
      return [{ user_id: state.targetUserId }];
    if (sql.startsWith("SELECT m.*"))
      return [
        {
          user_id: state.targetUserId,
          status: state.targetStatus,
          email: "target@example.test",
        },
      ];
    if (sql.startsWith("SELECT m.id,m.user_id"))
      return [
        {
          id: "target",
          user_id: state.targetUserId,
          name: "Target",
          email: "target@example.test",
          role: "analyst",
          status: state.targetStatus,
        },
        {
          id: "self",
          user_id: userId,
          name: "Self",
          email: state.email,
          role: "owner",
          status: "active",
        },
      ];
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
              full_name: "Invited Person",
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
    transaction: async (
      isolationOrFn: string | ((m: { query: typeof query }) => unknown),
      callback?: (m: { query: typeof query }) => unknown,
    ) =>
      typeof isolationOrFn === "string"
        ? callback!({ query })
        : isolationOrFn({ query }),
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
    service.invite(
      "token",
      tenantId,
      "person@example.test",
      "owner",
      "Test Person",
    ),
    /forbidden/,
  );
  state.role = "analyst";
  await assert.rejects(
    service.invite(
      "token",
      tenantId,
      "person@example.test",
      "support",
      "Test Person",
    ),
    /forbidden/,
  );
  state.role = "owner";
  state.status = "revoked";
  await assert.rejects(
    service.invite(
      "token",
      tenantId,
      "person@example.test",
      "support",
      "Test Person",
    ),
    /forbidden/,
  );
  state.status = "active";
  await assert.rejects(
    service.invite("token", tenantId, "bad-email", "support", "Test Person"),
    /invalid/,
  );
  const invite = await service.invite(
    "token",
    tenantId,
    "PERSON@example.test",
    "analyst",
    "Test Person",
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
    service.invite(
      "token",
      tenantId,
      "person@example.test",
      "analyst",
      "Test Person",
    ),
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
  await assert.rejects(
    service.accept("session", tenantId, token),
    /subscriber_conflict/,
  );
  state.existingRole = "analyst";
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
      "Test Person",
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
    service.invite(
      "session",
      tenantId,
      "person@example.test",
      "analyst",
      "Test Person",
    ),
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
    service.invite(
      "session",
      tenantId,
      "person@example.test",
      "analyst",
      "Test Person",
    ),
    /forbidden/,
  );
  state.overrides = JSON.stringify({ allow: [], deny: ["staff:manage"] });
  await assert.rejects(
    service.accept("session", tenantId, "a".repeat(64)),
    /invitation_unavailable/,
  );
});

test("invitation names are required, bounded and preserved for personalized delivery", async () => {
  const { service, tenantId } = harness();
  for (const name of ["", "  ", "x".repeat(101), "Name\nInjected"])
    await assert.rejects(
      service.invite("token", tenantId, "person@example.test", "analyst", name),
      /invalid_name/,
    );
  const invite = await service.invite(
    "token",
    tenantId,
    "person@example.test",
    "analyst",
    "  Ada Lovelace  ",
  );
  assert.equal(invite.fullName, "Ada Lovelace");
});

test("resend uses stored grants and fresh credentials; only a current RA admin can resend or revoke invitations", async () => {
  const { service, tenantId, state, calls } = harness();
  state.platform = false;
  const resent = await service.resend("session", tenantId, "invite-id");
  assert.equal(resent.fullName, "Invited Person");
  assert.equal(resent.email, state.inviteEmail);
  assert.equal(resent.role, "analyst");
  assert.match(resent.token, /^[a-f0-9]{64}$/);
  assert.ok(
    calls.some(
      (c) =>
        c.sql.includes("INSERT INTO organisation_invitations") &&
        !c.params.includes(resent.token),
    ),
  );
  await service.revokeInvitation("session", tenantId, "invite-id");
  for (const role of ["analyst", "support", "subscriber"]) {
    state.role = role;
    // Platform ownership cannot bypass the tenant-admin requirement.
    state.platform = true;
    await assert.rejects(
      service.resend("session", tenantId, "invite-id"),
      /forbidden/,
    );
    await assert.rejects(
      service.revokeInvitation("session", tenantId, "invite-id"),
      /forbidden/,
    );
  }
  state.role = "owner";
  state.status = "revoked";
  await assert.rejects(
    service.resend("session", tenantId, "invite-id"),
    /forbidden/,
  );
  state.status = "active";
  state.accepted = true;
  await assert.rejects(
    service.resend("session", tenantId, "invite-id"),
    /invitation_unavailable/,
  );
  await assert.rejects(
    service.revokeInvitation("session", tenantId, "invite-id"),
    /invitation_unavailable/,
  );
  state.accepted = false;
  state.revoked = true;
  await assert.rejects(
    service.resend("session", tenantId, "invite-id"),
    /invitation_unavailable/,
  );
});

test("revocation is tenant-scoped, audited, denies non-admins and protects the caller", async () => {
  const { service, tenantId, userId, state, calls } = harness();
  state.platform = false;
  const roster = await service.members("session", tenantId);
  assert.equal(roster.find((m) => m.id === "self")?.canRevoke, false);
  assert.equal(roster.find((m) => m.id === "target")?.canRevoke, true);
  await service.revokeMember("session", tenantId, "target");
  assert.ok(
    calls.some(
      (c) =>
        c.sql.startsWith("UPDATE tenant_memberships SET status='revoked'") &&
        c.params[0] === tenantId &&
        c.params[1] === "target",
    ),
  );
  assert.ok(
    calls.some((c) => c.params.includes("organisation.access_revoked")),
  );
  state.role = "analyst";
  state.platform = true;
  await assert.rejects(
    service.revokeMember("session", tenantId, "target"),
    /forbidden/,
  );
  state.role = "owner";
  state.targetUserId = userId;
  await assert.rejects(
    service.revokeMember("session", tenantId, "self"),
    /membership_unavailable/,
  );
});

test("invited signup proves only the stored email, hashes passwords compatibly and grants only the stored role", async () => {
  const { verifyPassword } = await import("better-auth/crypto");
  const { service, state, tenantId, calls } = harness();
  state.platform = false;
  const result = await service.register(
    tenantId,
    "a".repeat(64),
    "Invited Person",
    "Chosen-password-123",
    "trusted-client",
  );
  assert.equal(result.email, state.inviteEmail);
  assert.equal(result.role, "analyst");
  const user = calls.find((c) => c.sql.startsWith("INSERT INTO auth_users"))!;
  assert.equal(user.params[2], state.inviteEmail);
  assert.ok(user.sql.includes("email_verified"));
  assert.equal(user.sql.includes("platform_role"), false);
  const account = calls.find((c) =>
    c.sql.startsWith("INSERT INTO auth_accounts"),
  )!;
  assert.equal(account.params.includes("Chosen-password-123"), false);
  assert.equal(
    await verifyPassword({
      hash: String(account.params[3]),
      password: "Chosen-password-123",
    }),
    true,
  );
  assert.ok(
    calls.some((c) =>
      c.sql.startsWith("UPDATE organisation_invitations SET accepted_at"),
    ),
  );
});

test("invited signup rejects invalid, expired, revoked and cross-tenant grants and never overwrites existing credentials", async () => {
  const { service, state, tenantId, calls } = harness();
  const register = (
    credential = "a".repeat(64),
    id = tenantId,
    password = "Chosen-password-123",
  ) => service.register(id, credential, "Person", password, "trusted-client");
  await assert.rejects(register("bad"), /invitation_unavailable/);
  await assert.rejects(
    register(undefined, undefined, "short"),
    /invalid_password/,
  );
  await assert.rejects(
    register(undefined, randomUUID()),
    /invitation_unavailable/,
  );
  for (const property of ["expired", "revoked", "accepted"] as const) {
    state[property] = true;
    await assert.rejects(register(), /invitation_unavailable/);
    state[property] = false;
  }
  state.registered = true;
  await assert.rejects(register(), /account_exists/);
  assert.equal(
    calls.some(
      (c) =>
        c.sql.startsWith("INSERT INTO auth_users") ||
        c.sql.startsWith("UPDATE auth_users"),
    ),
    false,
  );
  state.registered = false;
  state.platform = false;
  state.role = "analyst";
  await assert.rejects(register(), /invitation_unavailable/);
  state.role = "owner";
  state.status = "revoked";
  await assert.rejects(register(), /invitation_unavailable/);
});

test("invited signup uses a shared IP limit before password hashing and permits a fresh window", async () => {
  const { service, state, tenantId, calls } = harness();
  state.rateHits = 10;
  await assert.rejects(
    service.register(
      tenantId,
      "a".repeat(64),
      "Person",
      "Chosen-password-123",
      "trusted-client",
    ),
    /throttled/,
  );
  assert.equal(
    calls.some((c) => c.sql.includes("FROM organisation_invitations")),
    false,
  );
  state.rateElapsed = 61;
  await service.register(
    tenantId,
    "a".repeat(64),
    "Person",
    "Chosen-password-123",
    "trusted-client",
  );
  assert.ok(
    calls.some((c) => c.sql.startsWith("UPDATE auth_rate_limits SET hits=1")),
  );
});

test("inviting or resending rejects subscribers and every different staff role without replacing a pending link", async () => {
  for (const existing of [
    "subscriber",
    "owner",
    "analyst",
    "support",
  ] as const) {
    for (const invited of ["owner", "analyst", "support"] as const) {
      const { service, state, calls, tenantId } = harness();
      state.recipientRole = existing;
      if (existing === invited) {
        await service.invite(
          "session",
          tenantId,
          state.inviteEmail,
          invited,
          "Person",
        );
        continue;
      }
      await assert.rejects(
        service.invite(
          "session",
          tenantId,
          state.inviteEmail,
          invited,
          "Person",
        ),
        existing === "subscriber"
          ? /subscriber_conflict/
          : /staff_role_conflict/,
      );
      assert.equal(
        calls.some(
          (c) =>
            c.sql.startsWith("INSERT INTO organisation_invitations") ||
            c.sql.startsWith("UPDATE organisation_invitations SET revoked_at"),
        ),
        false,
      );
      if (invited !== "owner") {
        state.invitedRole = invited;
        await assert.rejects(
          service.resend("session", tenantId, "old-invite"),
          existing === "subscriber"
            ? /subscriber_conflict/
            : /staff_role_conflict/,
        );
      }
    }
  }
});

test("revoked recipients cannot be reinvited or resent a same-role grant", async () => {
  const { service, state, calls, tenantId } = harness();
  state.recipientRole = "analyst";
  state.recipientStatus = "revoked";
  await assert.rejects(
    service.invite("session", tenantId, state.inviteEmail, "analyst", "Person"),
    /membership_revoked/,
  );
  await assert.rejects(
    service.resend("session", tenantId, "old-invite"),
    /membership_revoked/,
  );
  assert.equal(
    calls.some(
      (call) =>
        call.sql.startsWith("INSERT INTO organisation_invitations") ||
        call.sql.startsWith("UPDATE organisation_invitations SET revoked_at"),
    ),
    false,
  );
});

test("acceptance rechecks every existing role and leaves incompatible memberships and the invitation unchanged", async () => {
  for (const existing of [
    "subscriber",
    "owner",
    "analyst",
    "support",
  ] as const) {
    for (const invited of ["owner", "analyst", "support"] as const) {
      const { service, state, calls, tenantId } = harness();
      state.existingRole = existing;
      state.invitedRole = invited;
      if (existing === invited) {
        await service.accept("session", tenantId, "a".repeat(64));
        continue;
      }
      await assert.rejects(
        service.accept("session", tenantId, "a".repeat(64)),
        existing === "subscriber"
          ? /subscriber_conflict/
          : /staff_role_conflict/,
      );
      assert.equal(
        calls.some(
          (c) =>
            c.sql.startsWith("UPDATE tenant_memberships") ||
            c.sql.startsWith("INSERT INTO tenant_memberships") ||
            c.sql.startsWith("UPDATE organisation_invitations SET accepted_at"),
        ),
        false,
      );
    }
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canAccessTenant,
  canAdministerPlatform,
  type Membership,
} from "../src/access/authorization";
import { tenants } from "../src/tenants/tenants";
const alice = { userId: "alice", platformRole: null };
const member: Membership = {
  userId: "alice",
  tenantId: tenants[1].id,
  role: "owner",
  status: "active",
};
test("membership grants permissions only in its tenant for its authenticated user", () => {
  assert.equal(
    canAccessTenant(alice, tenants[1], [member], "website:edit"),
    true,
  );
  assert.equal(
    canAccessTenant(alice, tenants[2], [member], "website:edit"),
    false,
  );
  assert.equal(
    canAccessTenant(
      { userId: "bob", platformRole: null },
      tenants[1],
      [member],
      "website:edit",
    ),
    false,
  );
  assert.equal(
    canAccessTenant(null, tenants[1], [member], "website:edit"),
    false,
  );
});
test("revocation, suspension and role restrictions deny protected operations", () => {
  assert.equal(
    canAccessTenant(
      alice,
      tenants[1],
      [{ ...member, status: "revoked" }],
      "website:edit",
    ),
    false,
  );
  assert.equal(
    canAccessTenant(
      alice,
      { ...tenants[1], status: "suspended" },
      [member],
      "website:edit",
    ),
    false,
  );
  for (const role of ["subscriber", "analyst", "support"] as const)
    assert.equal(
      canAccessTenant(alice, tenants[1], [{ ...member, role }], "staff:manage"),
      false,
    );
  assert.equal(
    canAccessTenant(
      alice,
      tenants[1],
      [{ ...member, role: "analyst" }],
      "research:publish",
    ),
    true,
  );
});
test("platform administration is independent from RA membership", () => {
  const platformOwner = {
    userId: "platform-owner",
    platformRole: "owner" as const,
  };
  assert.equal(canAdministerPlatform(platformOwner), true);
  assert.equal(canAdministerPlatform(alice), false);
  assert.equal(
    canAccessTenant(platformOwner, tenants[1], [], "website:edit"),
    false,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canInvite,
  workspaceDestination,
  invitationRoleConflict,
} from "../src/organisations/policy";

test("only platform owners appoint RA Admins; tenant admins invite staff solely within their own active RA", () => {
  assert.equal(canInvite(true, null, "owner"), true);
  assert.equal(canInvite(false, "owner", "owner"), false);
  for (const role of ["analyst", "support"] as const) {
    assert.equal(canInvite(false, "owner", role), true);
    assert.equal(canInvite(true, null, role), true);
    assert.equal(canInvite(false, "analyst", role), false);
    assert.equal(canInvite(false, "support", role), false);
    assert.equal(canInvite(false, null, role), false);
  }
});

test("login selection determines a destination but never grants a role or lets staff fall into investor enrollment", () => {
  assert.equal(
    workspaceDestination("organisation", "owner", true),
    "workspace",
  );
  assert.equal(
    workspaceDestination("organisation", "analyst", true),
    "workspace",
  );
  assert.equal(
    workspaceDestination("organisation", "support", true),
    "workspace",
  );
  assert.equal(workspaceDestination("organisation", "subscriber", true), null);
  assert.equal(workspaceDestination("organisation", null, true), null);
  assert.equal(workspaceDestination("investor", "subscriber", true), "account");
  assert.equal(workspaceDestination("investor", null, true), "join");
  assert.equal(workspaceDestination("investor", null, false), "account");
});

test("every role is exclusive within an RA and invitations cannot convert any existing role", () => {
  for (const existing of [
    "owner",
    "analyst",
    "support",
    "subscriber",
  ] as const) {
    assert.equal(
      workspaceDestination("investor", existing, true),
      existing === "subscriber" ? "account" : null,
    );
    for (const invited of ["owner", "analyst", "support"] as const) {
      assert.equal(
        invitationRoleConflict(existing, invited),
        existing === invited
          ? null
          : existing === "subscriber"
            ? "subscriber_conflict"
            : "staff_role_conflict",
      );
      assert.equal(invitationRoleConflict(null, invited), null);
    }
  }
});

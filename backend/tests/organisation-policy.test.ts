import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canInvite,
  workspaceDestination,
  mergeInvitationRole,
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

test("accepting a staff invite preserves an existing admin/staff role and promotes a subscriber only to the stored invitation role", () => {
  assert.equal(mergeInvitationRole(null, "owner"), "owner");
  assert.equal(mergeInvitationRole("subscriber", "analyst"), "analyst");
  assert.equal(mergeInvitationRole("owner", "support"), "owner");
  assert.equal(mergeInvitationRole("analyst", "support"), "analyst");
  assert.equal(mergeInvitationRole("support", "owner"), "owner");
});

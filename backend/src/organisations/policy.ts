import type { TenantRole } from "../access/authorization";
export type StaffRole = "owner" | "analyst" | "support";

/** Limit administrator appointment to platform owners and team invitations to RA Admins. */
export function canInvite(
  platformOwner: boolean,
  tenantRole: TenantRole | null,
  role: StaffRole,
): boolean {
  return platformOwner || (tenantRole === "owner" && role !== "owner");
}
/** Resolve intent against a stored membership; selecting Organisation can never enroll a subscriber. */
export function workspaceDestination(
  audience: "investor" | "organisation",
  role: TenantRole | null,
  verifiedEnrollment: boolean,
) {
  if (audience === "organisation")
    return role && role !== "subscriber" ? "workspace" : null;
  if (role && role !== "subscriber") return null;
  return role === "subscriber" || !verifiedEnrollment ? "account" : "join";
}
/** Invitations may establish a role or repeat the same role, never convert an existing membership. */
export function invitationRoleConflict(
  existing: TenantRole | null,
  invited: StaffRole,
): "subscriber_conflict" | "staff_role_conflict" | null {
  if (!existing || existing === invited) return null;
  return existing === "subscriber"
    ? "subscriber_conflict"
    : "staff_role_conflict";
}

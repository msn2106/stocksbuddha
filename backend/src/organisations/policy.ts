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
  return role || !verifiedEnrollment ? "account" : "join";
}
/** Preserve established staff permissions while allowing an explicit administrator appointment. */
export function mergeInvitationRole(
  existing: TenantRole | null,
  invited: StaffRole,
): StaffRole {
  return invited === "owner"
    ? "owner"
    : existing && existing !== "subscriber"
      ? existing
      : invited;
}

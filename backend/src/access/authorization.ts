import type { Tenant } from "@ra/contracts";

export type TenantRole = "owner" | "analyst" | "support" | "subscriber";
export type Capability =
  "website:edit" | "research:publish" | "subscribers:read" | "staff:manage";
export type Membership = {
  userId: string;
  tenantId: string;
  role: TenantRole;
  status: "active" | "revoked";
};
// A session adapter must supply the authenticated identity, never a request-body user ID.
export type Principal = { userId: string; platformRole: "owner" | null };
const permissions: Record<TenantRole, readonly Capability[]> = {
  owner: [
    "website:edit",
    "research:publish",
    "subscribers:read",
    "staff:manage",
  ],
  analyst: ["research:publish"],
  support: ["subscribers:read"],
  subscriber: [],
};
/**
 * Evaluate a tenant capability using the authenticated identity and its active membership.
 * Platform ownership alone grants no tenant capabilities; suspended tenants and
 * revoked memberships are denied. This pure policy does not authenticate requests.
 * @param principal - Identity supplied by a trusted session adapter, or null for a guest.
 * @param tenant - Server-resolved tenant whose status and ID constrain access.
 * @param memberships - Membership records to match against the identity and tenant.
 * @param capability - Operation to check against the matching member's role.
 * @returns Whether an active matching membership grants the requested operation.
 */
export function canAccessTenant(
  principal: Principal | null,
  tenant: Tenant,
  memberships: readonly Membership[],
  capability: Capability,
): boolean {
  if (!principal || tenant.status !== "active") return false;
  // Platform ownership does not implicitly create a tenant membership. Any
  // future support impersonation needs a separate, audited access mechanism.
  return memberships.some(
    (m) =>
      m.userId === principal.userId &&
      m.tenantId === tenant.id &&
      m.status === "active" &&
      permissions[m.role]?.includes(capability),
  );
}
/**
 * Check the platform role independently of tenant memberships.
 * @param principal - Identity supplied by a trusted session adapter, or null for a guest.
 * @returns Whether the identity has the platform owner role.
 */
export function canAdministerPlatform(principal: Principal | null): boolean {
  return principal?.platformRole === "owner";
}

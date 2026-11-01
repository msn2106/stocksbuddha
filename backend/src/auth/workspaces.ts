import type { DataSource } from "typeorm";
import { tenantSchema, type Tenant } from "@ra/contracts";
import { MariaDbTenantRepository } from "../database/repositories";
import {
  canAccessTenant,
  type Capability,
  type Membership,
} from "../access/authorization";

export type Workspace = {
  tenant: Tenant;
  membership: Membership & { id: string; version: number };
  capabilities: Capability[];
};
export interface WorkspaceStore {
  tenant(slug: string): Promise<Tenant | null>;
  list(userId: string): Promise<Workspace[]>;
  find(userId: string, slug: string): Promise<Workspace | null>;
  members(tenantId: string): Promise<unknown[]>;
}
const capabilities: Capability[] = [
  "website:edit",
  "research:publish",
  "subscribers:read",
  "staff:manage",
];

type MembershipRow = {
  id: string;
  role: Membership["role"];
  status: Membership["status"];
  lock_version: number;
  capabilities_json: string | { allow?: string[]; deny?: string[] } | null;
};
type WorkspaceRow = {
  id: string;
  slug: string;
  status: Tenant["status"];
  is_synthetic: number;
  display_name: string;
  legal_name: string;
  registration_number: string | null;
  monogram: string;
  membership_id: string;
  membership_role: Membership["role"];
  membership_status: Membership["status"];
  membership_version: number;
  capabilities_json: MembershipRow["capabilities_json"];
};

/** Project current database membership facts through the same capability policy for list and detail reads. */
function projectWorkspace(
  tenant: Tenant,
  row: MembershipRow,
  userId: string,
): Workspace | null {
  if (
    tenant.status !== "active" ||
    row.status !== "active" ||
    !["owner", "analyst", "support", "subscriber"].includes(row.role)
  )
    return null;
  const overrides =
    typeof row.capabilities_json === "string"
      ? JSON.parse(row.capabilities_json)
      : row.capabilities_json;
  if (!overrides || overrides.allow?.length || overrides.deny?.length)
    return null;
  const membership = {
    id: row.id,
    userId,
    tenantId: tenant.id,
    role: row.role,
    status: row.status,
    version: row.lock_version,
  };
  return {
    tenant,
    membership,
    capabilities: capabilities.filter((capability) =>
      canAccessTenant(
        { userId, platformRole: null },
        tenant,
        [membership],
        capability,
      ),
    ),
  };
}

/** Read current membership state on every request; no browser-selected identity or role is accepted. */
export class MariaDbWorkspaceStore implements WorkspaceStore {
  /** Retain the shared application pool and tenant projection. */
  constructor(private readonly db: DataSource) {}

  /** Resolve an active tenant for verified self-enrollment without requiring an existing membership. */
  async tenant(slug: string) {
    const tenant = await new MariaDbTenantRepository(this.db).findBySlug(slug);
    return tenant?.status === "active" ? tenant : null;
  }

  /** Read all active workspaces for this identity in one joined query, without per-membership pool fan-out. */
  async list(userId: string) {
    const rows: WorkspaceRow[] = await this.db.query(
      "SELECT t.id,t.slug,t.status,t.is_synthetic,t.display_name,t.legal_name,t.registration_number,t.monogram,m.id AS membership_id,m.role AS membership_role,m.status AS membership_status,m.lock_version AS membership_version,m.capabilities_json FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.status='active' AND t.status='active' ORDER BY t.slug",
      [userId],
    );
    return rows
      .map((row) =>
        projectWorkspace(
          tenantSchema.parse({
            id: row.id,
            slug: row.slug,
            status: row.status,
            synthetic: Boolean(row.is_synthetic),
            profile: {
              name: row.display_name,
              legalName: row.legal_name,
              registration: row.registration_number,
              monogram: row.monogram,
            },
          }),
          {
            id: row.membership_id,
            role: row.membership_role,
            status: row.membership_status,
            lock_version: row.membership_version,
            capabilities_json: row.capabilities_json,
          },
          userId,
        ),
      )
      .filter((workspace): workspace is Workspace => workspace !== null);
  }

  /** Resolve a canonical tenant and exact active membership, deriving capabilities server-side. */
  async find(userId: string, slug: string): Promise<Workspace | null> {
    const tenant = await this.tenant(slug);
    if (!tenant) return null;
    const [row]: MembershipRow[] = await this.db.query(
      "SELECT id,role,status,lock_version,capabilities_json FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND status='active'",
      [tenant.id, userId],
    );
    return row ? projectWorkspace(tenant, row, userId) : null;
  }

  /** Return a minimal membership roster only after the route enforces staff:manage. */
  async members(tenantId: string) {
    return this.db.query(
      "SELECT id,user_id AS userId,role,status,lock_version AS version FROM tenant_memberships WHERE tenant_id=? ORDER BY id",
      [tenantId],
    );
  }
}

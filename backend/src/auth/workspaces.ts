import type { DataSource } from "typeorm";
import type { Tenant } from "@ra/contracts";
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

/** Read current membership state on every request; no browser-selected identity or role is accepted. */
export class MariaDbWorkspaceStore implements WorkspaceStore {
  /** Retain the shared application pool and tenant projection. */
  constructor(private readonly db: DataSource) {}

  /** Resolve an active tenant for verified self-enrollment without requiring an existing membership. */
  async tenant(slug: string) {
    const tenant = await new MariaDbTenantRepository(this.db).findBySlug(slug);
    return tenant?.status === "active" ? tenant : null;
  }

  /** Resolve only active tenants for this identity, excluding unsupported permission overrides. */
  async list(userId: string) {
    const rows: { slug: string }[] = await this.db.query(
      "SELECT t.slug FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.status='active' AND t.status='active' ORDER BY t.slug",
      [userId],
    );
    const workspaces = await Promise.all(
      rows.map((row) => this.find(userId, row.slug)),
    );
    return workspaces.filter(
      (workspace): workspace is Workspace => workspace !== null,
    );
  }

  /** Resolve a canonical tenant and exact active membership, deriving capabilities server-side. */
  async find(userId: string, slug: string): Promise<Workspace | null> {
    const tenant = await this.tenant(slug);
    if (!tenant) return null;
    const [row] = await this.db.query(
      "SELECT id,role,status,lock_version,capabilities_json FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND status='active'",
      [tenant.id, userId],
    );
    if (
      !row ||
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

  /** Return a minimal membership roster only after the route enforces staff:manage. */
  async members(tenantId: string) {
    return this.db.query(
      "SELECT id,user_id AS userId,role,status,lock_version AS version FROM tenant_memberships WHERE tenant_id=? ORDER BY id",
      [tenantId],
    );
  }
}

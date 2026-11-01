import type { Tenant, WebsiteRevision } from "@ra/contracts";

// Adapters must use immutable tenant IDs in every website query. Slugs only
// resolve public addresses; they never grant access to a protected resource.
/** Read-only tenant lookup boundary; returned status must be checked by the caller. */
export interface TenantRepository {
  /** Return an exact slug match or null, without granting access to tenant resources. */
  findBySlug(slug: string): Promise<Tenant | null>;
}
/** Read-only publication boundary whose implementations must scope queries by tenant ID. */
export interface WebsiteRepository {
  /** Return the tenant's latest published revision or null; never return a draft or another tenant. */
  findPublished(tenantId: string): Promise<
    | (WebsiteRevision & {
        publicProfile?: Tenant["profile"] & {
          contactEmail?: string | null;
          contactPhone?: string | null;
        };
      })
    | null
  >;
}

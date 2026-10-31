import { tenantSchema, type Tenant } from "@ra/contracts";
import type { TenantRepository } from "../tenancy/repository";

export const tenants: readonly Tenant[] = [
  {
    id: "a1b87125-42b7-4d6d-8715-78721c436a82",
    slug: "stocksbuddha",
    status: "active",
    synthetic: false,
    profile: {
      name: "Stocks Buddha",
      legalName: "Mayank Singh",
      registration: "INH0000210695",
      monogram: "sb",
    },
  },
  {
    id: "aba574d1-3eea-4547-8295-3bf8d22c6281",
    slug: "alpha",
    status: "active",
    synthetic: true,
    profile: {
      name: "Alpha Research",
      legalName: "Alpha Demo Organization",
      registration: null,
      monogram: "ar",
    },
  },
  {
    id: "dab574d1-3eea-4547-8295-3bf8d22c6282",
    slug: "beta",
    status: "active",
    synthetic: true,
    profile: {
      name: "Beta Research",
      legalName: "Beta Demo Organization",
      registration: null,
      monogram: "br",
    },
  },
].map((tenant) => tenantSchema.parse(tenant));

/** Read-only, schema-validated tenant fixtures with defensive copies at the adapter boundary. */
export class SeedTenantRepository implements TenantRepository {
  private readonly records: readonly Tenant[];
  /**
   * Validate and copy the supplied tenants so callers cannot mutate stored records.
   * @param records - Tenant fixtures; defaults to the bundled preview tenants.
   * @throws {Error} If schema validation fails or tenant IDs/slugs are duplicated.
   */
  constructor(records: readonly Tenant[] = tenants) {
    this.records = records.map((record) =>
      tenantSchema.parse(structuredClone(record)),
    );
    if (
      new Set(this.records.map((r) => r.id)).size !== this.records.length ||
      new Set(this.records.map((r) => r.slug)).size !== this.records.length
    )
      throw new Error("Duplicate tenant identity or slug");
  }
  /**
   * Find an exact slug match without filtering its operational status.
   * @param slug - Canonical public slug; normalization belongs to the caller.
   * @returns A detached tenant record, or null when absent. Callers must check status.
   */
  async findBySlug(slug: string): Promise<Tenant | null> {
    const tenant = this.records.find((record) => record.slug === slug);
    return tenant ? structuredClone(tenant) : null;
  }
}

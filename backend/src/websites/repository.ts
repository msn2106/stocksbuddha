import { websiteRevisionSchema, type WebsiteRevision } from "@ra/contracts";
import type { WebsiteRepository } from "../tenancy/repository";
import { websites } from "./seeds";

/** Read-only, validated website-revision fixtures isolated from caller mutations. */
export class SeedWebsiteRepository implements WebsiteRepository {
  private readonly records: readonly WebsiteRevision[];
  /**
   * Validate and copy revisions while enforcing unique tenant/revision pairs.
   * @param records - Revision fixtures; defaults to the bundled tenant websites.
   * @throws {Error} If schema validation fails or a tenant/revision pair is duplicated.
   */
  constructor(records: readonly WebsiteRevision[] = websites) {
    this.records = records.map((record) =>
      websiteRevisionSchema.parse(structuredClone(record)),
    );
    const keys = this.records.map((r) => `${r.tenantId}:${r.revision}`);
    if (new Set(keys).size !== keys.length)
      throw new Error("Duplicate website revision");
  }
  /**
   * Select the highest numbered published revision belonging to one tenant.
   * @param tenantId - Immutable tenant identity used to scope the lookup.
   * @returns A detached published revision, or null when none exists; drafts stay private.
   */
  async findPublished(tenantId: string): Promise<WebsiteRevision | null> {
    const revision = this.records
      .filter((r) => r.tenantId === tenantId && r.status === "published")
      .sort((a, b) => b.revision - a.revision)[0];
    return revision ? structuredClone(revision) : null;
  }
}

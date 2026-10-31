import type { DataSource } from "typeorm";
import { tenantSchema, websiteRevisionSchema } from "@ra/contracts";
import type {
  TenantRepository,
  WebsiteRepository,
} from "../tenancy/repository";
import {
  digest,
  publicProfileSchema,
  validateSnapshot,
} from "../../../database/snapshots";

/** Resolve canonical tenants from MariaDB while leaving lifecycle authorization to the resolver. */
export class MariaDbTenantRepository implements TenantRepository {
  /** Retain a shared application-owned connection pool. */
  constructor(private readonly db: DataSource) {}
  /** Read exactly one slug using bound parameters and a public-contract projection. */
  async findBySlug(slug: string) {
    const [row] = await this.db.query(
      "SELECT id,slug,status,is_synthetic,display_name,legal_name,registration_number,monogram FROM tenants WHERE slug=?",
      [slug],
    );
    return row
      ? tenantSchema.parse({
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
        })
      : null;
  }
}

/** Read only the explicit tenant publication pointer, never the highest historical revision. */
export class MariaDbWebsiteRepository implements WebsiteRepository {
  /** Retain a shared application-owned connection pool. */
  constructor(private readonly db: DataSource) {}
  /** Verify stored version/checksum and project a complete immutable published snapshot. */
  async findPublished(tenantId: string) {
    const [row] = await this.db.query(
      "SELECT w.* FROM tenants t JOIN website_revisions w ON w.tenant_id=t.id AND w.revision=t.published_revision WHERE t.id=? AND t.status='active' AND w.status='published'",
      [tenantId],
    );
    if (!row) return null;
    const stored =
      typeof row.snapshot_json === "string"
        ? JSON.parse(row.snapshot_json)
        : row.snapshot_json;
    if (digest(stored) !== row.snapshot_sha256)
      throw new Error("Website snapshot integrity check failed");
    const snapshot = validateSnapshot(stored, true);
    const publishedAt = new Date(
      `${row.published_at.replace(" ", "T")}Z`,
    ).toISOString();
    return {
      ...websiteRevisionSchema.parse({
        tenantId: row.tenant_id,
        revision: row.revision,
        status: row.status,
        publishedAt,
        branding: snapshot.branding,
        languages: snapshot.languages,
        layout: snapshot.layout,
        content: snapshot.content,
      }),
      publicProfile: publicProfileSchema.parse(snapshot.publicProfile),
    };
  }
}

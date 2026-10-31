import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { tenants } from "../../backend/src/tenants/tenants";
import { websites } from "../../backend/src/websites/seeds";
import { canonicalJson, digest, snapshotFromFixture } from "../snapshots";

/** Insert missing public-preview fixtures in dev only; reruns never overwrite owner edits or republish an existing tenant. */
export async function seedDemo(db: DataSource, environment: string) {
  if (environment !== "dev")
    throw new Error("Demo seeds are restricted to dev");
  for (const tenant of tenants)
    await db.transaction(async (manager) => {
      const existing = await manager.query(
        "SELECT id FROM tenants WHERE id=? OR slug=? FOR UPDATE",
        [tenant.id, tenant.slug],
      );
      if (existing.length) return;
      await manager.query(
        "INSERT INTO tenants(id,slug,status,is_synthetic,display_name,legal_name,registration_number,monogram,settings_json) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          tenant.id,
          tenant.slug,
          tenant.status,
          Number(tenant.synthetic),
          tenant.profile.name,
          tenant.profile.legalName,
          tenant.profile.registration,
          tenant.profile.monogram,
          canonicalJson({ schemaVersion: 1 }),
        ],
      );
      const website = websites
        .filter(
          (row) => row.tenantId === tenant.id && row.status === "published",
        )
        .sort((a, b) => b.revision - a.revision)[0];
      if (!website) throw new Error("Fixture requires a complete publication");
      const snapshot = snapshotFromFixture(tenant, website);
      await manager.query(
        "INSERT INTO website_revisions(id,tenant_id,revision,base_publication_version,status,snapshot_json,snapshot_sha256,published_at) VALUES (?,?,?,0,'published',?,?,?)",
        [
          randomUUID(),
          tenant.id,
          website.revision,
          canonicalJson(snapshot),
          digest(snapshot),
          website.publishedAt!.replace("T", " ").replace("Z", ""),
        ],
      );
      await manager.query(
        "UPDATE tenants SET published_revision=?,publication_version=1 WHERE id=?",
        [website.revision, tenant.id],
      );
      await manager.query(
        "INSERT INTO audit_events(id,scope,tenant_id,actor_type,action,entity_type,entity_id,metadata_json) VALUES (?,'tenant',?,'system','tenant.preview_seeded','tenant',?,?)",
        [
          randomUUID(),
          tenant.id,
          tenant.id,
          canonicalJson({ schemaVersion: 1, mode: "read-only-preview" }),
        ],
      );
    });
}

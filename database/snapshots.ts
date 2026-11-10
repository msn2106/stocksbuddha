import { createHash } from "node:crypto";
import {
  websiteRevisionSchema,
  websiteSnapshotSchema,
  publicProfileSchema,
  type Snapshot,
  type Tenant,
} from "@ra/contracts";
import { z } from "zod";
import { validateLogo } from "../backend/src/websites/logo";

export { publicProfileSchema, type Snapshot } from "@ra/contracts";
/** Serialize supported JSON with sorted object keys and preserved array order for stable digests. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

/** Hash canonical application JSON, independent of driver JSON formatting. */
export function digest(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Validate a partial draft or complete publication without rewriting persisted snapshot data. */
export function validateSnapshot(input: unknown, publish = false): Snapshot {
  const snapshot = websiteSnapshotSchema.parse(input);
  for (const logo of [
    snapshot.branding.logoLight,
    snapshot.branding.logoDark,
  ]) {
    if (logo) {
      try {
        validateLogo(logo);
      } catch {
        throw new Error("Invalid logo image");
      }
    }
  }
  if (Buffer.byteLength(canonicalJson(snapshot)) > 524288)
    throw new Error("Snapshot exceeds 512 KiB");
  if (!snapshot.languages.enabled.includes(snapshot.languages.default))
    throw new Error("Default language must be enabled");
  if (/<\/?[a-z][^>]*>/i.test(JSON.stringify(snapshot)))
    throw new Error("HTML is not supported in website snapshots");
  if (publish) {
    publicProfileSchema.parse(snapshot.publicProfile);
    websiteRevisionSchema.parse({
      tenantId: "00000000-0000-4000-8000-000000000001",
      revision: 1,
      status: "published",
      publishedAt: "2026-11-01T00:00:00.000Z",
      branding: snapshot.branding,
      languages: snapshot.languages,
      layout: snapshot.layout,
      content: snapshot.content,
    });
  }
  return snapshot;
}

/** Freeze an existing validated fixture with its organization profile for initial persistence. */
export function snapshotFromFixture(
  tenant: Tenant,
  website: z.infer<typeof websiteRevisionSchema>,
) {
  return validateSnapshot(
    {
      schemaVersion: 1,
      publicProfile: tenant.profile,
      branding: website.branding,
      languages: website.languages,
      layout: website.layout,
      content: website.content,
    },
    true,
  );
}

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { migrationClasses } from "./catalog";
import { bootstrapChecksum } from "./metadata";

export type MigrationManifest = {
  release: string;
  bootstrapChecksum: string;
  checksums: Record<string, string>;
};

/** Read a compiled release manifest or derive source checksums for local development only. */
export async function loadManifest(
  production = false,
  readManifest = () =>
    readFile(new URL("./manifest.json", import.meta.url), "utf8"),
  readSources = () => readdir(new URL("./migrations/", import.meta.url)),
): Promise<MigrationManifest> {
  try {
    return JSON.parse(await readManifest());
  } catch (error) {
    if (production || (error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("A valid compiled migration manifest is required", {
        cause: error,
      });
  }
  const files = (await readSources())
    .filter((name) => /^\d{13}-.*\.ts$/.test(name))
    .sort();
  const checksums: Record<string, string> = {};
  for (const file of files) {
    const instance = migrationClasses
      .map((Class) => new Class())
      .find((migration) => migration.name.endsWith(file.slice(0, 13)));
    if (!instance)
      throw new Error("Migration file is not registered in the catalog");
    checksums[instance.name] = createHash("sha256")
      .update(await readFile(new URL(`./migrations/${file}`, import.meta.url)))
      .digest("hex");
  }
  return {
    release: process.env.RELEASE_ID ?? "local-development",
    bootstrapChecksum,
    checksums,
  };
}

import { writeFile } from "node:fs/promises";
import { build } from "tsup";
import { loadManifest } from "./manifest";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Build a standalone migration artifact and its source-checksum manifest together. */
export async function buildDatabase(
  builder = build,
  write = writeFile,
  manifestLoader = loadManifest,
) {
  const manifest = await manifestLoader();
  await builder({
    entry: ["database/cli.ts"],
    format: ["esm"],
    outDir: "database/dist",
    clean: true,
    noExternal: ["@ra/contracts"],
    external: ["typeorm", "mysql2"],
  });
  await write(
    new URL("./dist/manifest.json", import.meta.url),
    JSON.stringify(manifest, null, 2),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildDatabase();

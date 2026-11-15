import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  catalogueDirectory,
  downloadCatalogue,
  importCatalogue,
} from "../backend/src/market/catalogue";

/** Import saved masters or download fixed public sources; production downloads require explicit usage approval. */
export async function main(
  args = process.argv.slice(2),
  env = process.env,
  download = downloadCatalogue,
) {
  const [source, folder, ...extra] = args;
  if (extra.length) throw new Error("Unexpected catalogue arguments");
  if (source === "--local" && folder) {
    const manifest = JSON.parse(
      await readFile(path.join(folder, "download-manifest.json"), "utf8"),
    ) as { file: string; server_last_modified: string | null }[];
    const inputs = await Promise.all(
      ["NSE", "BSE"].map(async (exchange) => ({
        bytes: await readFile(path.join(folder, `${exchange}.json.gz`)),
        modified:
          manifest.find((m) => m.file === `${exchange}.json`)
            ?.server_last_modified ?? null,
      })),
    );
    console.log(
      `Imported ${await importCatalogue(catalogueDirectory(env), inputs)} instruments`,
    );
  } else if (source === "--download" && !folder) {
    if (
      env.NODE_ENV === "production" &&
      env.MARKET_DATA_USAGE_APPROVED !== "true"
    )
      throw new Error(
        "Confirm provider commercial-use permission before production download",
      );
    console.log(
      `Imported ${await download(catalogueDirectory(env))} instruments`,
    );
  } else
    throw new Error(
      "Usage: market-catalogue.ts --local <download-folder> | --download",
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main();

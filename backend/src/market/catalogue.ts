import { readFile, mkdir, writeFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { MarketInstrument, MarketView } from "@ra/contracts";
import { indiaDate } from "./policy";

const rawSchema = z.object({
  instrument_key: z.string().min(1),
  name: z.string(),
  trading_symbol: z.string(),
  exchange: z.enum(["NSE", "BSE"]),
  instrument_type: z.string(),
  underlying_key: z.string().optional(),
  underlying_symbol: z.string().optional(),
  isin: z.string().optional(),
  expiry: z.number().optional(),
  strike_price: z.number().optional(),
  lot_size: z.number().positive(),
  tick_size: z.number().nonnegative(),
});
type Snapshot = {
  importedAt: string;
  sourceModified: string | null;
  hash: string;
  instruments: MarketInstrument[];
};
/** Keep large downloaded reference data outside the source tree and browser bundle. */
export function catalogueDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.MARKET_CATALOGUE_DIR ??
    path.resolve(
      process.cwd(),
      path.basename(process.cwd()) === "backend"
        ? "../.data/instruments"
        : ".data/instruments",
    )
  );
}
/** Parse only supported Indian equity/index/derivative records, reject corrupt or duplicate contracts. */
export function normalizeInstruments(bytes: Buffer): MarketInstrument[] {
  const raw: unknown = JSON.parse(
    gunzipSync(bytes, { maxOutputLength: 200 * 1024 * 1024 }).toString("utf8"),
  );
  if (!Array.isArray(raw) || raw.length > 400000)
    throw new Error("Invalid catalogue");
  const seen = new Set<string>(),
    result: MarketInstrument[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object")
      throw new Error("Invalid instrument");
    if (
      ![
        "NSE_EQ",
        "BSE_EQ",
        "NSE_FO",
        "BSE_FO",
        "NSE_INDEX",
        "BSE_INDEX",
      ].includes(item.segment) ||
      !["EQ", "FUT", "CE", "PE", "INDEX"].includes(item.instrument_type)
    )
      continue;
    const r = rawSchema.parse(
      item.instrument_type === "INDEX"
        ? { ...item, lot_size: 1, tick_size: 0 }
        : item,
    );
    if (seen.has(r.instrument_key)) throw new Error("Duplicate instrument");
    seen.add(r.instrument_key);
    const derivative = ["FUT", "CE", "PE"].includes(r.instrument_type);
    if (
      derivative &&
      (!r.expiry ||
        !r.underlying_key ||
        ((r.instrument_type === "CE" || r.instrument_type === "PE") &&
          !(r.strike_price! > 0)))
    )
      throw new Error("Incomplete contract");
    // Equity ISINs unify NSE/BSE listings; derivative underlying keys use the same ISIN.
    const underlying = derivative ? r.underlying_key! : r.instrument_key;
    const security = underlying.includes("_EQ|")
      ? `ISIN:${underlying.split("|")[1]}`
      : underlying;
    result.push({
      key: r.instrument_key,
      name: r.name,
      symbol: r.trading_symbol,
      exchange: r.exchange,
      type: r.instrument_type as MarketInstrument["type"],
      underlying: security,
      expiry: derivative ? indiaDate(new Date(r.expiry!)) : null,
      strike:
        r.instrument_type === "CE" || r.instrument_type === "PE"
          ? r.strike_price!
          : null,
      lotSize: r.lot_size,
      tickSize: r.tick_size / 100,
    });
  }
  if (!result.length) throw new Error("Empty catalogue");
  return result;
}
/** Atomic catalogue replacement; concurrent readers see either complete validated version. */
export async function importCatalogue(
  directory: string,
  inputs: { bytes: Buffer; modified: string | null }[],
  now = new Date(),
): Promise<number> {
  const instruments = inputs.flatMap((i) => normalizeInstruments(i.bytes));
  if (new Set(instruments.map((i) => i.key)).size !== instruments.length)
    throw new Error("Overlapping catalogue sources");
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, "current.json.gz");
  try {
    const prior: Snapshot = JSON.parse(
      gunzipSync(await readFile(target)).toString(),
    );
    if (instruments.length < prior.instruments.length * 0.5)
      throw new Error("Catalogue count dropped by over half");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const modified = inputs
    .map((i) => i.modified)
    .filter((v): v is string => !!v)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const snapshot: Snapshot = {
    importedAt: now.toISOString(),
    sourceModified: modified.length === inputs.length ? modified[0] : null,
    hash: createHash("sha256")
      .update(Buffer.concat(inputs.map((i) => i.bytes)))
      .digest("hex"),
    instruments,
  };
  const temporary = path.join(directory, `${randomUUID()}.tmp`);
  await writeFile(temporary, gzipSync(JSON.stringify(snapshot)), {
    mode: 0o600,
  });
  await rename(temporary, target);
  return instruments.length;
}
/** Download fixed provider URLs only, bounding response size, redirects and elapsed time. */
export async function downloadCatalogue(directory: string): Promise<number> {
  const inputs = [];
  for (const exchange of ["NSE", "BSE"]) {
    const response = await fetch(
      `https://assets.upstox.com/market-quote/instruments/exchange/${exchange}.json.gz`,
      { signal: AbortSignal.timeout(60000), redirect: "error" },
    );
    if (!response.ok || !response.body)
      throw new Error("Catalogue download failed");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      size += chunk.length;
      if (size > 30 * 1024 * 1024) throw new Error("Catalogue too large");
      chunks.push(chunk);
    }
    inputs.push({
      bytes: Buffer.concat(chunks),
      modified: response.headers.get("last-modified"),
    });
  }
  return importCatalogue(directory, inputs);
}
/** Server-only indexed lookup with bounded client projections and reload after atomic replacement. */
export class InstrumentCatalogue {
  private snapshot: Snapshot | null = null;
  private stamp = 0;
  private index = new Map<string, MarketInstrument>();
  /** Bind lookup to a persistent server-side catalogue directory. */
  constructor(readonly directory: string) {}
  /** Keep the last valid in-memory snapshot on read failure; freshness remains tied to provider time. */
  async load(): Promise<void> {
    try {
      const file = path.join(this.directory, "current.json.gz"),
        info = await stat(file);
      if (this.stamp === info.mtimeMs) return;
      const snapshot: Snapshot = JSON.parse(
        gunzipSync(await readFile(file), {
          maxOutputLength: 200 * 1024 * 1024,
        }).toString(),
      );
      if (!Array.isArray(snapshot.instruments) || !snapshot.instruments.length)
        throw new Error("Invalid catalogue");
      this.index = new Map(snapshot.instruments.map((i) => [i.key, i]));
      this.snapshot = snapshot;
      this.stamp = info.mtimeMs;
    } catch {
      /* No unavailable provider data is substituted or invented. */
    }
  }
  /** Expose timestamps independently: a successful download is not proof of a newly published master. */
  metadata(now = new Date()): MarketView["catalogue"] {
    return this.snapshot
      ? {
          count: this.index.size,
          importedAt: this.snapshot.importedAt,
          sourceModified: this.snapshot.sourceModified,
          stale:
            !this.snapshot.sourceModified ||
            now.getTime() - Date.parse(this.snapshot.sourceModified) >
              72 * 3600000,
        }
      : null;
  }
  /** Resolve immutable contract identity; recommendation snapshots preserve it after expiry. */
  get(key: string) {
    return this.index.get(key);
  }
  /** Limit results and exclude expired contracts for new recommendation selection. */
  search(
    query: string,
    type: string,
    expiry: string,
    now = new Date(),
  ): MarketInstrument[] {
    const q = query.trim().toUpperCase(),
      today = indiaDate(now);
    if (q.length < 2) return [];
    return [...this.index.values()]
      .filter(
        (i) =>
          (!type || i.type === type) &&
          (!expiry || i.expiry === expiry) &&
          (!i.expiry || i.expiry >= today) &&
          (i.symbol.toUpperCase().includes(q) ||
            i.name.toUpperCase().includes(q)),
      )
      .slice(0, 50);
  }
}

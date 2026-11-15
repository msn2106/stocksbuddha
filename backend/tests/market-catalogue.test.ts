import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  catalogueDirectory,
  normalizeInstruments,
  importCatalogue,
  downloadCatalogue,
  InstrumentCatalogue,
} from "../src/market/catalogue";
import { startCatalogueSync } from "../src/market/scheduler";
const eq = {
  segment: "NSE_EQ",
  exchange: "NSE",
  instrument_key: "NSE_EQ|INE1",
  name: "Example Industries",
  trading_symbol: "EXAMPLE",
  instrument_type: "EQ",
  lot_size: 1,
  tick_size: 5,
};
const option = {
  ...eq,
  segment: "NSE_FO",
  instrument_key: "NSE_FO|1",
  underlying_key: eq.instrument_key,
  instrument_type: "CE",
  expiry: Date.parse("2026-11-30"),
  strike_price: 100,
};
const zip = (items: unknown[]) => gzipSync(JSON.stringify(items));
test("instrument normalization validates supported contracts, separates exchanges and rejects incomplete masters", () => {
  assert.equal(
    catalogueDirectory({ MARKET_CATALOGUE_DIR: "/tmp/reference" }),
    "/tmp/reference",
  );
  const cwd = process.cwd();
  try {
    assert.ok(catalogueDirectory({}).endsWith(".data/instruments"));
    process.chdir(path.join(cwd, "backend"));
    assert.equal(catalogueDirectory({}), path.join(cwd, ".data/instruments"));
    catalogueDirectory();
  } finally {
    process.chdir(cwd);
  }
  const index = {
    ...eq,
    segment: "NSE_INDEX",
    instrument_type: "INDEX",
    instrument_key: "NSE_INDEX|Nifty",
    lot_size: undefined,
    tick_size: undefined,
  };
  const result = normalizeInstruments(
    zip([
      eq,
      option,
      { ...option, instrument_key: "NSE_FO|2", instrument_type: "PE" },
      {
        ...option,
        instrument_key: "NSE_FO|3",
        instrument_type: "FUT",
        underlying_key: index.instrument_key,
        strike_price: undefined,
      },
      index,
      { ...eq, segment: "MCX_FO" },
      { ...eq, instrument_type: "BOND" },
    ]),
  );
  assert.equal(result.length, 5);
  assert.equal(result[1].underlying, result[0].underlying);
  assert.equal(result[1].strike, 100);
  assert.equal(result[2].type, "PE");
  assert.equal(result[3].strike, null);
  assert.equal(result[4].lotSize, 1);
  for (const items of [
    [null],
    ["bad"],
    [],
    Array(400001).fill(eq),
    [{ ...option, expiry: undefined }],
    [{ ...option, underlying_key: undefined }],
    [{ ...option, strike_price: 0 }],
    [{ ...option, instrument_type: "PE", strike_price: undefined }],
  ])
    assert.throws(() => normalizeInstruments(zip(items)));
});
test("atomic refresh preserves last valid snapshot, rejects large drops, and reports missing freshness honestly", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "catalogue-validation-"));
  const now = new Date("2026-11-14");
  try {
    const c = new InstrumentCatalogue(dir);
    await c.load();
    assert.equal(c.metadata(), null);
    await assert.rejects(
      importCatalogue(dir, [
        { bytes: zip([eq]), modified: null },
        { bytes: zip([eq]), modified: null },
      ]),
      /Overlapping/,
    );
    await importCatalogue(
      dir,
      [
        {
          bytes: zip([
            eq,
            option,
            {
              ...option,
              instrument_key: "NSE_FO|2",
              expiry: Date.parse("2026-11-01"),
            },
          ]),
          modified: now.toUTCString(),
        },
        {
          bytes: zip([
            {
              ...eq,
              instrument_key: "BSE_EQ|INE1",
              exchange: "BSE",
              segment: "BSE_EQ",
            },
          ]),
          modified: new Date("2026-11-13").toUTCString(),
        },
      ],
      now,
    );
    await c.load();
    assert.equal(
      c.metadata(now)?.sourceModified,
      new Date("2026-11-13").toUTCString(),
    );
    await c.load();
    assert.equal(c.search("EX", "CE", "2026-11-30", now).length, 1);
    assert.equal(c.search("INDUSTRIES", "EQ", "", now).length, 2);
    assert.equal(c.search("none", "", "", now).length, 0);
    assert.equal(c.search("EX", "", "2026-12-01", now).length, 0);
    assert.equal(c.search("EX", "", "", now).length, 3);
    c.search("EX", "", "");
    const old = await readFile(path.join(dir, "current.json.gz"));
    await assert.rejects(
      importCatalogue(dir, [{ bytes: zip([eq]), modified: null }]),
      /dropped/,
    );
    assert.deepEqual(await readFile(path.join(dir, "current.json.gz")), old);
    await writeFile(path.join(dir, "current.json.gz"), zip([]));
    await c.load();
    assert.equal(c.metadata(now)?.count, 4);
    await writeFile(
      path.join(dir, "current.json.gz"),
      gzipSync(JSON.stringify({ instruments: [] })),
    );
    await c.load();
    assert.equal(c.metadata(now)?.count, 4);
    await rm(path.join(dir, "current.json.gz"));
    await importCatalogue(dir, [{ bytes: zip([eq]), modified: null }]);
    await c.load();
    assert.equal(c.metadata()?.stale, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("downloader uses fixed URLs and rejects HTTP, body and size failures before replacing the catalogue", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "catalogue-download-")),
    original = globalThis.fetch;
  try {
    const urls: string[] = [];
    globalThis.fetch = async (url, init) => {
      urls.push(String(url));
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      const exchange = String(url).includes("/BSE.") ? "BSE" : "NSE";
      return new Response(
        zip([
          {
            ...eq,
            exchange,
            segment: `${exchange}_EQ`,
            instrument_key: `${exchange}_EQ|INE1`,
          },
        ]),
        { headers: { "last-modified": new Date().toUTCString() } },
      );
    };
    assert.equal(await downloadCatalogue(dir), 2);
    assert.deepEqual(urls, [
      "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz",
      "https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz",
    ]);
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(downloadCatalogue(dir), /download failed/);
    globalThis.fetch = async () => new Response(null);
    await assert.rejects(downloadCatalogue(dir), /download failed/);
    globalThis.fetch = async () =>
      new Response(new Uint8Array(30 * 1024 * 1024 + 1));
    await assert.rejects(downloadCatalogue(dir), /too large/);
  } finally {
    globalThis.fetch = original;
    await rm(dir, { recursive: true, force: true });
  }
});
test("refresh worker respects opt-in, serializes work, retries errors and awaits outstanding work on shutdown", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0,
    errors = 0;
  let clock = new Date("2026-11-14T00:00:00Z");
  let finish: () => void = () => {};
  const download = async () => {
    calls++;
    if (calls === 1) throw new Error("provider unavailable");
    await new Promise<void>((r) => {
      finish = r;
    });
    return 2;
  };
  await startCatalogueSync(
    "/unused",
    {},
    () => {
      errors++;
    },
    download,
  )();
  await startCatalogueSync(
    "/unused",
    { NODE_ENV: "production", MARKET_SYNC_ENABLED: "true" },
    () => {},
    download,
  )();
  assert.equal(calls, 0);
  const stop = startCatalogueSync(
    "/unused",
    { MARKET_SYNC_ENABLED: "true" },
    () => {
      errors++;
    },
    download,
    () => clock,
  );
  clock = new Date("2026-11-14T01:00:00Z");
  t.mock.timers.tick(60000);
  await new Promise(setImmediate);
  assert.equal(errors, 1);
  t.mock.timers.tick(60000);
  assert.equal(calls, 2);
  t.mock.timers.tick(60000);
  assert.equal(calls, 2);
  finish();
  await new Promise(setImmediate);
  t.mock.timers.tick(60000);
  assert.equal(calls, 2);
  clock = new Date("2026-11-14T03:00:00Z");
  t.mock.timers.tick(60000);
  assert.equal(calls, 3);
  const stopped = stop();
  finish();
  await stopped;
  t.mock.timers.tick(60000);
  assert.equal(calls, 3);
  const permitted = startCatalogueSync(
    "/unused",
    {
      NODE_ENV: "production",
      MARKET_SYNC_ENABLED: "true",
      MARKET_DATA_USAGE_APPROVED: "true",
    },
    () => {},
    async () => {
      calls++;
      return 1;
    },
  );
  await permitted();
});

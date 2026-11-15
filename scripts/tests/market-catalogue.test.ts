import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { main } from "../market-catalogue";
import { InstrumentCatalogue } from "../../backend/src/market/catalogue";
test("catalogue CLI imports saved files, reports missing input and gates only production network access", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "market-cli-"));
  try {
    const output = path.join(dir, "output"),
      env = { MARKET_CATALOGUE_DIR: output };
    for (const exchange of ["NSE", "BSE"])
      await writeFile(
        path.join(dir, `${exchange}.json.gz`),
        gzipSync(
          JSON.stringify([
            {
              segment: `${exchange}_EQ`,
              exchange,
              instrument_key: `${exchange}_EQ|INE1`,
              name: "Example",
              trading_symbol: "EXAMPLE",
              instrument_type: "EQ",
              lot_size: 1,
              tick_size: 5,
            },
          ]),
        ),
      );
    await writeFile(
      path.join(dir, "download-manifest.json"),
      JSON.stringify([
        { file: "NSE.json", server_last_modified: new Date().toUTCString() },
        { file: "BSE.json", server_last_modified: new Date().toUTCString() },
      ]),
    );
    await main(["--local", dir], env);
    const catalogue = new InstrumentCatalogue(output);
    await catalogue.load();
    assert.equal(catalogue.metadata()?.count, 2);
    assert.equal(catalogue.metadata()?.stale, false);
    await writeFile(path.join(dir, "download-manifest.json"), "[]");
    await main(["--local", dir], env);
    await catalogue.load();
    assert.equal(catalogue.metadata()?.stale, true);
    for (const args of [
      [],
      ["--local"],
      ["--download", "extra"],
      ["--unknown"],
      ["--local", dir, "extra"],
    ])
      await assert.rejects(main(args, env));
    await assert.rejects(main(["--local", path.join(dir, "missing")], env));
    let called = 0;
    const download = async (directory: string) => {
      assert.equal(directory, output);
      called++;
      return 2;
    };
    await main(["--download"], env, download);
    await assert.rejects(
      main(["--download"], { ...env, NODE_ENV: "production" }, download),
      /commercial-use/,
    );
    assert.equal(called, 1);
    await main(
      ["--download"],
      { ...env, NODE_ENV: "production", MARKET_DATA_USAGE_APPROVED: "true" },
      download,
    );
    assert.equal(called, 2);
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/market-catalogue.ts", "--local", dir],
      { encoding: "utf8", env: { ...process.env, ...env } },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Imported 2 instruments/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

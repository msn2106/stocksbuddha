import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

test("Hostinger CommonJS entry loads the ESM server and reports import failures", async () => {
  const cwd = path.resolve(import.meta.dirname, ".."),
    dist = path.join(cwd, "dist"),
    entry = path.join(dist, "main.js");
  await mkdir(dist, { recursive: true });
  try {
    await writeFile(
      entry,
      'export async function startServer(){ console.log("Hostinger fixture started"); }',
    );
    const running = spawn(process.execPath, ["hostinger.cjs"], {
      cwd,
      env: process.env,
    });
    let output = "";
    running.stdout.on("data", (chunk) => {
      output += chunk;
    });
    const [successCode] = await once(running, "exit");
    assert.equal(successCode, 0);
    assert.match(output, /Hostinger fixture started/);

    await writeFile(entry, 'throw new Error("fixture import failed");');
    const failed = spawn(process.execPath, ["hostinger.cjs"], {
      cwd,
      env: process.env,
    });
    let error = "";
    failed.stderr.on("data", (chunk) => {
      error += chunk;
    });
    const [failureCode] = await once(failed, "exit");
    assert.equal(failureCode, 1);
    assert.match(error, /StocksBuddha startup failed/);
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

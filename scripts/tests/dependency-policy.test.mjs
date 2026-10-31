import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  rm,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const root = fileURLToPath(new URL("../../", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, npm_config_cache: path.join(cwd, ".cache") },
    });
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, output }));
  });
}

test("policy rejects dependency ranges and weakened release-age settings", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "ra-policy-"));
  try {
    await mkdir(path.join(fixture, "scripts"));
    await copyFile(
      path.join(root, "scripts/check-dependency-policy.mjs"),
      path.join(fixture, "scripts/check-dependency-policy.mjs"),
    );
    await copyFile(path.join(root, ".npmrc"), path.join(fixture, ".npmrc"));
    const pkg = {
      private: true,
      packageManager: "npm@11.19.1",
      dependencies: { example: "1.0.0" },
    };
    await writeFile(path.join(fixture, "package.json"), JSON.stringify(pkg));
    await writeFile(
      path.join(fixture, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages: {} }),
    );
    const args = ["scripts/check-dependency-policy.mjs"];
    assert.equal((await run(process.execPath, args, fixture)).status, 0);
    pkg.dependencies.example = "^1.0.0";
    await writeFile(path.join(fixture, "package.json"), JSON.stringify(pkg));
    const rangeResult = await run(process.execPath, args, fixture);
    assert.notEqual(rangeResult.status, 0);
    assert.match(rangeResult.output, /must use an exact version/);
    pkg.dependencies.example = "1.0.0";
    await writeFile(path.join(fixture, "package.json"), JSON.stringify(pkg));
    const config = await readFile(path.join(root, ".npmrc"), "utf8");
    await writeFile(
      path.join(fixture, ".npmrc"),
      config.replace("min-release-age=7", "min-release-age=0"),
    );
    const ageResult = await run(process.execPath, args, fixture);
    assert.notEqual(ageResult.status, 0);
    assert.match(ageResult.output, /min-release-age must be at least 7/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("npm rejects a new release and accepts a mature release before fetching tarballs", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "ra-release-age-"));
  let tarballRequests = 0;
  const registry = createServer((req, res) => {
    if (req.url.includes(".tgz")) {
      tarballRequests++;
      res.writeHead(500).end();
      return;
    }
    const name = "ra-age-fixture";
    const registryUrl = `http://127.0.0.1:${registry.address().port}`;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        name,
        "dist-tags": { latest: "1.0.1" },
        versions: Object.fromEntries(
          ["1.0.0", "1.0.1"].map((version) => [
            version,
            {
              name,
              version,
              dist: {
                tarball: `${registryUrl}/${name}/-/${name}-${version}.tgz`,
              },
            },
          ]),
        ),
        time: {
          "1.0.0": new Date(Date.now() - 8 * 86400000).toISOString(),
          "1.0.1": new Date(Date.now() - 86400000).toISOString(),
        },
      }),
    );
  });
  try {
    await new Promise((resolve) => registry.listen(0, "127.0.0.1", resolve));
    await writeFile(
      path.join(fixture, "package.json"),
      JSON.stringify({ name: "age-policy-test", private: true }),
    );
    await copyFile(path.join(root, ".npmrc"), path.join(fixture, ".npmrc"));
    const args = [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--fetch-retries=0",
      `--registry=http://127.0.0.1:${registry.address().port}`,
    ];
    const young = await run(npm, [...args, "ra-age-fixture@1.0.1"], fixture);
    assert.notEqual(young.status, 0, young.output);
    assert.match(young.output, /ETARGET|No matching version/);
    const mature = await run(npm, [...args, "ra-age-fixture@1.0.0"], fixture);
    assert.equal(mature.status, 0, mature.output);
    const pkg = JSON.parse(
      await readFile(path.join(fixture, "package.json"), "utf8"),
    );
    assert.equal(pkg.dependencies["ra-age-fixture"], "1.0.0");
    assert.equal(tarballRequests, 0);
  } finally {
    await new Promise((resolve) => registry.close(resolve));
    await rm(fixture, { recursive: true, force: true });
  }
});

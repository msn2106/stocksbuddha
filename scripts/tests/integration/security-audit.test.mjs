import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

test("critical audit rejects critical findings and registry errors while allowing lower severities", async (context) => {
  const manifest = JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  );
  for (const severity of ["none", "high", "critical", "unavailable"]) {
    await context.test(severity, async () => {
      const fixture = await mkdtemp(path.join(tmpdir(), "sb-critical-audit-"));
      const name = `audit-fixture-${severity}`;
      let auditRequests = 0;
      const registry = createServer((req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (severity === "unavailable") {
          res.writeHead(503).end(JSON.stringify({ error: "Fixture outage" }));
          return;
        }
        if (req.url.includes("/security/advisories/bulk")) {
          auditRequests++;
          res.end(
            JSON.stringify(
              severity === "none"
                ? {}
                : {
                    [name]: [
                      {
                        id: severity === "critical" ? 9000001 : 9000002,
                        name,
                        severity,
                        title: "Synthetic audit gate regression fixture",
                        url: "https://example.test/advisory",
                        vulnerable_versions: "<=1.0.0",
                        cwe: ["CWE-400"],
                        cvss: { score: 9.8, vectorString: null },
                      },
                    ],
                  },
            ),
          );
          return;
        }
        res.end(
          JSON.stringify({
            name,
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": { name, version: "1.0.0" } },
          }),
        );
      });
      try {
        await new Promise((resolve) =>
          registry.listen(0, "127.0.0.1", resolve),
        );
        const pkg = {
          name: "critical-audit-test",
          private: true,
          workspaces: ["packages/app"],
          scripts: {
            "security:audit:critical":
              manifest.scripts["security:audit:critical"],
          },
          devDependencies: { [name]: "1.0.0" },
        };
        await writeFile(
          path.join(fixture, "package.json"),
          JSON.stringify(pkg),
        );
        await mkdir(path.join(fixture, "packages/app"), { recursive: true });
        await writeFile(
          path.join(fixture, "packages/app/package.json"),
          JSON.stringify({ name: "audit-workspace", version: "1.0.0" }),
        );
        await writeFile(
          path.join(fixture, "package-lock.json"),
          JSON.stringify({
            name: pkg.name,
            lockfileVersion: 3,
            packages: {
              "": pkg,
              "packages/app": { name: "audit-workspace", version: "1.0.0" },
              "node_modules/audit-workspace": {
                resolved: "packages/app",
                link: true,
              },
              [`node_modules/${name}`]: { version: "1.0.0", dev: true },
            },
          }),
        );
        const result = await new Promise((resolve, reject) => {
          const child = spawn(
            process.platform === "win32" ? "npm.cmd" : "npm",
            [
              "run",
              "security:audit:critical",
              "--",
              "--fetch-retries=0",
              `--registry=http://127.0.0.1:${registry.address().port}`,
            ],
            {
              cwd: fixture,
              env: {
                ...process.env,
                npm_config_cache: path.join(fixture, ".cache"),
              },
            },
          );
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
        if (["critical", "unavailable"].includes(severity))
          assert.notEqual(result.status, 0, result.output);
        else assert.equal(result.status, 0, result.output);
        if (severity !== "unavailable") assert.ok(auditRequests > 0);
        if (["high", "critical"].includes(severity))
          assert.match(
            result.output,
            new RegExp(`1 ${severity} severity vulnerability`),
          );
      } finally {
        await new Promise((resolve) => registry.close(resolve));
        await rm(fixture, { recursive: true, force: true });
      }
    });
  }
});

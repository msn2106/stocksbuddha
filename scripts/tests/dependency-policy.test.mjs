import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkDependencyPolicy } from "../check-dependency-policy.mjs";

test("the actual policy module validates manifests, overrides, package-manager selection and effective config", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sb-policy-unit-"));
  const manifest = {
    private: true,
    packageManager: "npm@11.19.1",
    dependencies: { example: "1.0.0" },
  };
  const config = {
    "min-release-age": 7,
    "save-exact": true,
    "package-lock": true,
    "engine-strict": true,
    audit: true,
  };
  const run = (_command, args) => ({
    status: 0,
    stdout: args[0] === "--version" ? "11.19.1" : JSON.stringify(config),
  });
  try {
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    writeFileSync(path.join(root, "package-lock.json"), "{}");
    assert.deepEqual(checkDependencyPolicy(root, run, {}), []);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        ...manifest,
        packageManager: "pnpm@1.0.0",
        dependencies: { example: "^1.0.0" },
        overrides: { example: { nested: "latest" } },
      }),
    );
    mkdirSync(path.join(root, "child"));
    writeFileSync(path.join(root, "child/package-lock.json"), "{}");
    writeFileSync(path.join(root, "yarn.lock"), "");
    const errors = checkDependencyPolicy(root, run, {
      npm_config_user_agent: "yarn/1",
    });
    for (const message of [
      /exact version/,
      /overrides/,
      /package-lock/,
      /npm@11/,
      /Use npm/,
    ])
      assert.ok(
        errors.some((error) => message.test(error)),
        errors.join("\n"),
      );
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    rmSync(path.join(root, "package-lock.json"));
    assert.ok(
      checkDependencyPolicy(root, run, {}).some((error) =>
        error.includes("required"),
      ),
    );
    for (const version of ["10.9.0", "11.18.9", "11.19.0", "12.0.0", "invalid"])
      assert.ok(
        checkDependencyPolicy(
          root,
          (_cmd, args) =>
            args[0] === "--version"
              ? { status: 0, stdout: version }
              : run(_cmd, args),
          {},
        ).some((error) => error.includes("tested version")),
      );
    assert.ok(
      checkDependencyPolicy(root, () => ({ status: 1 }), {}).some((error) =>
        error.includes("effective npm"),
      ),
    );
    const unsafe = {
      ...config,
      "min-release-age": 0,
      before: "yesterday",
      "min-release-age-exclude": ["*"],
      "save-exact": false,
      "package-lock": false,
      "engine-strict": false,
      audit: false,
    };
    const bad = checkDependencyPolicy(
      root,
      (_cmd, args) => ({
        status: 0,
        stdout: args[0] === "--version" ? "11.20.0" : JSON.stringify(unsafe),
      }),
      {},
    );
    for (const word of [
      "min-release-age",
      "before",
      "exclusions",
      "save-exact",
      "package-lock",
      "engine-strict",
      "audit",
    ])
      assert.ok(
        bad.some((error) => error.includes(word)),
        bad.join("\n"),
      );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { discoverTests, main } from "../run-tests.mjs";
import { runtimeFiles } from "../coverage.mjs";

test("recursive discovery includes nested TSX/spec/module tests and separates integration files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sb-discovery-"));
  try {
    for (const file of [
      "a.test.ts",
      "nested/view.spec.tsx",
      "nested/other.test.mts",
      "integration/http.test.ts",
      "nested/integration/cli.spec.mjs",
      "helper.ts",
      "notes.md",
    ]) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), "");
    }
    assert.deepEqual(
      discoverTests(root, "unit").map((file) => path.relative(root, file)),
      ["a.test.ts", "nested/other.test.mts", "nested/view.spec.tsx"],
    );
    assert.deepEqual(
      discoverTests(root, "integration").map((file) =>
        path.relative(root, file),
      ),
      ["integration/http.test.ts", "nested/integration/cli.spec.mjs"],
    );
    assert.deepEqual(discoverTests(path.join(root, "missing"), "unit"), []);
    assert.equal(
      discoverTests(path.join(root, "integration"), "integration").length,
      1,
    );
    assert.deepEqual(discoverTests(path.join(root, "integration"), "unit"), []);
    assert.throws(() => main(["invalid"]), /Usage/);
    assert.throws(() => main(["unit", "missing"], root), /No unit tests/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("whole-repo coverage inventory includes executable config and module extensions but omits erased types and generated files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sb-inventory-"));
  try {
    for (const [file, source] of Object.entries({
      "backend/src/config.ts": "export const port = 3000;",
      "frontend/src/helper.mts": "export const value = 1;",
      "packages/contracts/src/type.ts": "export type Id = string;",
      "backend/src/task.test.ts": "throw Error();",
      "backend/src/dist/output.js": "throw Error();",
      "scripts/tests/helper.mjs": "throw Error();",
      "scripts/job.mjs": "console.log(1);",
    })) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), source);
    }
    assert.deepEqual(runtimeFiles(root), [
      "backend/src/config.ts",
      "frontend/src/helper.mts",
      "scripts/job.mjs",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

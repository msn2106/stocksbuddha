import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import {
  coverageFailures,
  hasRuntimeCode,
  isRuntimeSource,
  missingJsdoc,
} from "../precommit-policy.mjs";

test("runtime scope includes tooling and application source but excludes tests, declarations and configs", () => {
  for (const file of [
    "frontend/src/App.tsx",
    "backend/src/main.ts",
    "packages/contracts/src/index.ts",
    "scripts/task.mjs",
    "src/task.cjs",
    "backend/src/config.ts",
    "frontend/src/example.mts",
    "backend/src/example.cts",
  ])
    assert.equal(isRuntimeSource(file), true, file);
  for (const file of [
    "docs/a.md",
    "src/a.d.ts",
    "tests/a.ts",
    "src/a.test.ts",
    "src/a.spec.tsx",
    "src/__tests__/a.ts",
    "frontend/vite.config.ts",
    "dist/a.js",
  ])
    assert.equal(isRuntimeSource(file), false, file);
});

test("erased interfaces and type-only exports do not require impossible runtime coverage", () => {
  assert.equal(
    hasRuntimeCode(
      "repository.ts",
      "export interface Repository { read(): string; }",
    ),
    false,
  );
  assert.equal(
    hasRuntimeCode(
      "types.ts",
      'import type { X } from "./x"; export type Y = X;',
    ),
    false,
  );
  assert.equal(
    hasRuntimeCode("empty.mjs", "/** Documentation only. */"),
    false,
  );
  assert.equal(
    hasRuntimeCode("schema.ts", "export const schema = { required: true };"),
    true,
  );
  assert.equal(
    hasRuntimeCode("view.tsx", "export const View = () => <div />;"),
    true,
  );
  assert.equal(
    hasRuntimeCode("side-effect.ts", 'import "./initialize";'),
    true,
  );
});

test("JSDoc covers named functions, arrows, properties, classes, methods and accessors, not callbacks", () => {
  const source = `
function plain() {}
const arrow = () => {};
class Example {
  constructor() {}
  method() {}
  get value() { return 1; }
  set value(v) {}
  field = function () {};
}
const object = { action: () => {} };
[1].map((value) => value + 1);
/** */
function empty() {}
/** @returns {number} */
function tagsOnly() {}
`;
  const failures = missingJsdoc("src/example.ts", source);
  assert.equal(failures.length, 11);
  assert.ok(failures.some((failure) => failure.includes("src/example.ts:2:")));
  assert.deepEqual(
    missingJsdoc(
      "src/documented.ts",
      `
/** Perform work. */
export function work() {}
/** Run a task. */
export const run = () => {};
/** A service. */
class Service {
  /** Create it. */
  constructor() {}
  /** Work. */
  work() {}
  /** Current value. */
  get value() { return 1; }
  /** Update the value. */
  set value(v) {}
  /** A task. */
  field = () => {};
}
const object = { /** Act. */ action: () => {} };
/** Default task. */
export default function () {}
`,
    ),
    [],
  );
});

test("coverage fails closed per file and per metric, rejects exactly 90%, and uses counts without rounding", () => {
  const root = process.cwd();
  const key = path.resolve(root, "src/example.ts");
  const metric = { total: 1000, covered: 901, pct: 90.1 };
  const summary = {
    [key]: Object.fromEntries(
      ["lines", "statements", "functions", "branches"].map((name) => [
        name,
        metric,
      ]),
    ),
  };
  assert.deepEqual(coverageFailures(["src/example.ts"], summary, root), []);
  summary[key].lines = { total: 1000, covered: 900, pct: 90 };
  assert.equal(coverageFailures(["src/example.ts"], summary, root).length, 1);
  summary[key].lines = { total: 100000, covered: 90001, pct: 90 };
  assert.deepEqual(coverageFailures(["src/example.ts"], summary, root), []);
  summary[key].functions = { total: 0, covered: 0, pct: 100 };
  assert.deepEqual(coverageFailures(["src/example.ts"], summary, root), []);
  delete summary[key].branches;
  assert.match(
    coverageFailures(["src/example.ts"], summary, root)[0],
    /missing/,
  );
  assert.match(
    coverageFailures(["src/missing.ts"], summary, root)[0],
    /missing coverage/,
  );
});

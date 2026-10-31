import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { main as precommit } from "../precommit.mjs";
import { main as coverage } from "../coverage.mjs";
import { verify } from "../verify.mjs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

test("verification includes lint and unit coverage and stops on a failing dependency", (context) => {
  context.mock.method(console, "error", () => {});
  const scripts = [];
  assert.equal(
    verify((_cmd, args) => {
      scripts.push(args[1]);
      return { status: 0 };
    }),
    0,
  );
  assert.deepEqual(scripts, [
    "security:check",
    "format:check",
    "lint",
    "test:coverage",
    "test:integration",
    "build",
    "test:e2e",
  ]);
  const failures = [];
  assert.equal(
    verify((_cmd, args) => {
      failures.push(args[1]);
      return { status: args[1] === "lint" ? 2 : 0 };
    }),
    2,
  );
  assert.deepEqual(failures, ["security:check", "format:check", "lint"]);
  assert.equal(
    verify((command) => {
      assert.equal(command, "npm.cmd");
      return { status: 0 };
    }, "win32"),
    0,
  );
  assert.equal(
    verify(() => ({ status: null, error: new Error("Process unavailable") })),
    1,
  );
});

test("precommit and whole-repo coverage enforce fresh per-file unit results with controlled command adapters", async (context) => {
  context.mock.method(console, "log", () => {});
  context.mock.method(console, "error", () => {});
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "sb-orchestration-")),
  );
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const source = path.join(root, "scripts/job.mjs");
  const metric = { total: 100, covered: 100, pct: 100 };
  const commands = [];
  let changed = "scripts/job.mjs\0",
    dirty = "",
    status = 0,
    emitReport = true,
    covered = 100;
  mkdirSync(path.join(root, "scripts"));
  writeFileSync(
    source,
    "/** Double the value. */\nexport function double(value) {\n  return value * 2;\n}\n",
  );
  writeFileSync(
    path.join(root, "eslint.config.mjs"),
    `export { default } from ${JSON.stringify(pathToFileURL(path.join(repo, "eslint.config.mjs")).href)};\n`,
  );
  symlinkSync(
    path.join(repo, "node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  /** Substitute command execution while using real lint, formatting and coverage-policy code. */
  function execute(command, args) {
    commands.push([command, args]);
    if (command === "git")
      return {
        status: 0,
        stdout: args.includes("--cached")
          ? changed
          : args[0] === "diff"
            ? dirty
            : "",
      };
    if (args[0]?.includes("c8.js") && emitReport) {
      const directory = args
        .find((arg) => arg.startsWith("--reports-dir="))
        .slice("--reports-dir=".length);
      mkdirSync(directory, { recursive: true });
      const value = { ...metric, covered, pct: covered };
      writeFileSync(
        path.join(directory, "coverage-summary.json"),
        JSON.stringify({
          [source]: {
            lines: value,
            statements: value,
            functions: value,
            branches: value,
          },
        }),
      );
    }
    return { status };
  }
  try {
    assert.equal(await precommit(root, [], execute), 0);
    assert.ok(commands.some(([, args]) => args.includes("test:unit")));
    assert.equal(process.cwd(), repo.replace(/\/$/, ""));
    changed = "";
    assert.equal(await precommit(root, [], execute), 0);
    changed = "scripts/job.mjs\0";
    assert.equal(await precommit(root, ["--invalid"], execute), 1);
    assert.equal(await precommit(root, ["--fix", "--staged"], execute), 1);
    dirty = "scripts/job.mjs\0";
    assert.equal(await precommit(root, ["--staged"], execute), 1);
    dirty = "";
    assert.equal(await precommit(root, ["--staged"], execute), 0);
    writeFileSync(
      source,
      "export function double(value){ const unused = 1; return value*2}\n",
    );
    assert.equal(await precommit(root, [], execute), 1);
    assert.ok(readFileSync(source, "utf8").includes("value*2"));
    writeFileSync(
      source,
      "/** Double the value. */\nexport function double(value){return value*2}\n",
    );
    assert.equal(await precommit(root, ["--fix"], execute), 0);
    assert.ok(readFileSync(source, "utf8").includes("value * 2"));
    covered = 90;
    assert.equal(await precommit(root, ["--fix"], execute), 1);
    covered = 100;
    emitReport = false;
    assert.equal(await precommit(root, [], execute), 1);
    emitReport = true;
    status = 3;
    assert.equal(await precommit(root, [], execute), 1);
    status = 0;
    assert.equal(
      await precommit(root, [], (command, args) =>
        command === "git"
          ? execute(command, args)
          : { status: null, error: new Error("Process unavailable") },
      ),
      1,
    );
    assert.equal(coverage(root, execute), 0);
    covered = 90;
    assert.equal(coverage(root, execute), 1);
    covered = 100;
    status = 2;
    assert.equal(coverage(root, execute), 2);
    assert.throws(
      () => coverage(path.join(root, "missing"), execute),
      /No executable/,
    );
    await assert.rejects(
      () =>
        precommit(root, [], () => ({ status: 1, stderr: "Git unavailable" })),
      /Git unavailable/,
    );
    await assert.rejects(
      () => precommit(root, [], () => ({ status: 1 })),
      /Git failed/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI entrypoints forward command status with subprocess execution stubbed", async (context) => {
  const argv = process.argv,
    exitCode = process.exitCode;
  context.mock.method(console, "log", () => {});
  context.mock.method(console, "error", () => {});
  context.mock.method(childProcess, "spawnSync", (command) =>
    command === "git" ? { status: 0, stdout: "" } : { status: 2 },
  );
  syncBuiltinESMExports();
  try {
    for (const [file, expected] of [
      ["verify.mjs", 2],
      ["precommit.mjs", 0],
      ["coverage.mjs", 2],
    ]) {
      process.argv = [
        process.execPath,
        fileURLToPath(new URL(`../${file}`, import.meta.url)),
      ];
      await import(`../${file}?unit-cli`);
      assert.equal(process.exitCode, expected);
    }
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

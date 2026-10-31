import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const entry = pathToFileURL(path.join(repo, "scripts/precommit.mjs")).href;

test("gate validates real tests/coverage in an isolated repo, repairs formatting, and protects the index", () => {
  const root = mkdtempSync(path.join(tmpdir(), "stocksbuddha-precommit-"));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "tests"));
  symlinkSync(
    path.join(repo, "node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  writeFileSync(
    path.join(root, "eslint.config.mjs"),
    `export { default } from ${JSON.stringify(pathToFileURL(path.join(repo, "eslint.config.mjs")).href)};\n`,
  );
  writeFileSync(
    path.join(root, ".gitignore"),
    "node_modules/\ncoverage/\nbin/\n",
  );
  // Stub only the package-manager dispatch, while c8, Node's unit-test runner,
  // ESLint, Prettier and Git operate normally in this disposable repository.
  writeFileSync(
    path.join(bin, "npm"),
    `#!${process.execPath}\nconst { spawnSync } = require("node:child_process");\nif (process.argv[2] === "run" && process.env.FIXTURE_TYPECHECK_FAIL) process.exit(3);\nif (process.argv[2] === "run" && process.argv[3] === "test:unit") { const r = spawnSync(process.execPath, ["--test", "tests/calculator.test.mjs"], { stdio: "inherit" }); process.exit(r.status ?? 1); }\n`,
    { mode: 0o755 },
  );
  const source = path.join(root, "src/calculator.mjs");
  const valid =
    "/** Double a number. */\nexport function double(value) {\n  return value * 2;\n}\n";
  writeFileSync(source, valid);
  writeFileSync(
    path.join(root, "tests/calculator.test.mjs"),
    'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { double } from "../src/calculator.mjs";\ntest("doubles", () => assert.equal(double(2), 4));\n',
  );
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  };
  delete env.NODE_TEST_CONTEXT;
  /** Execute fixture Git commands and assert successful setup. */
  function git(...args) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  /** Run the actual gate in a separate process so exit codes and cwd changes remain isolated. */
  function gate(args = [], extraEnv = {}) {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { main } from ${JSON.stringify(entry)}; process.exitCode = await main(${JSON.stringify(root)}, ${JSON.stringify(args)});`,
      ],
      { cwd: root, env: { ...env, ...extraEnv }, encoding: "utf8" },
    );
    return { ...result, output: result.stdout + result.stderr };
  }
  try {
    git("init", "-q");
    // Initial-commit validation: no HEAD exists yet.
    git("add", ".");
    let result = gate(["--staged"]);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Automated pre-commit checks PASSED/);
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-qm",
      "fixture baseline",
    );
    result = gate();
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /No changed files/);
    writeFileSync(
      source,
      "/** Double a number. */\nexport function double(value){return value*2}\n",
    );
    result = gate();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /formatting failed/);
    result = gate(["--fix"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(readFileSync(source, "utf8"), valid);
    assert.equal(git("diff", "--cached", "--name-only"), "");
    writeFileSync(
      source,
      valid +
        "\n/** Uncalled task. */\nexport function uncalled() {\n  return 42;\n}\n",
    );
    result = gate();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /coverage .*must be >90%/);
    result = gate(["--fix"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Automatic fixes completed/);
    writeFileSync(
      source,
      "export function double(value) {\n  const unused = 1;\n  return value * 2;\n}\n",
    );
    result = gate();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Lint failed/);
    assert.match(result.output, /meaningful JSDoc required/);
    writeFileSync(source, valid + "\n// Typecheck fixture.\n");
    result = gate([], { FIXTURE_TYPECHECK_FAIL: "1" });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Type check failed: 3/);
    writeFileSync(
      path.join(root, "tests/calculator.test.mjs"),
      'throw new Error("fixture test failure");\n',
    );
    result = gate();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Unit tests with fresh coverage failed/);
    git("restore", "tests/calculator.test.mjs");
    writeFileSync(source, valid + "\n// A staged change.\n");
    git("add", "src/calculator.mjs");
    writeFileSync(source, valid);
    result = gate(["--staged"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /requires tracked files to match the index/);
    git("add", "src/calculator.mjs");
    writeFileSync(path.join(root, "untracked.mjs"), "export {};\n");
    // Stage a doc change so this cannot take the no-staged-changes early exit.
    writeFileSync(path.join(root, "notes.md"), "# Notes\n");
    git("add", "notes.md");
    result = gate(["--staged"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /requires tracked files to match the index/);
    rmSync(path.join(root, "untracked.mjs"));
    result = gate(["--staged"]);
    assert.equal(result.status, 0, result.output);
    result = gate(["--fix", "--staged"]);
    assert.equal(result.status, 1, result.output);
    result = gate(["--invalid"]);
    assert.equal(result.status, 1, result.output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

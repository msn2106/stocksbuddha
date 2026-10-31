import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  isRuntimeSource,
  hasRuntimeCode,
  coverageFailures,
} from "./precommit-policy.mjs";

/** Collect executable source files, excluding generated output and explicitly identified test/config files. */
export function runtimeFiles(root) {
  const files = [];
  /** Walk source and tooling directories without traversing dependencies or output. */
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (
        [
          "node_modules",
          "dist",
          ".git",
          "coverage",
          "tests",
          "__tests__",
        ].includes(entry.name)
      )
        continue;
      const absolute = path.join(directory, entry.name);
      const file = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) walk(absolute);
      else if (
        isRuntimeSource(file) &&
        hasRuntimeCode(file, readFileSync(absolute, "utf8"))
      )
        files.push(file);
    }
  }
  for (const directory of [
    "frontend/src",
    "backend/src",
    "database",
    "packages",
    "scripts",
  ])
    if (existsSync(path.join(root, directory)))
      walk(path.join(root, directory));
  return files.sort();
}

/** Run fresh whole-repository unit coverage and enforce >90% independently for every executable file and metric. */
export function main(root, execute = spawnSync) {
  const files = runtimeFiles(root);
  if (!files.length)
    throw new Error("No executable source files found for coverage.");
  const report = path.join(root, "coverage/unit");
  const result = execute(
    process.execPath,
    [
      "node_modules/c8/bin/c8.js",
      "--all",
      "--exclude-after-remap",
      "--reporter=json-summary",
      "--reporter=text",
      `--reports-dir=${report}`,
      `--temp-directory=${report}/tmp`,
      ...files.flatMap((file) => ["--include", file]),
      "npm",
      "run",
      "test:unit",
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (result.status !== 0) return result.status ?? 1;
  const errors = coverageFailures(
    files,
    JSON.parse(
      readFileSync(path.join(report, "coverage-summary.json"), "utf8"),
    ),
    root,
  );
  if (errors.length) console.error(errors.join("\n"));
  return errors.length ? 1 : 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = main(fileURLToPath(new URL("../", import.meta.url)));

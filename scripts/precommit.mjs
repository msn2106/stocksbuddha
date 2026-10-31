import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint } from "eslint";
import * as prettier from "prettier";
import {
  coverageFailures,
  hasRuntimeCode,
  isRuntimeSource,
  missingJsdoc,
} from "./precommit-policy.mjs";

/** Run the gate in a repository; the root argument also supports isolated integration tests. */
export async function main(root, args, execute = spawnSync) {
  const originalCwd = process.cwd();
  try {
    root = realpathSync(root);
    process.chdir(root);
    if (args.some((arg) => !["--fix", "--staged"].includes(arg))) {
      console.error("Usage: node scripts/precommit.mjs [--fix] [--staged]");
      return 1;
    }
    const fix = args.includes("--fix");
    const staged = args.includes("--staged");
    if (fix && staged) {
      console.error(
        "Fix working files first, review and stage them, then run --staged. The fixer never stages files.",
      );
      return 1;
    }

    /** Run Git with literal arguments and fail closed on command errors. */
    function git(...args) {
      const result = execute("git", args, { cwd: root, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr || "Git failed");
      return result.stdout;
    }

    /** Convert Git's NUL-separated file list to paths without breaking spaces or newlines. */
    function paths(output) {
      return output.split("\0").filter(Boolean);
    }

    const changes = [
      ...new Set([
        ...paths(
          git(
            "diff",
            "--cached",
            "--name-only",
            "--diff-filter=ACDMRT",
            "-z",
            "--",
          ),
        ),
        ...(staged
          ? []
          : [
              ...paths(
                git("diff", "--name-only", "--diff-filter=ACDMRT", "-z", "--"),
              ),
              ...paths(git("ls-files", "--others", "--exclude-standard", "-z")),
            ]),
      ]),
    ];
    const files = changes.filter((file) => existsSync(path.join(root, file)));
    if (!changes.length) {
      console.log("No changed files to check.");
      return 0;
    }
    if (staged) {
      // Tests/imports/config also influence results: require the entire tracked working
      // tree to match the index, and reject untracked code that could affect imports.
      const dirty = paths(git("diff", "--name-only", "-z"));
      const untracked = paths(
        git("ls-files", "--others", "--exclude-standard", "-z"),
      );
      if (
        dirty.length ||
        untracked.some((file) => /\.(?:[cm]?[jt]sx?|json)$/.test(file))
      ) {
        console.error(
          "Staged check requires tracked files to match the index and no untracked code/config. Review and stage your intended changes first; nothing was staged automatically.",
        );
        return 1;
      }
    }
    const failures = [];
    const code = files.filter((file) => /\.[cm]?[jt]sx?$/.test(file));
    const runtime = code.filter(
      (file) =>
        isRuntimeSource(file) &&
        hasRuntimeCode(file, readFileSync(file, "utf8")),
    );
    console.log(
      `Checking ${files.length} changed files (${runtime.length} executable source files).`,
    );

    if (code.length) {
      const eslint = new ESLint({ cwd: root, fix });
      const results = await eslint.lintFiles(code);
      if (fix) await ESLint.outputFixes(results);
      const output = (await eslint.loadFormatter("stylish")).format(results);
      if (output) console.log(output);
      if (results.some((result) => result.errorCount || result.warningCount))
        failures.push("Lint failed.");
    }
    for (const file of files) {
      const info = await prettier.getFileInfo(file, {
        ignorePath: ".prettierignore",
      });
      if (info.ignored || !info.inferredParser) continue;
      const options = {
        ...(await prettier.resolveConfig(file)),
        filepath: file,
      };
      const source = readFileSync(file, "utf8");
      if (fix) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(file, await prettier.format(source, options));
      } else if (!(await prettier.check(source, options)))
        failures.push(`${file}: formatting failed`);
    }
    for (const file of runtime)
      failures.push(...missingJsdoc(file, readFileSync(file, "utf8")));

    /** Execute a repository check, preserving output and recording failures without skipping later checks. */
    function run(label, command, args) {
      console.log(`\n${label}`);
      const result = execute(command, args, { cwd: root, stdio: "inherit" });
      if (result.status !== 0)
        failures.push(
          `${label} failed: ${result.error?.message ?? result.status}`,
        );
      return result.status === 0;
    }
    run("Type check", "npm", ["run", "typecheck"]);
    const report = path.join(root, "coverage", "precommit");
    // Delete only this gate's generated report so stale results cannot pass.
    rmSync(report, { recursive: true, force: true });
    const passed = run("Unit tests with fresh coverage", process.execPath, [
      "node_modules/c8/bin/c8.js",
      "--all",
      "--exclude-after-remap",
      "--reporter=json-summary",
      "--reporter=text",
      `--reports-dir=${report}`,
      `--temp-directory=${report}/tmp`,
      ...runtime.flatMap((file) => ["--include", file]),
      "npm",
      "run",
      "test:unit",
    ]);
    if (passed && runtime.length) {
      const summaryFile = path.join(report, "coverage-summary.json");
      if (!existsSync(summaryFile)) failures.push("Coverage report missing.");
      else
        failures.push(
          ...coverageFailures(
            runtime,
            JSON.parse(readFileSync(summaryFile, "utf8")),
            root,
          ),
        );
    }
    if (failures.length) {
      console.error(
        `\nPre-commit FAILED:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
      );
      if (fix)
        console.error(
          "Automatic fixes completed. Use $precommit-fix in Codex for test, coverage and JSDoc repairs; then rerun the check.",
        );
      return 1;
    } else
      console.log(
        "\nAutomated pre-commit checks PASSED: lint, formatting, types, unit tests, >90% per-file coverage and JSDoc. README/docs accuracy review is still required through $precommit-check.",
      );
    return 0;
  } finally {
    process.chdir(originalCwd);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(
    fileURLToPath(new URL("../", import.meta.url)),
    process.argv.slice(2),
  );
}

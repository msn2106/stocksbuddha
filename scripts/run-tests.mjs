import { readdirSync, existsSync, readFileSync, globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/** Recursively discover test/spec files, keeping integration directories out of the unit suite. */
export function discoverTests(directory, kind) {
  if (!existsSync(directory)) return [];
  const files = [];
  /** Walk one test directory without following symlinks. */
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (
        entry.isFile() &&
        /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
      ) {
        const integration = file.split(path.sep).includes("integration");
        if ((kind === "integration") === integration) files.push(file);
      }
    }
  }
  walk(directory);
  return files.sort();
}

/** Run explicitly discovered tests in isolated Node processes; fail rather than silently accepting an empty suite. */
export function main(args, cwd = process.cwd()) {
  const [kind, directory] = args;
  if (!["unit", "integration"].includes(kind) || args.length > 2)
    throw new Error("Usage: run-tests.mjs unit|integration [test-directory]");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const workspaces = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ).workspaces;
  const directories = directory
    ? [path.resolve(cwd, directory)]
    : [
        path.join(root, "scripts/tests"),
        ...globSync(workspaces, { cwd: root }).map((workspace) =>
          path.join(root, workspace, "tests"),
        ),
      ];
  const files = directories.flatMap((dir) => discoverTests(dir, kind));
  if (!files.length)
    throw new Error(`No ${kind} tests found in ${directories.join(", ")}`);
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      "--test",
      "--test-timeout=60000",
      ...files,
    ],
    {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: path.join(root, "tsconfig.base.json"),
      },
    },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = main(process.argv.slice(2));

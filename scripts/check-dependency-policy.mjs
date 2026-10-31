import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Validate a repository and its effective npm configuration without changing files.
 * @param root - Repository directory whose manifests and lockfile are checked.
 * @param run - Process runner, injectable for deterministic unit tests.
 * @param env - Environment used to check package-manager selection.
 * @returns Policy violations; an empty list means all checks passed.
 */
export function checkDependencyPolicy(
  root,
  run = spawnSync,
  env = process.env,
) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const errors = [];
  const exactVersion =
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  /** Read a repository-owned JSON file relative to the supplied policy root. */
  const readJson = (file) =>
    JSON.parse(readFileSync(path.join(root, file), "utf8"));
  const manifest = readJson("package.json");

  // Discover package manifests recursively, including future workspaces. Do not
  // inspect installed packages or generated artifacts as repository-owned code.
  /** Inspect repository-owned manifests and lockfile placement recursively. */
  function checkDirectory(directory) {
    const relative = path.relative(root, directory);
    const file = path.join(relative, "package.json");
    if (existsSync(path.join(directory, "package.json"))) {
      const pkg = readJson(file);
      for (const group of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
      ]) {
        for (const [name, version] of Object.entries(pkg[group] ?? {})) {
          if (!exactVersion.test(version))
            errors.push(
              `${file}: ${group}.${name} must use an exact version (received ${version}).`,
            );
        }
      }
      /** Enforce exact versions throughout nested override declarations. */
      function checkOverrides(overrides, prefix = "overrides") {
        for (const [name, value] of Object.entries(overrides ?? {})) {
          if (typeof value === "object" && value !== null)
            checkOverrides(value, `${prefix}.${name}`);
          else if (typeof value !== "string" || !exactVersion.test(value))
            errors.push(
              `${file}: ${prefix}.${name} must use an exact version.`,
            );
        }
      }
      checkOverrides(pkg.overrides);
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (
        [
          "node_modules",
          "dist",
          ".git",
          "test-results",
          "playwright-report",
        ].includes(entry.name)
      )
        continue;
      if (entry.isDirectory()) checkDirectory(path.join(directory, entry.name));
      if (
        [
          "yarn.lock",
          "pnpm-lock.yaml",
          "bun.lock",
          "bun.lockb",
          "npm-shrinkwrap.json",
        ].includes(entry.name)
      )
        errors.push(
          `${path.join(relative, entry.name)}: use the root npm package-lock.json only.`,
        );
      if (entry.name === "package-lock.json" && relative)
        errors.push(
          `${path.join(relative, entry.name)}: use the root npm package-lock.json only.`,
        );
    }
  }
  checkDirectory(root);

  if (manifest.packageManager !== "npm@11.19.1")
    errors.push(
      "packageManager must remain npm@11.19.1; review policy support before changing npm versions.",
    );
  if (!existsSync(path.join(root, "package-lock.json")))
    errors.push("The root package-lock.json is required.");
  if (
    env.npm_config_user_agent &&
    !env.npm_config_user_agent.startsWith("npm/")
  )
    errors.push("Use npm for this repository.");

  const versionResult = run(npm, ["--version"], {
    cwd: root,
    encoding: "utf8",
  });
  const version = versionResult.stdout?.trim();
  const [major, minor, patch] = (version ?? "").split(".").map(Number);
  if (
    versionResult.status !== 0 ||
    major !== 11 ||
    minor < 19 ||
    (minor === 19 && patch < 1)
  )
    errors.push("Use npm >=11.19.1 <12 (the tested version is 11.19.1).");

  // Check inherited environment and repository/user configuration. npm does not
  // export every one-off CLI flag into lifecycle scripts. Never print config
  // output: it may include user settings.
  const configResult = run(npm, ["config", "list", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  if (configResult.status !== 0)
    errors.push("Unable to read effective npm configuration.");
  else {
    const config = JSON.parse(configResult.stdout);
    if (
      typeof config["min-release-age"] !== "number" ||
      config["min-release-age"] < 7
    )
      errors.push("Effective min-release-age must be at least 7 days.");
    if (config.before)
      errors.push(
        "Do not override the relative release-age policy with before.",
      );
    if (config["min-release-age-exclude"]?.length)
      errors.push("Release-age exclusions are not permitted.");
    for (const key of ["save-exact", "package-lock", "engine-strict", "audit"])
      if (config[key] !== true) errors.push(`Effective ${key} must be true.`);
  }

  return errors;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const errors = checkDependencyPolicy(
    fileURLToPath(new URL("../", import.meta.url)),
  );
  if (errors.length) {
    console.error(
      `Dependency policy failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
    process.exitCode = 1;
  } else
    console.log(
      "Dependency policy passed: npm, exact versions, one lockfile, and a seven-day release-age floor.",
    );
}

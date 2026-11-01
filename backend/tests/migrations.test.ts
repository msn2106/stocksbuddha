import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  DataSource,
  MigrationExecutor,
  type Migration,
  type QueryRunner,
} from "typeorm";
import { migrationClasses } from "../../database/catalog";
import { runMigrations } from "../../database/runner";
import { loadManifest } from "../../database/manifest";
import { databaseCommand, databaseCli } from "../../database/cli";
import { buildDatabase } from "../../database/build";
import { seedDemo } from "../../database/seeds/demo";
import { tenants } from "../src/tenants/tenants";

/** Model durable ledger/attempt facts while stubbing TypeORM's public executor boundary. */
function runnerHarness() {
  const state = {
    acquired: 1,
    released: 0,
    ddlDrift: false,
    applied: [] as { name: string }[],
    attempts: [] as {
      migration_name: string;
      migration_checksum: string;
      status: string;
    }[],
    writes: [] as string[],
    fail: false,
  };
  const lock = {
    connect: async () => {},
    release: async () => {
      state.released++;
    },
    query: async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [{ acquired: state.acquired }];
      if (sql.startsWith("SHOW CREATE TABLE"))
        return [
          {
            "Create Table": `CREATE TABLE metadata (id INT)${state.ddlDrift && !sql.includes("reference") ? " drift" : ""}`,
          },
        ];
      if (sql.includes("SELECT name FROM migrations")) return state.applied;
      if (sql.includes("SELECT migration_name")) return state.attempts;
      return [];
    },
  };
  const db = {
    options: { database: "unit" },
    driver: {
      options: {},
      database: "unit",
      buildTableName: (name: string) => name,
    },
    createQueryRunner: () => lock,
    query: async (sql: string) => {
      state.writes.push(sql);
      return [];
    },
  } as unknown as DataSource;
  return { db, state };
}

test("migration runner checks history, holds/relinquishes locks and records failures separately", async (context) => {
  const manifest = await loadManifest();
  const current = runnerHarness();
  context.mock.method(
    MigrationExecutor.prototype,
    "executeMigration",
    async (migration: Migration) => {
      if (current.state.fail) throw new Error("injected SQL failure");
      return migration;
    },
  );
  assert.equal(
    (await runMigrations(current.db, manifest, false)).length,
    migrationClasses.length,
  );
  assert.ok(
    (await runMigrations(current.db, manifest, true)).every(
      (row) => row.applied,
    ),
  );
  assert.equal(
    current.state.writes.filter((sql) => sql.includes("status='succeeded'"))
      .length,
    migrationClasses.length,
  );
  current.state.fail = true;
  await assert.rejects(
    runMigrations(current.db, manifest, true),
    /partial DDL/,
  );
  assert.ok(
    current.state.writes.some((sql) => sql.includes("status='failed'")),
  );
  current.state.fail = false;
  for (const [name, checksum] of Object.entries(manifest.checksums)) {
    current.state.applied.push({ name });
    current.state.attempts.push({
      migration_name: name,
      migration_checksum: checksum,
      status: "succeeded",
    });
  }
  assert.ok(
    (await runMigrations(current.db, manifest, true)).every(
      (row) => row.applied,
    ),
  );
  current.state.attempts[0].status = "running";
  await assert.rejects(
    runMigrations(current.db, manifest, false),
    /reconciliation/,
  );
  current.state.attempts[0].status = "reconciled";
  assert.ok(await runMigrations(current.db, manifest, false));
  current.state.attempts[0].migration_checksum = "wrong";
  await assert.rejects(runMigrations(current.db, manifest, false), /checksum/);
  current.state.attempts = [];
  await assert.rejects(runMigrations(current.db, manifest, false), /untracked/);
  current.state.applied = [];
  current.state.acquired = 0;
  await assert.rejects(
    runMigrations(current.db, manifest, true),
    /lock unavailable/,
  );
  assert.ok(current.state.released > 0);
  current.state.acquired = 1;
  current.state.ddlDrift = true;
  await assert.rejects(
    runMigrations(current.db, manifest, true),
    /schema drift/,
  );
  current.state.ddlDrift = false;
  (current.db.options as { database: string }).database = "x".repeat(100);
  await assert.rejects(runMigrations(current.db, manifest, true), /lock name/);
  await assert.rejects(
    runMigrations(
      current.db,
      {
        release: "",
        bootstrapChecksum: manifest.bootstrapChecksum,
        checksums: {},
      },
      true,
    ),
    /manifest/,
  );
  await assert.rejects(
    runMigrations(current.db, { ...manifest, bootstrapChecksum: "bad" }, true),
    /Invalid release manifest/,
  );
  const invalid = { ...manifest, checksums: { ...manifest.checksums } };
  invalid.checksums[Object.keys(invalid.checksums)[0]] = "bad";
  (current.db.options as { database: string }).database = "unit";
  await assert.rejects(runMigrations(current.db, invalid, true), /checksum/);
  current.state.attempts = [
    {
      migration_name: Object.keys(manifest.checksums)[0],
      migration_checksum: Object.values(manifest.checksums)[0],
      status: "succeeded",
    },
  ];
  await assert.rejects(
    runMigrations(current.db, manifest, true),
    /order\/history/,
  );
});

test("catalog migrations expose ordered immutable DDL and refuse destructive reversal", async () => {
  const names: string[] = [];
  for (const Class of migrationClasses) {
    const migration = new Class();
    names.push(migration.name);
    const sql: string[] = [];
    await migration.up({
      query: async (statement: string) => {
        sql.push(statement);
      },
    } as QueryRunner);
    assert.match(sql[0], /^(CREATE TABLE|ALTER TABLE)/);
    await assert.rejects(migration.down(), /recovery/i);
  }
  assert.equal(new Set(names).size, migrationClasses.length);
});

test("release manifests hash registered source files, require compiled production input and reject unreadable manifests", async () => {
  const manifest = await loadManifest();
  assert.equal(Object.keys(manifest.checksums).length, migrationClasses.length);
  assert.deepEqual(
    await loadManifest(true, async () => JSON.stringify(manifest)),
    manifest,
  );
  await assert.rejects(loadManifest(true), /compiled/);
  await assert.rejects(
    loadManifest(false, async () => {
      throw new Error("access denied");
    }),
    /compiled/,
  );
  await assert.rejects(
    loadManifest(false, undefined, async () => [
      "9999999999999-Unregistered.ts",
    ]),
    /not registered/,
  );
});

test("CLI requires explicit targets, closes pools after failure and prints sanitized outcomes", async () => {
  const env = { DB_ENV: "dev", DB_USER: "test", DB_PASSWORD: "private" };
  let closed = 0,
    fail = false;
  const adapters = {
    createDatabase: (() => ({
      initialize: async () => {},
      destroy: async () => {
        closed++;
      },
    })) as unknown as typeof import("../../database/config").createDatabase,
    loadManifest,
    runMigrations: async () => {
      if (fail) throw new Error("private driver error");
      return [{ name: "migration", applied: true }];
    },
    seedDemo: async () => {},
  };
  for (const args of [
    [],
    ["other", "--target", "dev"],
    ["migrate", "dev"],
    ["migrate", "--target", "unknown"],
    ["migrate", "--target", "prod"],
  ])
    await assert.rejects(databaseCommand(args, env, adapters));
  await assert.rejects(
    databaseCommand(
      ["seed", "--target", "prod"],
      { ...env, DB_ENV: "prod" },
      adapters,
    ),
    /production/,
  );
  assert.deepEqual(
    await databaseCommand(["seed", "--target", "dev"], env, adapters),
    { seeded: true },
  );
  assert.ok(
    await databaseCommand(["status", "--target", "dev"], env, adapters),
  );
  assert.ok(
    await databaseCommand(["migrate", "--target", "dev"], env, adapters),
  );
  fail = true;
  await assert.rejects(
    databaseCommand(["migrate", "--target", "dev"], env, adapters),
    /private driver/,
  );
  assert.equal(closed, 4);
  const messages: string[] = [];
  const output = {
    log: (message: string) => messages.push(message),
    error: (message: string) => messages.push(message),
  } as unknown as Console;
  assert.equal(
    await databaseCli([], async () => ({ seeded: true }), output),
    0,
  );
  assert.equal(
    await databaseCli(
      [],
      async () => {
        throw new Error("sensitive");
      },
      output,
    ),
    1,
  );
  assert.equal(messages.join("").includes("sensitive"), false);
  assert.equal(await databaseCli([], undefined, output), 1);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "database/cli.ts", "invalid"],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /intentionally suppressed/);
});

test("release builder packages the runner and source manifest together", async () => {
  let built = false,
    written = false;
  await buildDatabase(
    (async () => {
      built = true;
    }) as never,
    (async (_file: unknown, content: string) => {
      assert.ok(JSON.parse(content).checksums);
      written = true;
    }) as never,
  );
  assert.ok(built && written);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "database/build.ts"],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("dev seed transactions insert only missing previews and refuse production", async () => {
  let existing = false;
  const writes: string[] = [];
  const manager = {
    query: async (sql: string) => {
      if (sql.startsWith("SELECT")) return existing ? [{ id: "existing" }] : [];
      writes.push(sql);
      return [];
    },
  };
  const db = {
    transaction: async (callback: (m: typeof manager) => unknown) =>
      callback(manager),
  } as unknown as DataSource;
  await seedDemo(db, "dev");
  assert.equal(
    writes.filter((sql) => sql.startsWith("INSERT INTO tenants")).length,
    3,
  );
  existing = true;
  await seedDemo(db, "dev");
  assert.equal(
    writes.filter((sql) => sql.startsWith("INSERT INTO tenants")).length,
    3,
  );
  await assert.rejects(seedDemo(db, "prod"), /restricted/);
  const mutable = tenants as unknown as (typeof tenants)[number][];
  mutable.push({
    ...tenants[0],
    id: "00000000-0000-4000-8000-000000000009",
    slug: "missing-fixture",
  });
  try {
    existing = false;
    await assert.rejects(seedDemo(db, "dev"), /complete publication/);
  } finally {
    mutable.pop();
  }
});

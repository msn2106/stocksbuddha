import { test } from "node:test";
import assert from "node:assert/strict";
import type { DataSource } from "typeorm";
import { bootstrapOwner } from "../src/organisations/bootstrap";

test("operator bootstrap requires a verified existing account and refuses replacing another platform owner", async () => {
  let verified = 0,
    existing: string | null = null;
  const writes: string[] = [];
  const manager = {
    query: async (sql: string) => {
      if (sql.includes("platform_role='owner'"))
        return existing ? [{ id: existing }] : [];
      if (sql.startsWith("SELECT"))
        return [{ id: "person", email_verified: verified }];
      writes.push(sql);
      return [];
    },
  };
  const db = {
    transaction: async (fn: (m: typeof manager) => unknown) => fn(manager),
  } as unknown as DataSource;
  await assert.rejects(bootstrapOwner(db, "person@example.test"), /verified/);
  verified = 1;
  assert.deepEqual(await bootstrapOwner(db, "person@example.test"), {
    userId: "person",
    changed: true,
  });
  assert.ok(writes.some((s) => s.startsWith("INSERT INTO audit_events")));
  existing = "someone-else";
  await assert.rejects(bootstrapOwner(db, "person@example.test"), /already/);
  existing = "person";
  assert.deepEqual(await bootstrapOwner(db, "person@example.test"), {
    userId: "person",
    changed: false,
  });
});

test("bootstrap CLI validates explicit targets, closes its pool and reports sanitized failures", async (context) => {
  const { bootstrapCommand, bootstrapCli } =
    await import("../../database/bootstrap-owner");
  const args = ["--email", "person@example.test", "--target", "dev"];
  await assert.rejects(bootstrapCommand([], {}), /Usage/);
  await assert.rejects(bootstrapCommand(args, { DB_ENV: "prod" }), /Usage/);
  let closed = false;
  const manager = {
    query: async (sql: string) =>
      sql.includes("platform_role='owner'")
        ? []
        : sql.startsWith("SELECT")
          ? [{ id: "person", email_verified: 1 }]
          : [],
  };
  const factory = (() => ({
    initialize: async () => {},
    destroy: async () => {
      closed = true;
    },
    transaction: async (fn: (m: typeof manager) => unknown) => fn(manager),
  })) as never;
  await bootstrapCommand(
    args,
    { DB_ENV: "dev", DB_USER: "test", DB_PASSWORD: "test" },
    factory,
  );
  assert.equal(closed, true);
  const logs: string[] = [];
  const output = {
    log: (value: string) => logs.push(value),
    error: (value: string) => logs.push(value),
  };
  assert.equal(
    await bootstrapCli(
      args,
      async () => ({ userId: "person", changed: true }),
      output,
    ),
    0,
  );
  assert.equal(
    await bootstrapCli(
      args,
      async () => {
        throw new Error("secret driver message");
      },
      output,
    ),
    1,
  );
  assert.equal(
    logs.some((value) => value.includes("secret")),
    false,
  );
  const argv = process.argv,
    exitCode = process.exitCode;
  context.mock.method(console, "error", () => {});
  try {
    process.argv = [
      process.execPath,
      new URL("../../database/bootstrap-owner.ts", import.meta.url).pathname,
    ];
    await import(
      new URL("../../database/bootstrap-owner.ts?cli-test", import.meta.url)
        .href
    );
    assert.equal(process.exitCode, 1);
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
  }
});

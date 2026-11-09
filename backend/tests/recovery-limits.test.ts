import { test } from "node:test";
import assert from "node:assert/strict";
import type { DataSource } from "typeorm";
import { RecoveryEmailLimiter } from "../src/auth/recovery-limits";
import { smsFixture } from "./sms-fixture";

/** Add the additive email ledger to the controlled transactional unit fixture. */
async function fixture() {
  const f = await smsFixture();
  await f.query(
    "CREATE TABLE recovery_email_sends(id TEXT PRIMARY KEY,user_id TEXT,created_at TEXT)",
  );
  return f;
}

test("email reset reservations share one rolling quota across instances, preserve cooldown and reset slots individually", async () => {
  const f = await fixture();
  try {
    const first = new RecoveryEmailLimiter(f.db, () => f.clock.value),
      second = new RecoveryEmailLimiter(f.db, () => f.clock.value);
    const started = f.clock.value.getTime();
    assert.equal(await first.reserve(f.userId), true);
    assert.equal(await second.reserve(f.userId), false);
    f.advance(59999);
    assert.equal(await second.reserve(f.userId), false);
    f.advance(1);
    assert.equal(await second.reserve(f.userId), true);
    for (let i = 0; i < 3; i++) {
      f.advance(60000);
      assert.equal(await first.reserve(f.userId), true);
    }
    f.advance(60000);
    assert.equal(await second.reserve(f.userId), false);
    assert.equal(await second.reserve(f.adminId), true);
    f.clock.value = new Date(started + 86400000 - 1);
    assert.equal(await first.reserve(f.userId), false);
    f.advance(1);
    assert.equal(await first.reserve(f.userId), true);
    f.advance(60000);
    assert.equal(await first.reserve(f.userId), true);
    assert.equal(
      (
        await f.query("SELECT * FROM recovery_email_sends WHERE user_id=?", [
          f.userId,
        ])
      ).length,
      7,
    );
    assert.equal(await first.reserve("unknown"), false);
  } finally {
    f.close();
  }
});

test("email limiter accepts UTC strings and driver Date objects and propagates persistence errors without granting a send", async () => {
  const now = new Date();
  for (const value of [
    now,
    now.toISOString(),
    now.toISOString().replace("T", " ").replace("Z", ""),
  ]) {
    const db = {
      transaction: async (work: (manager: unknown) => Promise<boolean>) =>
        work({
          query: async (sql: string) =>
            sql.includes("auth_users")
              ? [{ id: "user" }]
              : [{ created_at: value }],
        }),
    } as unknown as DataSource;
    assert.equal(
      await new RecoveryEmailLimiter(db, () => now).reserve("user"),
      false,
    );
  }
  const broken = {
    transaction: async () => {
      throw new Error("database unavailable");
    },
  } as unknown as DataSource;
  await assert.rejects(
    new RecoveryEmailLimiter(broken).reserve("user"),
    /database unavailable/,
  );
  const f = await fixture();
  try {
    assert.equal(await new RecoveryEmailLimiter(f.db).reserve(f.userId), true);
  } finally {
    f.close();
  }
});

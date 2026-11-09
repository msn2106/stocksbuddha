import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, databaseConfig } from "../../../database/config";
import { runMigrations } from "../../../database/runner";
import { loadManifest } from "../../../database/manifest";
import { createAuthentication } from "../../src/auth/config";
import { RecoveryEmailLimiter } from "../../src/auth/recovery-limits";

test(
  "MariaDB email recovery: atomic account-wide quota, cooldown, direct API enforcement and rolling expiry",
  { skip: process.env.RUN_DATABASE_TESTS !== "true" },
  async () => {
    const config = databaseConfig(process.env, "dev"),
      admin = createDatabase(config, 3, 0);
    await admin.initialize();
    const name = `sb_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE \`${name}\``);
    const db = createDatabase({ ...config, database: name }, 10, 0);
    await db.initialize();
    let identity: ReturnType<typeof createAuthentication> | undefined;
    try {
      await runMigrations(db, await loadManifest(), true);
      let now = new Date();
      const started = now.getTime();
      const limiter = new RecoveryEmailLimiter(db, () => now);
      const messages: { kind: string; to: string }[] = [];
      let mailFailure = false;
      identity = createAuthentication(
        { ...config, database: name },
        "test-recovery-secret-at-least-thirty-two-characters",
        "http://localhost:3000",
        undefined,
        {
          mailer: async (message) => {
            if (message.kind === "reset" && mailFailure)
              throw new Error("Synthetic SMTP failure");
            messages.push(message);
          },
          reserveRecoveryEmail: limiter.reserve.bind(limiter),
        },
      );
      const email = "recovery-investor@example.test",
        password = "existing-password-123";
      const user = await identity.auth.api.signUpEmail({
        body: { name: "Recovery Investor", email, password },
      });
      await db.query("UPDATE auth_users SET email_verified=1 WHERE id=?", [
        user.user.id,
      ]);
      const send = (index: number, target = email) =>
        identity!.auth.handler(
          new Request("http://localhost:3000/api/auth/request-password-reset", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "http://localhost:3000",
              "x-auth-client-ip": `192.0.2.${index}`,
            },
            body: JSON.stringify({
              email: target,
              redirectTo: `http://localhost:3000/ra/${index % 2 ? "alpha" : "beta"}/reset-password`,
            }),
          }),
        );
      const concurrent = await Promise.all(
        Array.from({ length: 4 }, (_, i) => send(i + 1)),
      );
      assert.ok(concurrent.every((response) => response.status === 200));
      assert.equal(
        messages.filter((message) => message.kind === "reset").length,
        1,
      );
      now = new Date(started + 59999);
      assert.equal((await send(8)).status, 200);
      assert.equal(
        messages.filter((message) => message.kind === "reset").length,
        1,
      );
      for (let i = 1; i < 4; i++) {
        now = new Date(started + i * 60000);
        assert.equal((await send(i + 10)).status, 200);
      }
      now = new Date(started + 4 * 60000);
      const finalSlot = await Promise.all(
        Array.from({ length: 4 }, (_, i) => send(i + 40)),
      );
      assert.ok(finalSlot.every((response) => response.status === 200));
      assert.equal(
        messages.filter((message) => message.kind === "reset").length,
        5,
      );
      now = new Date(started + 5 * 60000);
      const denied = await send(20);
      assert.equal(denied.status, 200);
      const unknown = await send(21, "unknown@example.test");
      assert.equal(unknown.status, 200);
      assert.deepEqual(await denied.json(), await unknown.json());
      assert.equal(
        messages.filter((message) => message.kind === "reset").length,
        5,
      );
      assert.ok(
        (await identity.auth.api.signInEmail({ body: { email, password } }))
          .token,
      );
      now = new Date(started + 86400000);
      assert.equal((await send(22)).status, 200);
      assert.equal(
        messages.filter((message) => message.kind === "reset").length,
        6,
      );
      const failedUser = await identity.auth.api.signUpEmail({
        body: {
          name: "Other Investor",
          email: "failed@example.test",
          password,
        },
      });
      mailFailure = true;
      const failedDelivery = await identity.auth.api.requestPasswordReset({
        body: { email: "failed@example.test" },
      });
      assert.equal(failedDelivery.status, true); // The native boundary intentionally keeps delivery failures generic.

      assert.equal(
        (
          await db.query(
            "SELECT id FROM recovery_email_sends WHERE user_id=?",
            [failedUser.user.id],
          )
        ).length,
        1,
      );
      assert.equal((await send(23, "failed@example.test")).status, 200);
      assert.equal(
        (
          await db.query(
            "SELECT id FROM recovery_email_sends WHERE user_id=?",
            [failedUser.user.id],
          )
        ).length,
        1,
      );
    } finally {
      await identity?.close();
      await db.destroy();
      await admin.query(`DROP DATABASE \`${name}\``);
      await admin.destroy();
    }
  },
);

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, databaseConfig } from "../../../database/config";
import { runMigrations } from "../../../database/runner";
import { loadManifest } from "../../../database/manifest";
import { seedDemo } from "../../../database/seeds/demo";
import { tenants } from "../../src/tenants/tenants";
import { createAuthentication } from "../../src/auth/config";
import { SmsService } from "../../src/sms/service";
import type { SmsMessage } from "../../src/sms/horizon";
import { requireVerifiedMobile } from "../../src/sms/kyc";
import { IntegrationSettingsService } from "../../src/integrations/service";

test(
  "MariaDB SMS: atomic quotas, single-use proof, dedicated recovery transport and Better Auth compatible password reset",
  { skip: process.env.RUN_DATABASE_TESTS !== "true" },
  async () => {
    const config = databaseConfig(process.env, "dev"),
      admin = createDatabase(config, 3, 0);
    await admin.initialize();
    const name = `sb_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE \`${name}\``);
    const db = createDatabase({ ...config, database: name }, 10, 0);
    await db.initialize();
    let auth: ReturnType<typeof createAuthentication> | undefined;
    try {
      await runMigrations(db, await loadManifest(), true);
      await seedDemo(db, "dev");
      auth = createAuthentication(
        { ...config, database: name },
        "test-sms-secret-at-least-thirty-two-characters",
        "http://localhost:3000",
      );
      const identities = [];
      for (const [email, role] of [
        ["sms-owner@example.test", "owner"],
        ["sms-investor@example.test", "subscriber"],
      ]) {
        const result = await auth.auth.api.signUpEmail({
          body: { name: "SMS Test", email, password: "initial-password-123" },
        });
        await db.query("UPDATE auth_users SET email_verified=1 WHERE id=?", [
          result.user.id,
        ]);
        const id = randomUUID();
        await db.query(
          "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,status,profile_json,capabilities_json) VALUES (?,?,?,?,'active','{\"schemaVersion\":1}','{}')",
          [id, tenants[0].id, result.user.id, role],
        );
        identities.push({
          context: { token: result.token!, tenantId: tenants[0].id },
          userId: result.user.id,
          memberId: id,
        });
      }
      const [owner, investor] = identities,
        sent: SmsMessage[] = [],
        notices: string[] = [];
      let now = new Date();
      const env = {
        ONBOARDING_DATA_KEY: "a".repeat(64),
        SMS_MODE: "trial",
        SMS_RECOVERY_SETTINGS_JSON: JSON.stringify({
          username: "platform",
          apiKey: "platform-secret",
          senderId: "HORIZN",
          entityId: "110100000000001",
          encoding: "txt",
          template: {
            id: "110100000000003",
            text: "Recover password with {{otp}}, valid {{expiryMinutes}} minutes.",
          },
        }),
      };
      const sms = new SmsService(
        db,
        env,
        async (message) => {
          sent.push(message);
          return { messageId: "123456", balance: "50" };
        },
        () => now,
        async (email) => {
          notices.push(email);
        },
      );
      await sms.saveSettings(owner.context, {
        version: 0,
        enabled: true,
        username: "ra",
        apiKey: "private-api-key",
        senderId: "HORIZN",
        entityId: "110100000000001",
        encoding: "txt",
        verification: {
          id: "110100000000002",
          text: "Mobile verification code {{otp}}, valid {{expiryMinutes}} minutes.",
        },
      });
      const settings = await sms.settings(owner.context);
      await sms.saveSettings(owner.context, {
        version: 1,
        enabled: true,
        username: "ra",
        senderId: "HORIZN",
        entityId: "110100000000001",
        encoding: "txt",
        verification: {
          id: settings.templates[0].id,
          text: settings.templates[0].text,
        },
        // Full Unicode libraries exceed the previous TEXT ciphertext capacity.
        templates: [
          ...settings.templates,
          ...Array.from({ length: 98 }, (_, index) => ({
            key: `custom-${index}`,
            name: `Reminder ${index}`,
            id: "",
            text: "क".repeat(441),
          })),
        ],
      });
      assert.equal((await sms.settings(owner.context)).templates.length, 100);
      const [cipher] = await db.query("SELECT config_cipher FROM sms_settings");
      assert.ok(cipher.config_cipher.length > 65535);
      const integrations = new IntegrationSettingsService(db, env);
      await assert.rejects(
        integrations.read(investor.context, "telegram"),
        /forbidden/,
      );
      const telegram = {
        version: 0,
        botToken: "123456789:private-test-token",
        chatId: "@research_channel",
        inviteLink: "https://t.me/+testInvite",
      };
      const saves = await Promise.allSettled([
        integrations.save(owner.context, "telegram", telegram),
        integrations.save(owner.context, "telegram", telegram),
      ]);
      assert.equal(
        saves.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const saved = await integrations.read(owner.context, "telegram");
      assert.equal(saved.version, 1);
      assert.equal(saved.configured, true);
      assert.equal("botToken" in saved, false);
      const [privateRow] = await db.query(
        "SELECT config_cipher FROM tenant_integrations",
      );
      assert.equal(privateRow.config_cipher.includes(telegram.botToken), false);
      assert.equal((await sms.mobile(investor.context)).verified, false);
      await assert.rejects(
        requireVerifiedMobile(
          db.manager,
          tenants[0].id,
          investor.memberId,
          "9599400141",
        ),
        /mobile_verification_required/,
      );
      const send = () =>
        sms.send({
          context: investor.context,
          mobile: "9599400141",
          key: randomUUID(),
          ip: "127.0.0.1",
        });
      const requests = await Promise.allSettled([send(), send()]);
      assert.equal(
        requests.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(sent.length, 1);
      const challenge = (
        requests.find(
          (result) => result.status === "fulfilled",
        ) as PromiseFulfilledResult<Awaited<ReturnType<typeof send>>>
      ).value;
      const code = sent.at(-1)!.message.match(/\b\d{6}\b/)![0];
      const verify = () =>
        sms.verify({
          context: investor.context,
          challengeId: challenge.challengeId,
          code,
          ip: "127.0.0.1",
        });
      const proofs = await Promise.allSettled([verify(), verify()]);
      assert.equal(
        proofs.filter((result) => result.status === "fulfilled").length,
        1,
      );
      await requireVerifiedMobile(
        db.manager,
        tenants[0].id,
        investor.memberId,
        "+919599400141",
      );
      await sms.recoveryContact(investor.context, "initial-password-123", true);
      const recovery = await sms.send({
        slug: tenants[0].slug,
        email: "sms-investor@example.test",
        key: randomUUID(),
        ip: "127.0.0.1",
      });
      assert.equal(sent.at(-1)!.username, "platform");
      assert.ok(
        !JSON.stringify(await sms.records(owner.context)).includes(
          "Recover password",
        ),
      );
      const recoveryCode = sent.at(-1)!.message.match(/\b\d{6}\b/)![0];
      const staffId = randomUUID();
      await db.query(
        "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,status,profile_json,capabilities_json) VALUES (?,?,?,'support','active','{\"schemaVersion\":1}','{}')",
        [staffId, tenants[1].id, investor.userId],
      );
      await assert.rejects(
        sms.verify({
          slug: tenants[0].slug,
          challengeId: recovery.challengeId,
          code: recoveryCode,
          ip: "127.0.0.1",
          newPassword: "new-password-456",
        }),
        /invalid_or_expired/,
      );
      await db.query("DELETE FROM tenant_memberships WHERE id=?", [staffId]);
      await sms.verify({
        slug: tenants[0].slug,
        challengeId: recovery.challengeId,
        code: recoveryCode,
        ip: "127.0.0.1",
        newPassword: "new-password-456",
      });
      assert.equal(
        (
          await db.query("SELECT id FROM auth_sessions WHERE user_id=?", [
            investor.userId,
          ])
        ).length,
        0,
      );
      await assert.rejects(
        auth.auth.api.signInEmail({
          body: {
            email: "sms-investor@example.test",
            password: "initial-password-123",
          },
        }),
      );
      const login = await auth.auth.api.signInEmail({
        body: {
          email: "sms-investor@example.test",
          password: "new-password-456",
        },
      });
      assert.ok(login.token);
      await sms.deliverNotice();
      await sms.deliverNotice();
      assert.equal(notices.length, 2);
      const active = { ...investor.context, token: login.token };
      now = new Date(now.getTime() + 60001);
      const wrongFlow = await sms.send({
        context: active,
        mobile: "9599400141",
        key: randomUUID(),
        ip: "127.0.0.1",
      });
      const correct = sent.at(-1)!.message.match(/\b\d{6}\b/)![0],
        wrong = correct === "100000" ? "999999" : "100000";
      await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          sms.verify({
            context: active,
            challengeId: wrongFlow.challengeId,
            code: wrong,
            ip: "127.0.0.1",
          }),
        ),
      );
      assert.equal(
        (
          await db.query("SELECT attempts FROM sms_challenges WHERE id=?", [
            wrongFlow.challengeId,
          ])
        )[0].attempts,
        5,
      );
      await assert.rejects(
        sms.verify({
          context: active,
          challengeId: wrongFlow.challengeId,
          code: correct,
          ip: "127.0.0.1",
        }),
        /invalid_or_expired/,
      );
      // A real Better Auth email-reset credential change invalidates an already issued SMS proof.
      now = new Date(now.getTime() + 60001);
      const stale = await sms.send({
        slug: tenants[0].slug,
        email: "sms-investor@example.test",
        key: randomUUID(),
        ip: "127.0.0.1",
      });
      const staleCode = sent.at(-1)!.message.match(/\b\d{6}\b/)![0];
      const emailToken = randomUUID();
      await db.query(
        "INSERT INTO auth_verifications(id,identifier,value,expires_at) VALUES (?,?,?,?)",
        [
          randomUUID(),
          `reset-password:${emailToken}`,
          investor.userId,
          new Date(Date.now() + 300000),
        ],
      );
      await auth.auth.api.resetPassword({
        body: { token: emailToken, newPassword: "email-reset-password-789" },
      });
      await assert.rejects(
        sms.verify({
          slug: tenants[0].slug,
          challengeId: stale.challengeId,
          code: staleCode,
          ip: "127.0.0.1",
          newPassword: "must-not-replace-password",
        }),
        /invalid_or_expired/,
      );
      // Recovery sends remain capped across RAs even after flow and hourly safety windows expire.
      await db.query("UPDATE tenants SET status='active' WHERE id=?", [
        tenants[1].id,
      ]);
      await db.query(
        "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,status,profile_json,capabilities_json) VALUES (?,?,?,'subscriber','active','{\"schemaVersion\":1}','{}')",
        [randomUUID(), tenants[1].id, investor.userId],
      );
      now = new Date(now.getTime() + 61 * 60000);
      const sentBefore = sent.length;
      await sms.send({
        slug: tenants[0].slug,
        email: "sms-investor@example.test",
        key: randomUUID(),
        ip: "192.0.2.100",
      });
      assert.equal(sent.length, sentBefore + 1);
      now = new Date(now.getTime() + 60000);
      const blocked = await sms.send({
        slug: tenants[1].slug,
        email: "sms-investor@example.test",
        key: randomUUID(),
        ip: "192.0.2.101",
      });
      assert.equal(blocked.sendsRemaining, 0);
      assert.equal(sent.length, sentBefore + 1);
    } finally {
      await auth?.close();
      await db.destroy();
      await admin.query(`DROP DATABASE \`${name}\``);
      await admin.destroy();
    }
  },
);

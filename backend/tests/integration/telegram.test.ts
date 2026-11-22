import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, databaseConfig } from "../../../database/config";
import { runMigrations } from "../../../database/runner";
import { loadManifest } from "../../../database/manifest";
import { seedDemo } from "../../../database/seeds/demo";
import { tenants } from "../../src/tenants/tenants";
import { TelegramService } from "../../src/telegram/service";
import { IntegrationSettingsService } from "../../src/integrations/service";
import { seal, unseal } from "../../src/onboarding/domain";

test(
  "MariaDB Telegram: concurrent invites, contact consumption, queue deduplication and worker claims",
  { skip: process.env.RUN_DATABASE_TESTS !== "true" },
  async () => {
    const config = databaseConfig(process.env, "dev"),
      admin = createDatabase(config, 3, 0);
    await admin.initialize();
    const name = `sb_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE \`${name}\``);
    const db = createDatabase({ ...config, database: name }, 10, 0);
    await db.initialize();
    try {
      await runMigrations(db, await loadManifest(), true);
      await seedDemo(db, "dev");
      const tenantId = tenants[0].id,
        ids = [];
      for (const role of ["owner", "subscriber"]) {
        const user = randomUUID(),
          member = randomUUID(),
          token = randomUUID();
        await db.query(
          "INSERT INTO auth_users(id,name,email,email_verified) VALUES (?,'Telegram Test',?,1)",
          [user, `${role}@telegram.example.test`],
        );
        await db.query(
          "INSERT INTO auth_sessions(id,user_id,token,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))",
          [randomUUID(), user, token],
        );
        await db.query(
          "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,status,profile_json,capabilities_json,mobile,mobile_verified_at) VALUES (?,?,?,?,'active','{\"schemaVersion\":1}','{}','9876543210',UTC_TIMESTAMP(3))",
          [member, tenantId, user, role],
        );
        ids.push({ token, tenantId, member });
      }
      const [owner, investor] = ids;
      const env = {
        ONBOARDING_DATA_KEY: "a".repeat(64),
        AUTH_BASE_URL: "https://site.example.test",
      };
      const settings = new IntegrationSettingsService(db, env);
      const sends: Record<string, unknown>[] = [];
      const telegram = new TelegramService(
        db,
        env,
        async (_token, method, body = {}) => {
          if (method === "getMe")
            return { id: 123456, is_bot: true, username: "example_ra_bot" };
          if (body.protect_content) sends.push(body);
          return {};
        },
      );
      await settings.save(owner, "telegram", {
        version: 0,
        botToken: "123456:synthetic",
      });
      await telegram.connect(owner);
      const invites = await Promise.all([
        telegram.invite(investor),
        telegram.invite(investor),
      ]);
      assert.equal(
        (await db.query("SELECT * FROM telegram_invites")).length,
        1,
      );
      const bot = (
        await db.query("SELECT secret_cipher FROM telegram_bots")
      )[0];
      const secret = unseal<string>(env.ONBOARDING_DATA_KEY, bot.secret_cipher);
      let n = 0;
      const update = (body: Record<string, unknown>) => ({
        update_id: ++n,
        message: {
          from: { id: 101, is_bot: false },
          chat: { id: 101, type: "private" },
          ...body,
        },
      });
      for (const invite of invites)
        await telegram.webhook(
          tenantId,
          secret,
          update({
            text: `/start ${new URL(invite.url).searchParams.get("start")}`,
          }),
        );
      const contact = update({
        contact: { user_id: 101, phone_number: "919876543210" },
      });
      await Promise.all([
        telegram.webhook(tenantId, secret, contact),
        telegram.webhook(tenantId, secret, contact),
      ]);
      assert.equal((await db.query("SELECT * FROM telegram_links")).length, 1);
      assert.equal(
        (await db.query("SELECT * FROM telegram_invites")).length,
        0,
      );
      const id = randomUUID(),
        revisionId = randomUUID();
      await db.query(
        "INSERT INTO research_items(id,tenant_id,version,status,draft_cipher,created_at,updated_at) VALUES (?,?,1,'active',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [id, tenantId, seal(env.ONBOARDING_DATA_KEY, {})],
      );
      await db.query(
        "INSERT INTO research_revisions(id,tenant_id,recommendation_id,version,snapshot_cipher,created_at) VALUES (?,?,?,1,?,UTC_TIMESTAMP(3))",
        [
          revisionId,
          tenantId,
          id,
          seal(env.ONBOARDING_DATA_KEY, {
            title: "Example research",
            issuer: { name: "RA", registration: "INH" },
            status: "active",
            version: 1,
            legs: [],
            instruments: [],
          }),
        ],
      );
      await db.query(
        "INSERT INTO research_recipients(tenant_id,recommendation_id,membership_id,granted_at) VALUES (?,?,?,UTC_TIMESTAMP(3))",
        [tenantId, id, investor.member],
      );
      await db.query(
        "UPDATE research_items SET latest_revision_id=? WHERE id=?",
        [revisionId, id],
      );
      const queue = () =>
        db.transaction(async (m) => {
          await m.query("SELECT id FROM tenants WHERE id=? FOR UPDATE", [
            tenantId,
          ]);
          await telegram.enqueue(m, tenantId, revisionId, [investor.member]);
        });
      await Promise.all([queue(), queue()]);
      assert.equal(
        (await db.query("SELECT * FROM telegram_deliveries")).length,
        1,
      );
      await Promise.all([telegram.deliverOne(), telegram.deliverOne()]);
      assert.equal(sends.length, 1);
      assert.equal(
        (await db.query("SELECT status FROM telegram_deliveries"))[0].status,
        "delivered",
      );
      await assert.rejects(
        db.query(
          "INSERT INTO telegram_bots(tenant_id,bot_id,username,token_hash,secret_cipher) VALUES (?,123456,'duplicate',?,?)",
          [tenants[1].id, "a".repeat(64), "cipher"],
        ),
      );
    } finally {
      await db.destroy();
      await admin.query(`DROP DATABASE \`${name}\``);
      await admin.destroy();
    }
  },
);

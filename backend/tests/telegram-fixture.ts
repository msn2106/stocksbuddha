import { randomUUID } from "node:crypto";
import { researchFixture } from "./research-fixture";
import { TelegramService } from "../src/telegram/service";
import { ResearchService } from "../src/research/service";
import { IntegrationSettingsService } from "../src/integrations/service";
import type { TelegramApi } from "../src/telegram/api";
import { unseal } from "../src/onboarding/domain";

/** Exercise actual SQL and encryption with a fake Telegram boundary and a controlled clock. */
export async function telegramFixture() {
  const f = await researchFixture();
  const definitions = {
    tenant_integrations:
      "tenant_id TEXT,kind TEXT,config_cipher TEXT,version INTEGER,PRIMARY KEY(tenant_id,kind)",
    telegram_bots:
      "tenant_id TEXT PRIMARY KEY,bot_id TEXT UNIQUE,username TEXT,token_hash TEXT,secret_cipher TEXT",
    telegram_links:
      "tenant_id TEXT,membership_id TEXT,bot_id TEXT,telegram_user_id TEXT,contact_cipher TEXT,mobile_hash TEXT,linked_at TEXT,PRIMARY KEY(tenant_id,membership_id),UNIQUE(tenant_id,telegram_user_id)",
    telegram_invites:
      "tenant_id TEXT,membership_id TEXT,token_hash TEXT UNIQUE,telegram_user_id TEXT,expires_at TEXT,PRIMARY KEY(tenant_id,membership_id)",
    telegram_updates:
      "tenant_id TEXT,update_id INTEGER,received_at TEXT,PRIMARY KEY(tenant_id,update_id)",
    telegram_deliveries:
      "id TEXT PRIMARY KEY,tenant_id TEXT,revision_id TEXT,membership_id TEXT,bot_id TEXT,status TEXT,attempts INTEGER DEFAULT 0,available_at TEXT,lease_until TEXT,UNIQUE(tenant_id,revision_id,membership_id)",
  };
  for (const [table, fields] of Object.entries(definitions))
    f.memory.exec(`CREATE TABLE ${table} (${fields})`);
  const env = { ...f.env, AUTH_BASE_URL: "https://site.example.test" };
  let clock = new Date("2026-11-17T06:00:00Z"),
    botId = 123456789;
  let failure: Error | undefined;
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const api: TelegramApi = async (_token, method, body = {}) => {
    calls.push({ method, body });
    if (failure) throw failure;
    return method === "getMe"
      ? { id: botId, is_bot: true, username: "example_ra_bot" }
      : { message_id: 100 };
  };
  const telegram = new TelegramService(f.db, env, api, () => clock);
  const integrations = new IntegrationSettingsService(f.db, env);
  const research = new ResearchService(
    f.db,
    f.catalogue,
    env,
    f.drive,
    () => clock,
    telegram,
  );
  await integrations.save(f.admin, "telegram", {
    version: 0,
    botToken: "123456789:synthetic_token",
  });
  let updateId = 1;
  const secret = async () =>
    unseal<string>(
      env.ONBOARDING_DATA_KEY!,
      String(
        (
          await f.query(
            "SELECT secret_cipher FROM telegram_bots WHERE tenant_id=?",
            [f.tenantId],
          )
        )[0].secret_cipher,
      ),
    );
  const message = async (
    user: number,
    value: Record<string, unknown>,
    id = updateId++,
  ) =>
    telegram.webhook(f.tenantId, await secret(), {
      update_id: id,
      message: {
        from: { id: user, is_bot: false },
        chat: { id: user, type: "private" },
        ...value,
      },
    });
  const link = async (user = 101, c = f.investor) => {
    const invite = await telegram.invite(c);
    await message(user, {
      text: `/start ${new URL(invite.url).searchParams.get("start")}`,
    });
    await message(user, {
      contact: { user_id: user, phone_number: "919876543210" },
    });
    return invite;
  };
  const publish = async (sendTelegram = true) => {
    const id = randomUUID();
    await research.save(f.admin, { id, version: 0, draft: f.draft });
    const preview = await research.preview(f.admin, id);
    await research.publish(f.admin, id, {
      version: 1,
      token: preview.token,
      confirmed: true,
      reason: "",
      sendTelegram,
    });
    return id;
  };
  return {
    ...f,
    env,
    telegram,
    research,
    integrations,
    calls,
    secret,
    message,
    link,
    publish,
    fail: (error?: Error) => {
      failure = error;
    },
    setBot: (id: number) => {
      botId = id;
    },
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

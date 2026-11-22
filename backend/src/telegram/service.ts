import { randomBytes, randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import { z } from "zod";
import type { ResearchSnapshot } from "@ra/contracts";
import { requireValue, seal, unseal } from "../onboarding/domain";
import { digest, indianMobile, matches } from "../sms/policy";
import { telegramApi, TelegramError, type TelegramApi } from "./api";

type Context = { token: string; tenantId: string };
type Bot = {
  bot_id: string;
  username: string;
  token_hash: string;
  secret_cipher: string;
  token: string;
};
const identifier = z.number().int().positive().safe();
const updateSchema = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: z
    .object({
      chat: z.object({ id: identifier, type: z.literal("private") }),
      from: z.object({ id: identifier, is_bot: z.literal(false) }),
      text: z.string().max(4096).optional(),
      contact: z
        .object({
          user_id: identifier.optional(),
          phone_number: z.string().max(40),
        })
        .optional(),
    })
    .optional(),
});

/** Link verified site identities to private Telegram chats and deliver only frozen research grants. */
export class TelegramService {
  private readonly key: string;
  /** Share the retained data key, injectable provider boundary and worker clock. */
  constructor(
    private readonly db: DataSource,
    private readonly env: NodeJS.ProcessEnv,
    private readonly api: TelegramApi = telegramApi,
    private readonly now = () => new Date(),
  ) {
    this.key = env.ONBOARDING_DATA_KEY ?? "";
    requireValue(/^[a-f0-9]{64}$/.test(this.key), "telegram_key_required", 503);
  }

  /** Revalidate session and role under the same user/tenant/member lock order as onboarding. */
  private async actor(
    m: EntityManager,
    c: Context,
    role: "owner" | "subscriber",
  ) {
    const [identity] = await m.query(
      "SELECT u.id FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>UTC_TIMESTAMP(3) AND u.email_verified=1",
      [c.token],
    );
    requireValue(identity, "unauthorized", 401);
    const [user] = await m.query(
      "SELECT id,email_verified FROM auth_users WHERE id=? FOR UPDATE",
      [identity.id],
    );
    const [session] = await m.query(
      "SELECT id FROM auth_sessions WHERE token=? AND user_id=? AND expires_at>UTC_TIMESTAMP(3) LOCK IN SHARE MODE",
      [c.token, identity.id],
    );
    const [tenant] = await m.query(
      "SELECT id,slug FROM tenants WHERE id=? AND status='active' FOR UPDATE",
      [c.tenantId],
    );
    const [member] = await m.query(
      "SELECT id,role,mobile,mobile_verified_at,capabilities_json FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND status='active' FOR UPDATE",
      [c.tenantId, identity.id],
    );
    requireValue(
      user?.email_verified && session && tenant && member?.role === role,
      "forbidden",
      403,
    );
    const overrides =
      typeof member.capabilities_json === "string"
        ? JSON.parse(member.capabilities_json)
        : member.capabilities_json;
    requireValue(
      overrides && !overrides.allow?.length && !overrides.deny?.length,
      "forbidden",
      403,
    );
    return { ...member, slug: tenant.slug };
  }

  /** A saved-token change disables the old connection until the owner reconnects. */
  private async bot(
    m: Pick<EntityManager, "query">,
    tenantId: string,
  ): Promise<Bot | undefined> {
    const [config] = await m.query(
      "SELECT config_cipher FROM tenant_integrations WHERE tenant_id=? AND kind='telegram' LOCK IN SHARE MODE",
      [tenantId],
    );
    const [bot] = await m.query(
      "SELECT * FROM telegram_bots WHERE tenant_id=? LOCK IN SHARE MODE",
      [tenantId],
    );
    const token = config
      ? unseal<{ botToken: string }>(this.key, config.config_cipher).botToken
      : "";
    return bot && token && matches(bot.token_hash, digest(this.key, token))
      ? { ...bot, token }
      : undefined;
  }

  /** Verify the saved bot with Telegram and register a secret-authenticated HTTPS webhook. */
  async connect(c: Context) {
    return this.db.transaction(async (m) => {
      await this.actor(m, c, "owner");
      const origin = new URL(
        this.env.TELEGRAM_WEBHOOK_ORIGIN ??
          this.env.AUTH_BASE_URL ??
          "http://localhost",
      );
      requireValue(
        origin.protocol === "https:" &&
          !origin.username &&
          !origin.password &&
          origin.pathname === "/" &&
          !origin.search &&
          !origin.hash,
        "telegram_https_required",
        422,
      );
      const [config] = await m.query(
        "SELECT config_cipher FROM tenant_integrations WHERE tenant_id=? AND kind='telegram' FOR UPDATE",
        [c.tenantId],
      );
      requireValue(config, "integration_credentials_required", 422);
      const { botToken } = unseal<{ botToken: string }>(
        this.key,
        config.config_cipher,
      );
      requireValue(
        botToken && /^\d+:[A-Za-z0-9_-]+$/.test(botToken),
        "invalid_bot_token",
        422,
      );
      const me = await this.api(botToken, "getMe");
      requireValue(
        Number.isSafeInteger(me.id) &&
          me.is_bot === true &&
          typeof me.username === "string" &&
          /^[A-Za-z0-9_]{5,64}$/.test(me.username),
        "invalid_bot_token",
        422,
      );
      const botId = String(me.id);
      const [other] = await m.query(
        "SELECT tenant_id FROM telegram_bots WHERE bot_id=? AND tenant_id<>?",
        [botId, c.tenantId],
      );
      requireValue(!other, "telegram_bot_in_use", 409);
      const [old] = await m.query(
        "SELECT * FROM telegram_bots WHERE tenant_id=? FOR UPDATE",
        [c.tenantId],
      );
      const secret =
        old?.bot_id === botId
          ? unseal<string>(this.key, old.secret_cipher)
          : randomBytes(32).toString("hex");
      // Reserve the globally unique bot before changing its external webhook.
      if (old)
        await m.query(
          "UPDATE telegram_bots SET bot_id=?,username=?,token_hash=?,secret_cipher=? WHERE tenant_id=?",
          [
            botId,
            me.username,
            digest(this.key, botToken),
            seal(this.key, secret),
            c.tenantId,
          ],
        );
      else
        await m.query(
          "INSERT INTO telegram_bots(tenant_id,bot_id,username,token_hash,secret_cipher) VALUES (?,?,?,?,?)",
          [
            c.tenantId,
            botId,
            me.username,
            digest(this.key, botToken),
            seal(this.key, secret),
          ],
        );
      await this.api(botToken, "setWebhook", {
        url: `${origin.origin}/api/telegram/${c.tenantId}/webhook`,
        secret_token: secret,
        allowed_updates: ["message"],
      });
      if (old && old.bot_id !== botId) {
        await m.query("DELETE FROM telegram_links WHERE tenant_id=?", [
          c.tenantId,
        ]);
        await m.query("DELETE FROM telegram_invites WHERE tenant_id=?", [
          c.tenantId,
        ]);
        await m.query("DELETE FROM telegram_updates WHERE tenant_id=?", [
          c.tenantId,
        ]);
        await m.query(
          "UPDATE telegram_deliveries SET status='skipped' WHERE tenant_id=? AND status='pending'",
          [c.tenantId],
        );
      }
      return { connected: true, username: me.username };
    });
  }

  /** Return connection state without credentials or another investor's Telegram identity. */
  async status(c: Context, owner = false) {
    return this.db.transaction(async (m) => {
      const actor = await this.actor(m, c, owner ? "owner" : "subscriber");
      const bot = await this.bot(m, c.tenantId);
      if (owner) return { connected: !!bot, username: bot?.username };
      const [link] = await m.query(
        "SELECT * FROM telegram_links WHERE tenant_id=? AND membership_id=? LOCK IN SHARE MODE",
        [c.tenantId, actor.id],
      );
      const linked = !!(
        bot &&
        link?.bot_id === bot.bot_id &&
        actor.mobile_verified_at &&
        this.mobileMatches(actor.mobile, link.mobile_hash)
      );
      return {
        connected: !!bot,
        username: bot?.username,
        linked,
        mobileVerified: !!actor.mobile_verified_at,
        linkedAt: linked ? link.linked_at : null,
      };
    });
  }

  /** Issue a single-use, short-lived deep link, replacing any earlier pending invite. */
  async invite(c: Context) {
    return this.db.transaction(async (m) => {
      const actor = await this.actor(m, c, "subscriber");
      const bot = await this.bot(m, c.tenantId);
      requireValue(bot, "telegram_not_connected", 409);
      requireValue(
        actor.mobile_verified_at && actor.mobile,
        "mobile_verification_required",
        409,
      );
      const token = randomBytes(24).toString("base64url");
      const expires = new Date(this.now().getTime() + 10 * 60000);
      await m.query(
        "INSERT INTO telegram_invites(tenant_id,membership_id,token_hash,telegram_user_id,expires_at) VALUES (?,?,?,NULL,?) ON DUPLICATE KEY UPDATE token_hash=VALUES(token_hash),telegram_user_id=NULL,expires_at=VALUES(expires_at)",
        [c.tenantId, actor.id, digest(this.key, token), expires],
      );
      return {
        url: `https://t.me/${bot.username}?start=${token}`,
        expiresAt: expires.toISOString(),
      };
    });
  }

  /** Stop future delivery and invalidate pending invitations from the authenticated account. */
  async unlink(c: Context) {
    return this.db.transaction(async (m) => {
      const actor = await this.actor(m, c, "subscriber");
      await m.query(
        "DELETE FROM telegram_links WHERE tenant_id=? AND membership_id=?",
        [c.tenantId, actor.id],
      );
      await m.query(
        "DELETE FROM telegram_invites WHERE tenant_id=? AND membership_id=?",
        [c.tenantId, actor.id],
      );
      return { ok: true };
    });
  }

  /** Normalize both Telegram and site phone formats without accepting a forwarded contact. */
  private mobileMatches(mobile: unknown, hash: string) {
    try {
      return matches(digest(this.key, indianMobile(mobile)), hash);
    } catch {
      return false;
    }
  }

  /** Authenticate Telegram, deduplicate updates and atomically replace the investor's previous binding. */
  async webhook(tenantId: string, secret: string, input: unknown) {
    const reply = await this.db.transaction(async (m) => {
      const [tenant] = await m.query(
        "SELECT id FROM tenants WHERE id=? AND status='active' FOR UPDATE",
        [tenantId],
      );
      const bot = await this.bot(m, tenantId);
      requireValue(
        tenant &&
          bot &&
          matches(
            digest(this.key, secret),
            digest(this.key, unseal<string>(this.key, bot.secret_cipher)),
          ),
        "forbidden",
        403,
      );
      const parsed = updateSchema.safeParse(input);
      if (!parsed.success || !parsed.data.message) return;
      const update = parsed.data,
        msg = update.message!;
      if (msg.chat.id !== msg.from.id) return;
      const [duplicate] = await m.query(
        "SELECT update_id FROM telegram_updates WHERE tenant_id=? AND update_id=?",
        [tenantId, update.update_id],
      );
      if (duplicate) return;
      await m.query(
        "INSERT INTO telegram_updates(tenant_id,update_id,received_at) VALUES (?,?,?)",
        [tenantId, update.update_id, this.now()],
      );
      const userId = String(msg.from.id);
      let text =
        "Open your investor account on the website and choose Connect Telegram to receive a personal invite.";
      let keyboard: Record<string, unknown> = { remove_keyboard: true };
      if (msg.text === "/stop") {
        await m.query(
          "DELETE FROM telegram_links WHERE tenant_id=? AND telegram_user_id=?",
          [tenantId, userId],
        );
        await m.query(
          "DELETE FROM telegram_invites WHERE tenant_id=? AND telegram_user_id=?",
          [tenantId, userId],
        );
        text =
          "Telegram delivery stopped. You can reconnect from your investor account.";
      } else if (msg.text?.startsWith("/start ")) {
        const token = msg.text.slice(7);
        const [invite] = await m.query(
          "SELECT * FROM telegram_invites WHERE tenant_id=? AND token_hash=? AND expires_at>? FOR UPDATE",
          [tenantId, digest(this.key, token), this.now()],
        );
        if (
          invite &&
          (!invite.telegram_user_id || invite.telegram_user_id === userId)
        ) {
          await m.query(
            "DELETE FROM telegram_invites WHERE tenant_id=? AND telegram_user_id=? AND membership_id<>?",
            [tenantId, userId, invite.membership_id],
          );
          await m.query(
            "UPDATE telegram_invites SET telegram_user_id=? WHERE tenant_id=? AND membership_id=?",
            [userId, tenantId, invite.membership_id],
          );
          text =
            "Share your own Telegram phone number using the button. It must match your verified website mobile. This replaces your previous Telegram account for this RA.";
          keyboard = {
            keyboard: [
              [{ text: "Share my phone number", request_contact: true }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          };
        } else
          text =
            "This invite expired or was already used. Generate a new invite from your investor account.";
      } else if (msg.contact) {
        const [invite] = await m.query(
          "SELECT * FROM telegram_invites WHERE tenant_id=? AND telegram_user_id=? AND expires_at>? FOR UPDATE",
          [tenantId, userId, this.now()],
        );
        const [member] = invite
          ? await m.query(
              "SELECT id,mobile,mobile_verified_at FROM tenant_memberships WHERE tenant_id=? AND id=? AND status='active' AND role='subscriber' FOR UPDATE",
              [tenantId, invite.membership_id],
            )
          : [];
        let mobile = "";
        try {
          mobile = indianMobile(msg.contact.phone_number);
        } catch {
          /* Invalid contacts never create a binding. */
        }
        const own = msg.contact.user_id === msg.from.id;
        const [taken] = member
          ? await m.query(
              "SELECT membership_id FROM telegram_links WHERE tenant_id=? AND telegram_user_id=? AND membership_id<>?",
              [tenantId, userId, member.id],
            )
          : [];
        if (
          own &&
          mobile &&
          member?.mobile_verified_at &&
          this.mobileMatches(member.mobile, digest(this.key, mobile)) &&
          !taken
        ) {
          await m.query(
            "INSERT INTO telegram_links(tenant_id,membership_id,bot_id,telegram_user_id,contact_cipher,mobile_hash,linked_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE bot_id=VALUES(bot_id),telegram_user_id=VALUES(telegram_user_id),contact_cipher=VALUES(contact_cipher),mobile_hash=VALUES(mobile_hash),linked_at=VALUES(linked_at)",
            [
              tenantId,
              member.id,
              bot.bot_id,
              userId,
              seal(this.key, { mobile, telegramUserId: userId }),
              digest(this.key, mobile),
              this.now(),
            ],
          );
          await m.query(
            "DELETE FROM telegram_invites WHERE tenant_id=? AND membership_id=?",
            [tenantId, member.id],
          );
          text =
            "Connected. This is now your only Telegram account for this RA. Eligible recommendations will arrive here. Send /stop to disconnect.";
        } else
          text =
            "Unable to link. Share your own contact matching your verified website mobile, using a fresh invite from your account.";
      }
      return { token: bot.token, chatId: msg.chat.id, text, keyboard };
    });
    if (reply) {
      // Linking is already committed; a lost acknowledgement must not replay a consumed invite.
      try {
        await this.api(reply.token, "sendMessage", {
          chat_id: reply.chatId,
          text: reply.text,
          reply_markup: reply.keyboard,
        });
      } catch {
        /* The website remains the authoritative connection status. */
      }
    }
    return { ok: true };
  }

  /** Queue the publisher's exact frozen audience in its transaction; duplicate requests cannot resend. */
  async enqueue(
    m: EntityManager,
    tenantId: string,
    revisionId: string,
    members: string[],
  ) {
    const bot = await this.bot(m, tenantId);
    requireValue(bot, "telegram_not_connected", 409);
    for (const member of members) {
      const [existing] = await m.query(
        "SELECT id FROM telegram_deliveries WHERE tenant_id=? AND revision_id=? AND membership_id=? LOCK IN SHARE MODE",
        [tenantId, revisionId, member],
      );
      if (!existing)
        await m.query(
          "INSERT INTO telegram_deliveries(id,tenant_id,revision_id,membership_id,bot_id,status,available_at) VALUES (?,?,?,?,?,'pending',?)",
          [randomUUID(), tenantId, revisionId, member, bot.bot_id, this.now()],
        );
    }
  }

  /** Count delivery outcomes without exposing recipient identities. */
  async summary(m: EntityManager, tenantId: string, revisionId: string) {
    const rows: { status: string; total: number }[] = await m.query(
      "SELECT status,COUNT(*) AS total FROM telegram_deliveries WHERE tenant_id=? AND revision_id=? GROUP BY status",
      [tenantId, revisionId],
    );
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.total)]));
  }

  /** Recover ambiguous sends without replay, then claim one bounded unit of work across processes. */
  async deliverOne(): Promise<boolean> {
    await this.db.query(
      "UPDATE telegram_deliveries SET status='unknown' WHERE status='sending' AND lease_until<?",
      [this.now()],
    );
    const job = await this.db.transaction(async (m) => {
      const [row] = await m.query(
        "SELECT * FROM telegram_deliveries WHERE status='pending' AND available_at<=? ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
        [this.now()],
      );
      if (!row) return;
      await m.query(
        "UPDATE telegram_deliveries SET status='sending',attempts=attempts+1,lease_until=? WHERE id=?",
        [new Date(this.now().getTime() + 60000), row.id],
      );
      return row;
    });
    if (!job) return false;
    await this.db.transaction(async (m) => {
      const [tenant] = await m.query(
        "SELECT id,slug FROM tenants WHERE id=? AND status='active' FOR UPDATE",
        [job.tenant_id],
      );
      const [member] = await m.query(
        "SELECT mobile,mobile_verified_at,capabilities_json FROM tenant_memberships WHERE tenant_id=? AND id=? AND status='active' AND role='subscriber' FOR UPDATE",
        [job.tenant_id, job.membership_id],
      );
      const bot = await this.bot(m, job.tenant_id);
      const [link] = await m.query(
        "SELECT * FROM telegram_links WHERE tenant_id=? AND membership_id=? FOR UPDATE",
        [job.tenant_id, job.membership_id],
      );
      const [revision] = await m.query(
        "SELECT v.snapshot_cipher,v.recommendation_id FROM research_revisions v JOIN research_items i ON i.tenant_id=v.tenant_id AND i.id=v.recommendation_id AND i.latest_revision_id=v.id JOIN research_recipients r ON r.tenant_id=v.tenant_id AND r.recommendation_id=v.recommendation_id WHERE v.tenant_id=? AND v.id=? AND r.membership_id=?",
        [job.tenant_id, job.revision_id, job.membership_id],
      );
      const overrides =
        typeof member?.capabilities_json === "string"
          ? JSON.parse(member.capabilities_json)
          : member?.capabilities_json;
      let status = "skipped";
      if (
        tenant &&
        member?.mobile_verified_at &&
        overrides &&
        !overrides.allow?.length &&
        !overrides.deny?.length &&
        bot &&
        bot.bot_id === job.bot_id &&
        link?.bot_id === job.bot_id &&
        this.mobileMatches(member.mobile, link.mobile_hash) &&
        revision
      ) {
        const snapshot = unseal<ResearchSnapshot>(
          this.key,
          revision.snapshot_cipher,
        );
        const reportUrl = `${new URL(this.env.AUTH_BASE_URL!).origin}/ra/${encodeURIComponent(tenant.slug)}/account/recommendations`;
        const legs = snapshot.legs
          .map(
            (leg, i) =>
              `${snapshot.instruments[i]?.symbol ?? leg.instrumentKey}: ${leg.side.toUpperCase()} ${leg.quantity}\nEntry ${leg.entryMin}-${leg.entryMax}; stop ${leg.stopLoss}; targets ${leg.targets.join(", ")}`,
          )
          .join("\n\n");
        const text =
          `${snapshot.issuer.name} | ${snapshot.issuer.registration}\n${snapshot.title}\n${snapshot.status.toUpperCase()} | v${snapshot.version}\n\n${legs}`.slice(
            0,
            3200,
          ) +
          `\n\nRead the full research, rationale, disclosures and updates in your account:\n${reportUrl}`;
        // Hold tenant/member/link locks through I/O so a completed relink cannot race a stale destination.
        try {
          await this.api(bot.token, "sendMessage", {
            chat_id: link.telegram_user_id,
            text,
            protect_content: true,
            link_preview_options: { is_disabled: true },
          });
          status = "delivered";
        } catch (error) {
          if (
            error instanceof TelegramError &&
            error.providerCode === 429 &&
            job.attempts < 4
          ) {
            await m.query(
              "UPDATE telegram_deliveries SET status='pending',available_at=?,lease_until=NULL WHERE id=?",
              [
                new Date(this.now().getTime() + error.retryAfter * 1000),
                job.id,
              ],
            );
            return;
          }
          status =
            error instanceof TelegramError &&
            [400, 401, 403, 404, 429].includes(error.providerCode)
              ? "failed"
              : "unknown";
          if (error instanceof TelegramError && error.providerCode === 403)
            await m.query(
              "DELETE FROM telegram_links WHERE tenant_id=? AND membership_id=?",
              [job.tenant_id, job.membership_id],
            );
        }
      }
      await m.query(
        "UPDATE telegram_deliveries SET status=?,lease_until=NULL WHERE id=?",
        [status, job.id],
      );
    });
    return true;
  }
}

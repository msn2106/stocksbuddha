import type { KycProfile } from "@ra/contracts";
import { reportBackground } from "../background-monitoring";
import { randomInt, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import type { DataSource, EntityManager } from "typeorm";
import { seal, unseal } from "../onboarding/domain";
import {
  SmsError,
  indianMobile,
  digest,
  matches,
  renderOtp,
  smsSettingsSchema,
  smsTemplates,
  recoverySettingsSchema,
  type RecoverySettings,
  type SmsSettings,
} from "./policy";
import type { SmsTransport } from "./horizon";

type Context = { token: string; tenantId: string };
type Actor = {
  user_id: string;
  id: string;
  role: string;
  mobile: string | null;
  mobile_verified_at: string | null;
  email: string;
  signup_phone?: string;
  capabilities_json?: string | { allow?: string[]; deny?: string[] };
};
type Challenge = {
  id: string;
  tenant_id: string;
  user_id: string;
  membership_id: string;
  purpose: string;
  mobile_hash: string;
  mobile_cipher: string;
  code_hash: string | null;
  credential_hash: string | null;
  sends: number;
  attempts: number;
  created_at: string;
  sent_at: string | null;
  expires_at: string | null;
  consumed_at: string | null;
};
/** Convert stored UTC SQL dates without consulting the execution host timezone. */
function time(value: string | Date): number {
  return value instanceof Date
    ? value.getTime()
    : Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}
/** Durable OTP workflow: serialize decisions, commit before external I/O, and never retry ambiguous sends. */
export class SmsService {
  private readonly secret: string;
  private readonly recoveryConfig?: RecoverySettings;
  private readonly tenantCap: number;
  private readonly globalCap: number;
  /** Require a retained encryption key and bound even administrator-configured spending allowances. */
  constructor(
    private readonly db: DataSource,
    private readonly env: NodeJS.ProcessEnv,
    private readonly transport: SmsTransport,
    private readonly now = () => new Date(),
    private readonly notify?: (email: string) => Promise<void>,
    private readonly report = reportBackground,
  ) {
    this.secret = env.ONBOARDING_DATA_KEY ?? "";
    if (!/^[0-9a-f]{64}$/.test(this.secret))
      throw new Error("SMS requires ONBOARDING_DATA_KEY");
    if (env.SMS_RECOVERY_SETTINGS_JSON) {
      try {
        this.recoveryConfig = recoverySettingsSchema.parse(
          JSON.parse(env.SMS_RECOVERY_SETTINGS_JSON),
        );
        if (
          this.recoveryConfig.encoding === "txt" &&
          /[^\x20-\x7E\r\n]/.test(this.recoveryConfig.template.text)
        )
          throw new Error("Recovery encoding mismatch");
      } catch {
        throw new Error("Invalid platform SMS recovery configuration");
      }
    }
    this.tenantCap = Number(
      env.SMS_TENANT_DAILY_CAP ?? (env.SMS_MODE === "live" ? 200 : 10),
    );
    this.globalCap = Number(
      env.SMS_GLOBAL_DAILY_CAP ?? (env.SMS_MODE === "live" ? 1000 : 20),
    );
    if (
      ![this.tenantCap, this.globalCap].every(
        (n) => Number.isSafeInteger(n) && n > 0 && n <= 10000,
      )
    )
      throw new Error("Invalid SMS daily cap");
  }
  /** Share quota decisions across all application replicas, releasing locks before network calls. */
  private async locked<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (manager) => {
      const [mutex] = await manager.query(
        "SELECT id FROM sms_mutex WHERE id=1 FOR UPDATE",
      );
      if (!mutex) throw new SmsError("sms_unavailable", 503);
      return work(manager);
    });
  }
  /** Authorize the current verified session and active RA membership again under database locks. */
  private async actor(
    manager: EntityManager,
    context: Context,
    role: string,
  ): Promise<Actor> {
    const [actor] = await manager.query(
      "SELECT m.id,m.user_id,m.role,m.mobile,m.mobile_verified_at,m.capabilities_json,u.email,u.signup_phone FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id JOIN tenant_memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE s.token=? AND s.expires_at>? AND u.email_verified=1 AND m.tenant_id=? AND m.status='active' AND t.status='active' FOR UPDATE",
      [context.token, this.now(), context.tenantId],
    );
    if (!actor || actor.role !== role) throw new SmsError("forbidden", 403);
    const overrides =
      typeof actor.capabilities_json === "string"
        ? JSON.parse(actor.capabilities_json)
        : actor.capabilities_json;
    if (!overrides || overrides.allow?.length || overrides.deny?.length)
      throw new SmsError("forbidden", 403);
    return actor;
  }
  /** Retain attributable events without plaintext identity, OTP or credentials in general audit metadata. */
  private async audit(
    manager: EntityManager,
    tenantId: string,
    userId: string,
    memberId: string,
    action: string,
    id: string,
  ) {
    await manager.query(
      "INSERT INTO audit_events(id,scope,tenant_id,actor_type,actor_user_id,actor_membership_id,action,entity_type,entity_id,metadata_json) VALUES (?,'tenant',?,'user',?,?,?,'sms',?,'{\"schemaVersion\":1}')",
      [randomUUID(), tenantId, userId, memberId, action, id],
    );
  }
  /** Prevent anonymous recovery enumeration and request floods, including requests that never send SMS. */
  async throttle(ip: string) {
    return this.locked(async (manager) => {
      const key = digest(this.secret, `request:${ip}`);
      const [row] = await manager.query(
        "SELECT hits,started_at FROM auth_rate_limits WHERE bucket_key=? FOR UPDATE",
        [key],
      );
      const expired =
        !row || this.now().getTime() - time(row.started_at) >= 600000;
      if (!expired && Number(row.hits) >= 30)
        throw new SmsError("sms_rate_limited", 429, 600);
      await manager.query(
        "INSERT INTO auth_rate_limits(bucket_key,hits,started_at,expires_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE hits=VALUES(hits),started_at=VALUES(started_at),expires_at=VALUES(expires_at)",
        [
          key,
          expired ? 1 : Number(row.hits) + 1,
          expired ? this.now() : row.started_at,
          new Date(this.now().getTime() + 600000),
        ],
      );
    });
  }
  /** Read private settings, omitting credentials entirely from browser projections. */
  async settings(context: Context) {
    return this.locked(async (manager) => {
      await this.actor(manager, context, "owner");
      const [row] = await manager.query(
        "SELECT config_cipher,version FROM sms_settings WHERE tenant_id=?",
        [context.tenantId],
      );
      if (!row)
        return {
          version: 0,
          configured: false,
          trial: this.env.SMS_MODE !== "live",
          events: [],
          templates: smsTemplates(),
        };
      const { apiKey: _key, ...config } = unseal<SmsSettings>(
        this.secret,
        row.config_cipher,
      );
      void _key;
      const events = await manager.query(
        "SELECT id,status,message_id,balance,created_at FROM sms_events WHERE tenant_id=? AND kind='send' AND challenge_id IN (SELECT id FROM sms_challenges WHERE purpose='verify') ORDER BY created_at DESC LIMIT 20",
        [context.tenantId],
      );
      return {
        ...config,
        templates: smsTemplates(config),
        version: row.version,
        configured: true,
        trial: this.env.SMS_MODE !== "live",
        events,
      };
    });
  }
  /** Export tenant-local verification communications with OTPs redacted; platform recovery messages never enter RA exports. */
  async records(context: Context, before?: string) {
    return this.locked(async (manager) => {
      const actor = await this.actor(manager, context, "owner");
      if (before && !/^[0-9a-f-]{36}$/.test(before))
        throw new SmsError("invalid_cursor");
      const [cursor] = before
        ? await manager.query(
            "SELECT e.created_at FROM sms_events e JOIN sms_challenges c ON c.id=e.challenge_id WHERE e.id=? AND e.tenant_id=? AND e.kind='send' AND c.purpose='verify'",
            [before, context.tenantId],
          )
        : [];
      if (before && !cursor) throw new SmsError("invalid_cursor");
      const rows = await manager.query(
        `SELECT e.* FROM sms_events e JOIN sms_challenges c ON c.id=e.challenge_id WHERE e.tenant_id=? AND e.kind='send' AND c.purpose='verify'${cursor ? " AND (e.created_at<? OR (e.created_at=? AND e.id<?))" : ""} ORDER BY e.created_at DESC,e.id DESC LIMIT 51`,
        [
          context.tenantId,
          ...(cursor ? [cursor.created_at, cursor.created_at, before] : []),
        ],
      );
      await this.audit(
        manager,
        context.tenantId,
        actor.user_id,
        actor.id,
        "sms.records.read",
        context.tenantId,
      );
      return {
        records: rows.slice(0, 50).map((row: Record<string, string>) => {
          const evidence = unseal<{
            mobile: string;
            redactedMessage: string;
            senderId: string;
            templateId: string;
            entityId: string;
            configVersion: number;
          }>(this.secret, row.evidence_cipher);
          return {
            id: row.id,
            userId: row.user_id,
            mobile: evidence.mobile,
            message: evidence.redactedMessage,
            senderId: evidence.senderId,
            templateId: evidence.templateId,
            entityId: evidence.entityId,
            configVersion: evidence.configVersion,
            status: row.status,
            messageId: row.message_id,
            createdAt: row.created_at,
          };
        }),
        nextCursor: rows.length > 50 ? rows[49].id : null,
      };
    });
  }
  /** Validate and version encrypted RA configuration independently of website publication. */
  async saveSettings(context: Context, input: unknown) {
    const parsed = smsSettingsSchema.safeParse(input);
    if (!parsed.success) throw new SmsError("invalid_sms_settings", 422);
    if (parsed.data.templates) {
      const entries = parsed.data.templates,
        login = entries.find((entry) => entry.key === "login");
      if (
        new Set(entries.map((entry) => entry.key)).size !== entries.length ||
        !entries.some((entry) => entry.key === "password-reset") ||
        !login ||
        login.id !== parsed.data.verification.id ||
        login.text !== parsed.data.verification.text
      )
        throw new SmsError("invalid_sms_settings", 422);
    }
    return this.locked(async (manager) => {
      const actor = await this.actor(manager, context, "owner");
      const [row] = await manager.query(
        "SELECT config_cipher,version FROM sms_settings WHERE tenant_id=?",
        [context.tenantId],
      );
      if (parsed.data.version !== (row?.version ?? 0))
        throw new SmsError("version_conflict", 409);
      if (
        this.recoveryConfig?.username.toLowerCase() ===
        parsed.data.username.toLowerCase()
      )
        throw new SmsError("sms_separate_accounts_required", 422);
      const old = row
        ? unseal<SmsSettings>(this.secret, row.config_cipher)
        : null;
      const config = {
        ...parsed.data,
        apiKey: parsed.data.apiKey ?? old?.apiKey,
        version: parsed.data.version + 1,
      };
      if (!config.apiKey) throw new SmsError("sms_credentials_required", 422);
      if (
        config.encoding === "txt" &&
        /[^\x20-\x7E\r\n]/.test(config.verification.text)
      )
        throw new SmsError("sms_encoding_mismatch", 422);
      await manager.query(
        "INSERT INTO sms_settings(tenant_id,config_cipher,version,vendor_user_hash) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE config_cipher=VALUES(config_cipher),version=VALUES(version),vendor_user_hash=VALUES(vendor_user_hash)",
        [
          context.tenantId,
          seal(this.secret, config),
          config.version,
          digest(this.secret, config.username.toLowerCase()),
        ],
      );
      await this.audit(
        manager,
        context.tenantId,
        actor.user_id,
        actor.id,
        "sms.settings.updated",
        context.tenantId,
      );
      return { ok: true };
    });
  }
  /** Project current membership verification and explicit account recovery enrollment without provider data. */
  async mobile(context: Context) {
    return this.locked(async (manager) => {
      const actor = await this.actor(manager, context, "subscriber");
      const [recovery] = await manager.query(
        "SELECT mobile_hash,mobile_cipher FROM account_recovery_mobiles WHERE user_id=?",
        [actor.user_id],
      );
      return {
        mobile: actor.mobile || actor.signup_phone || "",
        verified: !!actor.mobile_verified_at,
        recoveryEnabled: !!recovery,
        recoveryMobile: recovery
          ? `******${unseal<string>(this.secret, recovery.mobile_cipher).slice(-4)}`
          : null,
      };
    });
  }
  /** Restrict global password recovery to investor-only identities; staff accounts keep existing email recovery. */
  private async investorOnly(manager: EntityManager, userId: string) {
    const [user] = await manager.query(
      "SELECT platform_role FROM auth_users WHERE id=? FOR UPDATE",
      [userId],
    );
    const staff = await manager.query(
      "SELECT id FROM tenant_memberships WHERE user_id=? AND role<>'subscriber' AND status='active'",
      [userId],
    );
    return !!user && !user.platform_role && staff.length === 0;
  }
  /** Enroll or remove a recovery contact only with current-password reauthentication and verified possession. */
  async recoveryContact(context: Context, password: unknown, enabled: unknown) {
    if (
      typeof password !== "string" ||
      password.length > 128 ||
      typeof enabled !== "boolean"
    )
      throw new SmsError("invalid_fields");
    const actor = await this.db.transaction((manager) =>
      this.actor(manager, context, "subscriber"),
    );
    const [credential] = await this.db.query(
      "SELECT password FROM auth_accounts WHERE user_id=? AND provider_id='credential'",
      [actor.user_id],
    );
    if (
      !credential?.password ||
      !(await verifyPassword({ hash: credential.password, password }))
    )
      throw new SmsError("invalid_password", 403);
    await this.locked(async (manager) => {
      const current = await this.actor(manager, context, "subscriber");
      const [latest] = await manager.query(
        "SELECT password FROM auth_accounts WHERE user_id=? AND provider_id='credential' FOR UPDATE",
        [current.user_id],
      );
      if (latest?.password !== credential.password)
        throw new SmsError("invalid_password", 403);
      if (enabled) {
        if (!this.recoveryConfig)
          throw new SmsError("sms_recovery_unavailable", 503);
        if (
          !current.mobile_verified_at ||
          !current.mobile ||
          !(await this.investorOnly(manager, current.user_id))
        )
          throw new SmsError("recovery_not_eligible", 409);
        const mobile = indianMobile(current.mobile),
          mobileHash = digest(this.secret, mobile);
        const [taken] = await manager.query(
          "SELECT user_id FROM account_recovery_mobiles WHERE mobile_hash=? AND user_id<>?",
          [mobileHash, current.user_id],
        );
        if (taken) throw new SmsError("recovery_mobile_unavailable", 409);
        await manager.query(
          "INSERT INTO account_recovery_mobiles(user_id,mobile_hash,mobile_cipher,verified_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE mobile_hash=VALUES(mobile_hash),mobile_cipher=VALUES(mobile_cipher),verified_at=VALUES(verified_at)",
          [current.user_id, mobileHash, seal(this.secret, mobile), this.now()],
        );
      } else
        await manager.query(
          "DELETE FROM account_recovery_mobiles WHERE user_id=?",
          [current.user_id],
        );
      await manager.query(
        "UPDATE sms_challenges SET consumed_at=?,code_hash=NULL WHERE user_id=? AND purpose='recover' AND consumed_at IS NULL",
        [this.now(), current.user_id],
      );
      await this.notice(manager, current.user_id);
      await this.audit(
        manager,
        context.tenantId,
        current.user_id,
        current.id,
        enabled ? "sms.recovery.enabled" : "sms.recovery.disabled",
        current.user_id,
      );
    });
    return { ok: true };
  }
  /** Reserve a send atomically; provider I/O follows the committed reservation so crashes cannot bypass caps. */
  async send(input: {
    context?: Context;
    slug?: string;
    email?: unknown;
    mobile?: unknown;
    key: string;
    ip: string;
  }) {
    if (!/^[0-9a-f-]{36}$/.test(input.key))
      throw new SmsError("invalid_request_key");
    const dummy = {
      challengeId: randomUUID(),
      expiresIn: 300,
      retryAfter: 60,
      sendsRemaining: 0,
      attemptsRemaining: 5,
    };
    const prepared = await this.locked(async (manager) => {
      let actor: Actor, tenantId: string, mobile: string;
      const purpose = input.context ? "verify" : "recover";
      if (input.context) {
        actor = await this.actor(manager, input.context, "subscriber");
        tenantId = input.context.tenantId;
        mobile = indianMobile(input.mobile);
      } else {
        if (typeof input.email !== "string" || input.email.length > 254)
          return null;
        const [candidate] = await manager.query(
          "SELECT m.id,m.user_id,m.role,m.mobile,m.mobile_verified_at,u.email,t.id AS tenant_id,r.mobile_cipher FROM auth_users u JOIN account_recovery_mobiles r ON r.user_id=u.id JOIN tenant_memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE u.email=? AND u.email_verified=1 AND m.role='subscriber' AND m.status='active' AND t.slug=? AND t.status='active' FOR UPDATE",
          [input.email.trim().toLowerCase(), input.slug],
        );
        if (
          !candidate ||
          !(await this.investorOnly(manager, candidate.user_id))
        )
          return null;
        actor = candidate;
        tenantId = candidate.tenant_id;
        mobile = unseal<string>(this.secret, candidate.mobile_cipher);
      }
      if (this.env.SMS_MODE !== "live" && mobile !== "+919599400141") {
        if (!input.context) return null;
        throw new SmsError("sms_trial_destination", 403);
      }
      const [settings] =
        purpose === "verify"
          ? await manager.query(
              "SELECT config_cipher,version FROM sms_settings WHERE tenant_id=?",
              [tenantId],
            )
          : [];
      if (purpose === "recover" && !this.recoveryConfig) return null;
      if (purpose === "recover") {
        const shared = await manager.query(
          "SELECT tenant_id FROM sms_settings WHERE vendor_user_hash=?",
          [digest(this.secret, this.recoveryConfig!.username.toLowerCase())],
        );
        if (shared.length) return null;
      }
      if (purpose === "verify" && !settings)
        throw new SmsError("sms_unavailable", 503);
      const config =
        purpose === "verify"
          ? unseal<SmsSettings>(this.secret, settings.config_cipher)
          : {
              ...this.recoveryConfig!,
              enabled: true,
              verification: this.recoveryConfig!.template,
            };
      if (!config.enabled) throw new SmsError("sms_unavailable", 503);
      if (
        purpose === "verify" &&
        this.recoveryConfig?.username.toLowerCase() ===
          config.username.toLowerCase()
      )
        throw new SmsError("sms_separate_accounts_required", 503);
      const mobileHash = digest(this.secret, mobile),
        ipHash = digest(this.secret, `ip:${input.ip}`);
      const [retry] = await manager.query(
        "SELECT challenge_id,mobile_hash FROM sms_events WHERE tenant_id=? AND user_id=? AND request_key=?",
        [tenantId, actor.user_id, input.key],
      );
      if (retry) {
        if (retry.mobile_hash !== mobileHash)
          throw new SmsError("idempotency_conflict", 409);
        return { reply: { ...dummy, challengeId: retry.challenge_id } };
      }
      if (purpose === "recover") {
        const sends: { created_at: string | Date }[] = await manager.query(
          "SELECT e.created_at FROM sms_events e JOIN sms_challenges c ON c.id=e.challenge_id WHERE e.user_id=? AND e.kind='send' AND c.purpose='recover' AND e.created_at>? ORDER BY e.created_at DESC LIMIT 3",
          [actor.user_id, new Date(this.now().getTime() - 86400000)],
        );
        if (
          sends.length >= 3 ||
          (sends[0] && this.now().getTime() - time(sends[0].created_at) < 60000)
        )
          return null;
      }
      const since = new Date(this.now().getTime() - 1800000);
      const [flow]: Challenge[] = await manager.query(
        "SELECT * FROM sms_challenges WHERE tenant_id=? AND user_id=? AND purpose=? AND mobile_hash=? AND created_at>? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        [tenantId, actor.user_id, purpose, mobileHash, since],
      );
      if (
        flow &&
        (flow.sends >= 3 ||
          flow.attempts >= 5 ||
          (flow.sent_at && this.now().getTime() - time(flow.sent_at) < 60000))
      ) {
        if (!input.context) return null;
        throw new SmsError(
          "sms_rate_limited",
          429,
          flow.sends >= 3 || flow.attempts >= 5 ? 1800 : 60,
        );
      }
      const rules: [string, unknown[], number, number][] = [
        ["mobile_hash=?", [mobileHash], 3600000, 5],
        ["mobile_hash=?", [mobileHash], 86400000, 10],
        ["user_id=?", [actor.user_id], 86400000, 10],
        ["ip_hash=?", [ipHash], 3600000, 20],
        ["tenant_id=?", [tenantId], 86400000, this.tenantCap],
        ["1=1", [], 86400000, this.globalCap],
      ];
      for (const [condition, values, window, cap] of rules) {
        const [count] = await manager.query(
          `SELECT COUNT(*) AS n FROM sms_events WHERE kind='send' AND ${condition} AND created_at>?`,
          [...values, new Date(this.now().getTime() - window)],
        );
        if (Number(count.n) >= cap) {
          if (!input.context) return null;
          throw new SmsError("sms_rate_limited", 429, Math.ceil(window / 1000));
        }
      }
      if (purpose === "verify")
        await manager.query(
          "UPDATE sms_challenges SET consumed_at=?,code_hash=NULL WHERE tenant_id=? AND user_id=? AND purpose='verify' AND mobile_hash<>? AND consumed_at IS NULL",
          [this.now(), tenantId, actor.user_id, mobileHash],
        );
      const id = flow?.id ?? randomUUID(),
        code = String(randomInt(100000, 1000000));
      if (!flow)
        await manager.query(
          "INSERT INTO sms_challenges(id,tenant_id,user_id,membership_id,purpose,mobile_hash,mobile_cipher,created_at) VALUES (?,?,?,?,?,?,?,?)",
          [
            id,
            tenantId,
            actor.user_id,
            actor.id,
            purpose,
            mobileHash,
            seal(this.secret, mobile),
            this.now(),
          ],
        );
      const [credential] =
        purpose === "recover"
          ? await manager.query(
              "SELECT password FROM auth_accounts WHERE user_id=? AND provider_id='credential' FOR UPDATE",
              [actor.user_id],
            )
          : [];
      if (purpose === "recover" && !credential?.password) return null;
      const credentialHash = credential
        ? digest(this.secret, credential.password)
        : null;
      const template = config.verification;
      const message = renderOtp(template.text, code),
        eventId = randomUUID();
      await manager.query(
        "UPDATE sms_challenges SET code_hash=?,credential_hash=?,sends=sends+1,sent_at=?,expires_at=? WHERE id=?",
        [
          digest(this.secret, `${id}:${code}`),
          credentialHash,
          this.now(),
          new Date(this.now().getTime() + 300000),
          id,
        ],
      );
      await manager.query(
        "INSERT INTO sms_events(id,tenant_id,user_id,challenge_id,mobile_hash,ip_hash,kind,status,request_key,evidence_cipher,created_at) VALUES (?,?,?,?,?,?,'send','reserved',?,?,?)",
        [
          eventId,
          tenantId,
          actor.user_id,
          id,
          mobileHash,
          ipHash,
          input.key,
          seal(this.secret, {
            mobile,
            message,
            senderId: config.senderId,
            templateId: template.id,
            entityId: config.entityId,
            configVersion: settings?.version ?? 0,
            redactedMessage: renderOtp(template.text, "[REDACTED OTP]"),
            purpose,
          }),
          this.now(),
        ],
      );
      await this.audit(
        manager,
        tenantId,
        actor.user_id,
        actor.id,
        "sms.send.reserved",
        eventId,
      );
      return {
        reply: {
          ...dummy,
          challengeId: id,
          sendsRemaining: 2 - (flow?.sends ?? 0),
          attemptsRemaining: 5 - (flow?.attempts ?? 0),
        },
        eventId,
        message: {
          username: config.username,
          apiKey: config.apiKey!,
          senderId: config.senderId,
          templateId: template.id,
          mobile,
          message,
          encoding: config.encoding,
        },
      };
    });
    if (!prepared) return dummy;
    if ("message" in prepared) {
      try {
        const result = await this.transport(prepared.message!);
        if (result.balance !== null && Number(result.balance) <= 10)
          this.report("sms_low_balance");
        await this.db.query(
          "UPDATE sms_events SET status='accepted',message_id=?,balance=? WHERE id=?",
          [result.messageId, result.balance, prepared.eventId],
        );
      } catch {
        await this.db.query(
          "UPDATE sms_events SET status='uncertain' WHERE id=?",
          [prepared.eventId],
        );
        if (input.context)
          return { ...prepared.reply, deliveryUncertain: true };
      }
    }
    return prepared.reply;
  }
  /** Check OTP attempts in a committing transaction, binding every proof to its exact purpose and current destination. */
  async verify(input: {
    context?: Context;
    slug?: string;
    challengeId: unknown;
    code: unknown;
    ip: string;
    newPassword?: string;
  }) {
    if (
      !input.context &&
      (typeof input.newPassword !== "string" ||
        input.newPassword.length < 8 ||
        input.newPassword.length > 128)
    )
      throw new SmsError("invalid_password");
    const passwordHash = input.context
      ? null
      : await hashPassword(input.newPassword!);
    const result = await this.locked(async (manager) => {
      const actor = input.context
        ? await this.actor(manager, input.context, "subscriber")
        : null;
      if (
        typeof input.challengeId !== "string" ||
        !/^[0-9a-f-]{36}$/.test(input.challengeId) ||
        typeof input.code !== "string" ||
        !/^\d{6}$/.test(input.code)
      )
        return null;
      const [row]: Challenge[] = await manager.query(
        "SELECT * FROM sms_challenges WHERE id=? FOR UPDATE",
        [input.challengeId],
      );
      if (
        !row ||
        row.consumed_at ||
        !row.expires_at ||
        time(row.expires_at) <= this.now().getTime() ||
        row.attempts >= 5 ||
        row.purpose !== (actor ? "verify" : "recover")
      )
        return null;
      if (
        actor &&
        (row.user_id !== actor.user_id ||
          row.tenant_id !== input.context!.tenantId ||
          row.membership_id !== actor.id)
      )
        return null;
      if (!actor) {
        const [current] = await manager.query(
          "SELECT m.id FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id JOIN auth_users u ON u.id=m.user_id JOIN account_recovery_mobiles r ON r.user_id=u.id WHERE m.id=? AND m.tenant_id=? AND m.user_id=? AND m.status='active' AND m.role='subscriber' AND t.slug=? AND t.status='active' AND u.email_verified=1 AND r.mobile_hash=?",
          [
            row.membership_id,
            row.tenant_id,
            row.user_id,
            input.slug,
            row.mobile_hash,
          ],
        );
        if (!current || !(await this.investorOnly(manager, row.user_id)))
          return null;
        const [credential] = await manager.query(
          "SELECT password FROM auth_accounts WHERE user_id=? AND provider_id='credential' FOR UPDATE",
          [row.user_id],
        );
        if (
          !credential?.password ||
          row.credential_hash !== digest(this.secret, credential.password)
        )
          return null;
      }
      const [wrong] = await manager.query(
        "SELECT COUNT(*) AS n FROM sms_events WHERE kind='wrong' AND (mobile_hash=? OR user_id=?) AND created_at>?",
        [
          row.mobile_hash,
          row.user_id,
          new Date(this.now().getTime() - 1800000),
        ],
      );
      if (Number(wrong.n) >= 10) return null;
      if (
        !row.code_hash ||
        !matches(row.code_hash, digest(this.secret, `${row.id}:${input.code}`))
      ) {
        await manager.query(
          "UPDATE sms_challenges SET attempts=attempts+1 WHERE id=?",
          [row.id],
        );
        await manager.query(
          "INSERT INTO sms_events(id,tenant_id,user_id,challenge_id,mobile_hash,ip_hash,kind,status,request_key,created_at) VALUES (?,?,?,?,?,?,'wrong','wrong',?,?)",
          [
            randomUUID(),
            row.tenant_id,
            row.user_id,
            row.id,
            row.mobile_hash,
            digest(this.secret, `ip:${input.ip}`),
            randomUUID(),
            this.now(),
          ],
        );
        return null;
      }
      await manager.query(
        "UPDATE sms_challenges SET consumed_at=?,code_hash=NULL WHERE id=?",
        [this.now(), row.id],
      );
      if (actor) {
        const mobile = unseal<string>(this.secret, row.mobile_cipher);
        const [pending] = await manager.query(
          "SELECT id FROM subscription_orders WHERE tenant_id=? AND membership_id=? AND status='payment_pending'",
          [row.tenant_id, row.membership_id],
        );
        if (pending) throw new SmsError("payment_in_progress", 409);
        await this.prepareMobileChange(manager, row, mobile);
        await manager.query(
          "UPDATE tenant_memberships SET mobile=?,mobile_verified_at=?,lock_version=lock_version+1 WHERE tenant_id=? AND id=?",
          [mobile, this.now(), row.tenant_id, row.membership_id],
        );
        await manager.query(
          "UPDATE subscription_orders SET status='cancelled' WHERE tenant_id=? AND membership_id=? AND status IN ('quoted','signed')",
          [row.tenant_id, row.membership_id],
        );
        await manager.query(
          "UPDATE sms_challenges SET consumed_at=?,code_hash=NULL WHERE tenant_id=? AND user_id=? AND purpose='verify' AND consumed_at IS NULL",
          [this.now(), row.tenant_id, row.user_id],
        );
        await this.audit(
          manager,
          row.tenant_id,
          row.user_id,
          row.membership_id,
          "sms.mobile.verified",
          row.id,
        );
        return { ok: true };
      }
      // Use the pinned Better Auth hasher, with proof consumption, credential update and revocation atomic.
      const [credential] = await manager.query(
        "SELECT user_id FROM auth_accounts WHERE user_id=? AND provider_id='credential' FOR UPDATE",
        [row.user_id],
      );
      if (!credential) throw new SmsError("sms_reset_unavailable", 503);
      await manager.query(
        "UPDATE auth_accounts SET password=?,updated_at=? WHERE user_id=? AND provider_id='credential'",
        [passwordHash, this.now(), row.user_id],
      );
      await manager.query("DELETE FROM auth_sessions WHERE user_id=?", [
        row.user_id,
      ]);
      await manager.query(
        "DELETE FROM auth_verifications WHERE value=? AND identifier LIKE 'reset-password:%'",
        [row.user_id],
      );
      await manager.query(
        "UPDATE sms_challenges SET consumed_at=?,code_hash=NULL WHERE user_id=? AND purpose='recover' AND consumed_at IS NULL",
        [this.now(), row.user_id],
      );
      await this.notice(manager, row.user_id);
      await this.audit(
        manager,
        row.tenant_id,
        row.user_id,
        row.membership_id,
        "sms.password.reset",
        row.id,
      );
      return { ok: true };
    });
    if (!result) throw new SmsError("invalid_or_expired_sms_code", 400);
    return result;
  }
  /** Preserve paid-client continuity and require a fresh KYC review when an unpaid client's submitted contact changes. */
  private async prepareMobileChange(
    manager: EntityManager,
    challenge: Challenge,
    mobile: string,
  ) {
    const [kyc] = await manager.query(
      "SELECT * FROM investor_kyc WHERE tenant_id=? AND membership_id=? FOR UPDATE",
      [challenge.tenant_id, challenge.membership_id],
    );
    if (!kyc) return;
    const profile = unseal<KycProfile>(this.secret, kyc.profile_cipher);
    let unchanged: boolean;
    try {
      unchanged = indianMobile(profile.phone) === mobile;
    } catch {
      unchanged = false;
    }
    if (unchanged) return;
    const [paid] = await manager.query(
      "SELECT id FROM subscription_orders WHERE tenant_id=? AND membership_id=? AND status='paid' LIMIT 1",
      [challenge.tenant_id, challenge.membership_id],
    );
    if (paid) throw new SmsError("paid_mobile_change_requires_review", 409);
    await manager.query(
      "UPDATE investor_kyc SET status='changes',reason='Mobile number changed. Resubmit KYC for RA review.',version=version+1 WHERE tenant_id=? AND membership_id=?",
      [challenge.tenant_id, challenge.membership_id],
    );
    const [revision] = await manager.query(
      "SELECT * FROM investor_kyc WHERE tenant_id=? AND membership_id=?",
      [challenge.tenant_id, challenge.membership_id],
    );
    await manager.query(
      "INSERT INTO kyc_history(id,tenant_id,membership_id,version,snapshot_cipher,actor_id) VALUES (?,?,?,?,?,?)",
      [
        randomUUID(),
        challenge.tenant_id,
        challenge.membership_id,
        revision.version,
        seal(this.secret, revision),
        challenge.user_id,
      ],
    );
    await manager.query(
      "UPDATE tenant_memberships SET onboarding_stage='verification_pending' WHERE tenant_id=? AND id=?",
      [challenge.tenant_id, challenge.membership_id],
    );
  }
  /** Persist security email intent in the same transaction as the sensitive change. */
  private async notice(manager: EntityManager, userId: string) {
    await manager.query(
      "INSERT INTO sms_security_notices(id,user_id,available_at) VALUES (?,?,?)",
      [randomUUID(), userId, this.now()],
    );
  }
  /** Lease one durable security notice; network I/O holds no database transaction and failures back off. */
  async deliverNotice() {
    const job = await this.locked(async (manager) => {
      const [row] = await manager.query(
        "SELECT n.id,n.attempts,u.email FROM sms_security_notices n JOIN auth_users u ON u.id=n.user_id WHERE n.sent_at IS NULL AND n.available_at<=? AND (n.lease_until IS NULL OR n.lease_until<=?) AND n.attempts<10 ORDER BY n.available_at LIMIT 1 FOR UPDATE",
        [this.now(), this.now()],
      );
      if (!row) return null;
      await manager.query(
        "UPDATE sms_security_notices SET attempts=attempts+1,lease_until=? WHERE id=?",
        [new Date(this.now().getTime() + 60000), row.id],
      );
      return row;
    });
    if (!job) return false;
    try {
      if (!this.notify)
        throw new Error("Security notice transport unavailable");
      await this.notify(job.email);
      await this.db.query(
        "UPDATE sms_security_notices SET sent_at=?,lease_until=NULL WHERE id=?",
        [this.now(), job.id],
      );
    } catch {
      if (job.attempts >= 9) this.report("sms_security_notice_failed");
      await this.db.query(
        "UPDATE sms_security_notices SET available_at=?,lease_until=NULL WHERE id=?",
        [new Date(this.now().getTime() + 300000), job.id],
      );
    }
    return true;
  }
}

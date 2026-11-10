import { randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import { z } from "zod";
import { seal, unseal, requireValue } from "../onboarding/domain";
import { merchants, type PaymentGateway } from "../onboarding/cashfree";

const common = { version: z.number().int().min(0) };
const telegramSchema = z
  .object({
    ...common,
    botToken: z.string().min(10).max(256).optional(),
    chatId: z.string().regex(/^(?:-?\d{1,30}|@[A-Za-z0-9_]{5,64})$/),
    inviteLink: z
      .string()
      .max(255)
      .refine(
        (value) => !value || /^https:\/\/t\.me\/[A-Za-z0-9_+/-]+$/.test(value),
      ),
  })
  .strict();
const paymentSchema = z
  .object({
    ...common,
    provider: z.literal("cashfree"),
    enabled: z.boolean(),
    mode: z.enum(["sandbox", "production"]),
    clientId: z.string().trim().min(1).max(256),
    clientSecret: z.string().min(8).max(256).optional(),
  })
  .strict();
type Context = { token: string; tenantId: string };
type Telegram = z.infer<typeof telegramSchema>;
type Payment = z.infer<typeof paymentSchema>;
/** Store private tenant integrations independently of public website revisions and credentials in page data. */
export class IntegrationSettingsService {
  private readonly key: string;
  /** Reuse retained encryption and existing production payment approval gates. */
  constructor(
    private readonly db: DataSource,
    private readonly env: NodeJS.ProcessEnv,
  ) {
    this.key = env.ONBOARDING_DATA_KEY ?? "";
    requireValue(
      /^[0-9a-f]{64}$/.test(this.key),
      "integration_key_required",
      503,
    );
  }
  /** Recheck the current owner, session, tenant and unsupported overrides under locks. */
  private async owner(manager: EntityManager, context: Context) {
    // Keep parallel QR/Cashfree settings reads in the same lock order as onboarding.
    const [identity] = await manager.query(
      "SELECT u.id FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>UTC_TIMESTAMP(3) AND u.email_verified=1",
      [context.token],
    );
    requireValue(identity, "forbidden", 403);
    const [user] = await manager.query(
      "SELECT id,email_verified FROM auth_users WHERE id=? FOR UPDATE",
      [identity.id],
    );
    const [session] = await manager.query(
      "SELECT id FROM auth_sessions WHERE token=? AND user_id=? AND expires_at>UTC_TIMESTAMP(3) LOCK IN SHARE MODE",
      [context.token, identity.id],
    );
    const [tenant] = await manager.query(
      "SELECT id,slug FROM tenants WHERE id=? AND status='active' FOR UPDATE",
      [context.tenantId],
    );
    requireValue(user?.email_verified && session && tenant, "forbidden", 403);
    const [member] = await manager.query(
      "SELECT id,role,capabilities_json FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND status='active' FOR UPDATE",
      [context.tenantId, identity.id],
    );
    const actor =
      member?.role === "owner"
        ? {
            id: identity.id,
            membership_id: member.id,
            slug: tenant.slug,
            capabilities_json: member.capabilities_json,
          }
        : undefined;
    requireValue(actor, "forbidden", 403);
    const overrides =
      typeof actor.capabilities_json === "string"
        ? JSON.parse(actor.capabilities_json)
        : actor.capabilities_json;
    requireValue(
      overrides && !overrides.allow?.length && !overrides.deny?.length,
      "forbidden",
      403,
    );
    return actor;
  }
  /** Resolve optional deployment configuration without exposing secrets through a browser response. */
  private environmentPayment(slug: string): Payment | undefined {
    const config = this.env.CASHFREE_MERCHANTS_JSON
      ? JSON.parse(this.env.CASHFREE_MERCHANTS_JSON)[slug]
      : undefined;
    return config
      ? { ...config, version: 0, provider: "cashfree", enabled: true }
      : undefined;
  }
  /** Prevent merchant switching once retained checkout/payment evidence depends on the original account. */
  private async paymentLocked(
    manager: Pick<EntityManager, "query">,
    tenantId: string,
  ) {
    const [order] = await manager.query(
      "SELECT id FROM subscription_orders WHERE tenant_id=? AND status<>'cancelled' LIMIT 1 FOR UPDATE",
      [tenantId],
    );
    return !!order;
  }
  /** Read sanitized, versioned settings; provider credentials are never returned. */
  async read(context: Context, kind: string) {
    requireValue(
      kind === "telegram" || kind === "payment",
      "invalid_integration",
      404,
    );
    return this.db.transaction(async (manager) => {
      const actor = await this.owner(manager, context);
      const [row] = await manager.query(
        "SELECT config_cipher,version FROM tenant_integrations WHERE tenant_id=? AND kind=? FOR UPDATE",
        [context.tenantId, kind],
      );
      const config: Partial<Telegram & Payment> | undefined = row
        ? unseal<Telegram & Payment>(this.key, row.config_cipher)
        : kind === "payment"
          ? this.environmentPayment(actor.slug)
          : undefined;
      const { botToken, clientSecret, ...safe } = config ?? {};
      return {
        ...safe,
        version: row?.version ?? 0,
        configured: !!(botToken || clientSecret),
        source: row ? "saved" : config ? "environment" : "none",
        locked:
          kind === "payment" &&
          (await this.paymentLocked(manager, context.tenantId)),
        deliveryAvailable: false,
      };
    });
  }
  /** Save tenant-owned configuration with optimistic concurrency, secret retention and an attributable audit event. */
  async save(context: Context, kind: string, input: unknown) {
    requireValue(
      kind === "telegram" || kind === "payment",
      "invalid_integration",
      404,
    );
    const parsed = (
      kind === "telegram" ? telegramSchema : paymentSchema
    ).safeParse(input);
    requireValue(parsed.success, "invalid_integration_settings", 422);
    return this.db.transaction(async (manager) => {
      const actor = await this.owner(manager, context);
      const [row] = await manager.query(
        "SELECT config_cipher,version FROM tenant_integrations WHERE tenant_id=? AND kind=? FOR UPDATE",
        [context.tenantId, kind],
      );
      requireValue(
        parsed.data.version === (row?.version ?? 0),
        "version_conflict",
        409,
      );
      const old = row
        ? unseal<Telegram & Payment>(this.key, row.config_cipher)
        : kind === "payment"
          ? this.environmentPayment(actor.slug)
          : undefined;
      const config = { ...parsed.data, version: parsed.data.version + 1 };
      if (kind === "telegram") {
        (config as Telegram).botToken =
          (config as Telegram).botToken ??
          (old as Telegram | undefined)?.botToken;
        requireValue(
          (config as Telegram).botToken,
          "integration_credentials_required",
          422,
        );
      } else {
        requireValue(
          !(await this.paymentLocked(manager, context.tenantId)),
          "payment_settings_locked",
          409,
        );
        const payment = config as Payment;
        payment.clientSecret =
          payment.clientSecret ?? (old as Payment | undefined)?.clientSecret;
        requireValue(
          payment.clientSecret,
          "integration_credentials_required",
          422,
        );
        // Validate even disabled production credentials; saving settings cannot lift compliance gates.
        merchants({
          ...this.env,
          CASHFREE_MERCHANTS_JSON: JSON.stringify({ [actor.slug]: payment }),
        });
      }
      await manager.query(
        "INSERT INTO tenant_integrations(tenant_id,kind,config_cipher,version) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE config_cipher=VALUES(config_cipher),version=VALUES(version)",
        [context.tenantId, kind, seal(this.key, config), config.version],
      );
      await manager.query(
        "INSERT INTO audit_events(id,scope,tenant_id,actor_type,actor_user_id,actor_membership_id,action,entity_type,entity_id,metadata_json) VALUES (?,'tenant',?,'user',?,?,'integration.settings.updated','integration',?,?)",
        [
          randomUUID(),
          context.tenantId,
          actor.id,
          actor.membership_id,
          context.tenantId,
          JSON.stringify({ schemaVersion: 1, kind }),
        ],
      );
      return { ok: true };
    });
  }
  /** Resolve the current RA's encrypted merchant on every operation so multiple processes share settings. */
  async gateway(
    slug: string,
    fallback?: PaymentGateway,
    manager: Pick<EntityManager, "query"> = this.db,
  ): Promise<PaymentGateway | undefined> {
    const [row] = await manager.query(
      "SELECT i.config_cipher FROM tenant_integrations i JOIN tenants t ON t.id=i.tenant_id WHERE t.slug=? AND t.status='active' AND i.kind='payment' LOCK IN SHARE MODE",
      [slug],
    );
    if (!row) return fallback;
    const config = unseal<Payment>(this.key, row.config_cipher);
    if (!config.enabled) return undefined;
    return merchants({
      ...this.env,
      CASHFREE_MERCHANTS_JSON: JSON.stringify({ [slug]: config }),
    }).get(slug);
  }
}

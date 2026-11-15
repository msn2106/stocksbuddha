import { randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import {
  marketMutationSchema,
  type MarketState,
  type MarketView,
  type ResearchOffering,
} from "@ra/contracts";
import { requireValue, seal, unseal } from "../onboarding/domain";
import { InstrumentCatalogue } from "./catalogue";
import {
  addDays,
  declarationCurrent,
  emptyMarket,
  indiaDate,
  publicationCheck,
  requiredFrom,
  tradeWarnings,
} from "./policy";
export type MarketContext = { token: string; tenantId: string };
/** Tenant-owned declaration workflows. Every access rechecks current session and owner under database locks. */
export class MarketService {
  private key: string;
  /** Require the retained encryption key and inject persistence, reference data and the application clock. */
  constructor(
    private db: DataSource,
    readonly catalogue: InstrumentCatalogue,
    private env: NodeJS.ProcessEnv,
    private now: () => Date = () => new Date(),
  ) {
    this.key = env.ONBOARDING_DATA_KEY ?? "";
    requireValue(/^[0-9a-f]{64}$/.test(this.key), "market_key_required", 503);
  }
  /** Reauthorize a verified live owner under locks; custom capability overrides cannot grant market access. */
  private async owner(m: EntityManager, c: MarketContext): Promise<string> {
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
      "SELECT id FROM tenants WHERE id=? AND status='active' FOR UPDATE",
      [c.tenantId],
    );
    const [member] = await m.query(
      "SELECT id,role,capabilities_json FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND status='active' FOR UPDATE",
      [c.tenantId, identity.id],
    );
    requireValue(
      user?.email_verified && session && tenant && member?.role === "owner",
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
    return identity.id;
  }
  /** Decrypt the current tenant projection, or create an empty undeclared state. */
  private async state(
    m: EntityManager,
    tenantId: string,
  ): Promise<MarketState> {
    const [row] = await m.query(
      "SELECT state_cipher FROM ra_market_state WHERE tenant_id=?",
      [tenantId],
    );
    return row
      ? unseal<MarketState>(this.key, row.state_cipher)
      : emptyMarket();
  }
  /** Project private records with current freshness, declaration coverage and tenant plan offerings. */
  private async view(
    m: EntityManager,
    tenantId: string,
    state: MarketState,
  ): Promise<MarketView> {
    const plans: { id: string; name: string }[] = await m.query(
      "SELECT id,name FROM subscription_plans WHERE tenant_id=? ORDER BY name",
      [tenantId],
    );
    const offerings: { plan_id: string; offering: ResearchOffering }[] =
      await m.query(
        "SELECT plan_id,offering FROM research_plan_offerings WHERE tenant_id=?",
        [tenantId],
      );
    const today = indiaDate(this.now());
    return {
      ...state,
      today,
      requiredFrom: requiredFrom(state, today),
      declarationCurrent: declarationCurrent(state, today),
      catalogue: this.catalogue.metadata(this.now()),
      plans: plans.map((p) => ({
        ...p,
        offerings: offerings
          .filter((o) => o.plan_id === p.id)
          .map((o) => o.offering),
      })),
    };
  }
  /** Owner-only projection, never exposed through investor or public routes. */
  async read(c: MarketContext): Promise<MarketView> {
    await this.catalogue.load();
    return this.db.transaction(async (m) => {
      await this.owner(m, c);
      return this.view(m, c.tenantId, await this.state(m, c.tenantId));
    });
  }
  /** Search a shared catalogue only after authorizing the tenant's owner. */
  async search(c: MarketContext, q: string, type: string, expiry: string) {
    await this.catalogue.load();
    return this.db.transaction(async (m) => {
      await this.owner(m, c);
      return {
        instruments: this.catalogue.search(
          q.slice(0, 100),
          type,
          expiry,
          this.now(),
        ),
      };
    });
  }
  /** Preview the same restriction guard used by future publication operations; no client approval flag is trusted. */
  async check(c: MarketContext, keys: string[]) {
    await this.catalogue.load();
    return this.db.transaction(async (m) => {
      await this.owner(m, c);
      const instruments = keys.map((k) => this.catalogue.get(k));
      requireValue(
        keys.length > 0 && keys.length <= 10 && instruments.every(Boolean),
        "instrument_not_found",
      );
      const check = publicationCheck(
        await this.state(m, c.tenantId),
        instruments.filter((i) => !!i),
        this.now(),
      );
      if (
        !this.catalogue.metadata(this.now()) ||
        this.catalogue.metadata(this.now())?.stale
      ) {
        check.allowed = false;
        check.reasons.push("catalogue_stale");
      }
      return check;
    });
  }
  /** Serialize changes, reject stale browser writes and preserve an encrypted audit snapshot for every revision. */
  async mutate(c: MarketContext, input: unknown) {
    const parsed = marketMutationSchema.safeParse(input);
    requireValue(parsed.success, "invalid_fields");
    const command = parsed.data;
    await this.catalogue.load();
    return this.db.transaction(async (m) => {
      const actor = await this.owner(m, c),
        state = await this.state(m, c.tenantId),
        now = this.now(),
        today = indiaDate(now);
      requireValue(
        state.version === command.version,
        "market_version_conflict",
        409,
      );
      requireValue(
        state.trades.length +
          state.holdings.length +
          state.recommendations.length <
          10000,
        "market_archive_required",
        409,
      );
      let warnings: string[] = [];
      if (
        command.action === "trade" ||
        command.action === "holding" ||
        command.action === "external"
      ) {
        const value = command.value;
        const instrument =
          this.catalogue.get(value.instrumentKey) ??
          [...state.trades, ...state.holdings, ...state.recommendations].find(
            (r) => r.instrumentKey === value.instrumentKey,
          )?.instrument;
        requireValue(
          instrument && instrument.type !== "INDEX",
          "instrument_not_found",
        );
        const record = {
          ...value,
          id: randomUUID(),
          instrument,
          recordedAt: now.toISOString(),
        };
        if (command.action === "trade") {
          const v = command.value;
          requireValue(
            v.date <= today && v.date >= "2000-01-01",
            "invalid_date",
          );
          warnings = tradeWarnings(state, instrument, v.date, v.side);
          state.trades.push({ ...record, ...v });
          if (state.declaration) state.declaration.invalidated = true;
        } else if (command.action === "holding") {
          state.holdings.push({ ...record, ...command.value });
          if (state.declaration) state.declaration.invalidated = true;
        } else {
          const v = command.value;
          requireValue(
            v.publishedOn <= today && v.publishedOn >= "2000-01-01",
            "invalid_date",
          );
          state.recommendations.push({ ...record, ...v });
          warnings = state.trades
            .filter(
              (t) =>
                !t.voidReason &&
                tradeWarnings(state, t.instrument, t.date, t.side).includes(
                  record.id,
                ),
            )
            .map((t) => t.id);
        }
      } else if (command.action === "declare") {
        requireValue(
          command.coveredFrom <= requiredFrom(state, today) &&
            command.coveredFrom >= addDays(today, -3660),
          "declaration_gap",
        );
        state.declaration = {
          at: now.toISOString(),
          coveredFrom: command.coveredFrom,
          actorId: actor,
        };
      } else if (command.action === "correct") {
        const item = [...state.trades, ...state.holdings].find(
          (t) => t.id === command.id,
        );
        requireValue(item && !item.voidReason, "record_not_found", 404);
        item.voidReason = command.reason;
        if (state.declaration) state.declaration.invalidated = true;
      } else if (command.action === "close") {
        const item = state.recommendations.find((r) => r.id === command.id);
        requireValue(item && !item.closedOn, "record_not_found", 404);
        item.closedOn = today;
        item.closeReason = command.reason;
      } else if (command.action === "plan") {
        const [plan] = await m.query(
          "SELECT id FROM subscription_plans WHERE tenant_id=? AND id=?",
          [c.tenantId, command.planId],
        );
        requireValue(plan, "plan_not_found", 404);
        await m.query(
          "DELETE FROM research_plan_offerings WHERE tenant_id=? AND plan_id=?",
          [c.tenantId, command.planId],
        );
        for (const offering of command.offerings)
          await m.query(
            "INSERT INTO research_plan_offerings(tenant_id,plan_id,offering) VALUES (?,?,?)",
            [c.tenantId, command.planId, offering],
          );
      }
      state.version++;
      const cipher = seal(this.key, state);
      await m.query(
        "INSERT INTO ra_market_state(tenant_id,version,state_cipher) VALUES (?,?,?) ON DUPLICATE KEY UPDATE version=VALUES(version),state_cipher=VALUES(state_cipher)",
        [c.tenantId, state.version, cipher],
      );
      await m.query(
        "INSERT INTO ra_market_events(id,tenant_id,actor_id,version,action,snapshot_cipher,created_at) VALUES (?,?,?,?,?,?,?)",
        [
          randomUUID(),
          c.tenantId,
          actor,
          state.version,
          command.action,
          seal(this.key, { state, command, warnings }),
          now,
        ],
      );
      return { view: await this.view(m, c.tenantId, state), warnings };
    });
  }
}

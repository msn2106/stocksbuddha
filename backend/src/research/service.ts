import { isProductionDeployment } from "../deployment";
import type { TelegramService } from "../telegram/service";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import {
  researchSaveSchema,
  researchPublishSchema,
  researchCloseSchema,
  researchGroupSchema,
  type ResearchDraft,
  type ResearchSnapshot,
  type ResearchItem,
  type ResearchDetail,
  type ResearchOptions,
  type ResearchPreview,
  type ResearchRecipientSummary,
  type MarketState,
  type ResearchAttachment,
} from "@ra/contracts";
import {
  OnboardingError,
  requireValue,
  seal,
  unseal,
} from "../onboarding/domain";
import { InstrumentCatalogue } from "../market/catalogue";
import { emptyMarket, publicationCheck, indiaDate } from "../market/policy";
import { devEnabled } from "../onboarding/domain";
import type { GoogleDriveStorage } from "../documents/drive";
export type ResearchContext = { token: string; tenantId: string };
type Actor = {
  id: string;
  name: string;
  membershipId: string;
  role: "owner" | "subscriber";
  issuer: { name: string; registration: string; author: string };
};
type Row = {
  id: string;
  tenant_id: string;
  version: number;
  status: ResearchItem["status"];
  draft_cipher: string;
  latest_revision_id: string | null;
};
/** Return only safe field paths and validation messages, never submitted values. */
export class ResearchValidationError extends OnboardingError {
  /** Keep the established API error code while exposing actionable field failures. */
  constructor(readonly issues: { path: string; message: string }[]) {
    super("invalid_recommendation");
  }
}
/** Persist tenant-scoped research, atomically freeze recipients, and retain immutable published versions. */
export class ResearchService {
  private key: string;
  /** Share reference data and private storage; all network downloads are authorized again after I/O. */
  constructor(
    private db: DataSource,
    readonly catalogue: InstrumentCatalogue,
    private env: NodeJS.ProcessEnv,
    private drive: GoogleDriveStorage | null = null,
    private now = () => new Date(),
    private telegram?: TelegramService,
  ) {
    this.key = env.ONBOARDING_DATA_KEY ?? "";
    requireValue(/^[a-f0-9]{64}$/.test(this.key), "research_key_required", 503);
  }
  /** Recheck user, session, tenant and membership in the established lock order, including capability overrides. */
  private async actor(
    m: EntityManager,
    c: ResearchContext,
    owner = false,
  ): Promise<Actor> {
    const [identity] = await m.query(
      "SELECT u.id FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>UTC_TIMESTAMP(3) AND u.email_verified=1",
      [c.token],
    );
    requireValue(identity, "unauthorized", 401);
    const [user] = await m.query(
      "SELECT id,name,email_verified FROM auth_users WHERE id=? FOR UPDATE",
      [identity.id],
    );
    const [session] = await m.query(
      "SELECT id FROM auth_sessions WHERE token=? AND user_id=? AND expires_at>UTC_TIMESTAMP(3) LOCK IN SHARE MODE",
      [c.token, identity.id],
    );
    const [tenant] = await m.query(
      "SELECT id,display_name,registration_number FROM tenants WHERE id=? AND status='active' FOR UPDATE",
      [c.tenantId],
    );
    const [member] = await m.query(
      "SELECT id,role,capabilities_json FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND status='active' FOR UPDATE",
      [c.tenantId, identity.id],
    );
    requireValue(
      user?.email_verified &&
        session &&
        tenant &&
        member &&
        ["owner", "subscriber"].includes(member.role) &&
        (!owner || member.role === "owner"),
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
    return {
      id: user.id,
      name: user.name,
      membershipId: member.id,
      role: member.role,
      issuer: {
        name: tenant.display_name,
        registration: tenant.registration_number ?? "",
        author: user.name,
      },
    };
  }
  /** Load only the current tenant row; callers must authenticate first. */
  private async row(
    m: EntityManager,
    c: ResearchContext,
    id: string,
  ): Promise<Row> {
    const [row] = await m.query(
      "SELECT * FROM research_items WHERE tenant_id=? AND id=? FOR UPDATE",
      [c.tenantId, id],
    );
    requireValue(row, "recommendation_not_found", 404);
    return row;
  }
  /** Historical access is an immutable delivery grant, conditional on a still-active current membership. */
  private async access(
    m: EntityManager,
    c: ResearchContext,
    a: Actor,
    row: Row,
  ) {
    if (a.role === "owner") return;
    const [grant] = await m.query(
      "SELECT membership_id FROM research_recipients WHERE tenant_id=? AND recommendation_id=? AND membership_id=? LOCK IN SHARE MODE",
      [c.tenantId, row.id, a.membershipId],
    );
    requireValue(
      grant && row.latest_revision_id,
      "recommendation_not_found",
      404,
    );
  }
  /** Retain private audience/draft fields only in owner projections. */
  private async item(
    m: EntityManager,
    c: ResearchContext,
    a: Actor,
    row: Row,
  ): Promise<ResearchItem> {
    const [revision] = row.latest_revision_id
      ? await m.query(
          "SELECT snapshot_cipher FROM research_revisions WHERE tenant_id=? AND id=? LOCK IN SHARE MODE",
          [c.tenantId, row.latest_revision_id],
        )
      : [];
    const [delivery] = await m.query(
      "SELECT read_at FROM research_deliveries WHERE tenant_id=? AND revision_id=? AND membership_id=? AND channel=? LOCK IN SHARE MODE",
      [c.tenantId, row.latest_revision_id, a.membershipId, "dashboard"],
    );
    const base: ResearchItem = {
      id: row.id,
      version: row.version,
      status: row.status,
      latest: revision
        ? unseal<ResearchSnapshot>(this.key, revision.snapshot_cipher)
        : null,
      unread: !!delivery && !delivery.read_at,
    };
    if (a.role === "owner") {
      base.draft = unseal<ResearchDraft>(this.key, row.draft_cipher);
      const [count] = await m.query(
        "SELECT COUNT(*) AS total FROM research_recipients WHERE tenant_id=? AND recommendation_id=?",
        [c.tenantId, row.id],
      );
      base.recipientCount = Number(count.total);
      if (this.telegram && row.latest_revision_id)
        base.telegramDelivery = await this.telegram.summary(
          m,
          c.tenantId,
          row.latest_revision_id,
        );
    }
    return base;
  }
  /** Paginate only owned drafts or granted published research; expired subscriptions preserve prior deliveries. */
  async list(c: ResearchContext, page = 0) {
    requireValue(
      Number.isInteger(page) && page >= 0 && page <= 100000,
      "invalid_page",
    );
    return this.db.transaction(async (m) => {
      const a = await this.actor(m, c);
      const rows: Row[] =
        a.role === "owner"
          ? await m.query(
              "SELECT * FROM research_items WHERE tenant_id=? ORDER BY updated_at DESC,id DESC LIMIT 21 OFFSET ?",
              [c.tenantId, page * 20],
            )
          : await m.query(
              "SELECT i.* FROM research_items i JOIN research_recipients r ON r.recommendation_id=i.id AND r.tenant_id=i.tenant_id WHERE i.tenant_id=? AND r.membership_id=? AND i.latest_revision_id IS NOT NULL ORDER BY i.updated_at DESC,i.id DESC LIMIT 21 OFFSET ?",
              [c.tenantId, a.membershipId, page * 20],
            );
      const items = [];
      for (const row of rows.slice(0, 20))
        items.push(await this.item(m, c, a, row));
      return { items, hasMore: rows.length > 20 };
    });
  }
  /** Return a delivered report and immutable version history without private recipient or draft data. */
  async detail(c: ResearchContext, id: string): Promise<ResearchDetail> {
    return this.db.transaction(async (m) => {
      const a = await this.actor(m, c),
        row = await this.row(m, c, id);
      await this.access(m, c, a, row);
      const revisions: { snapshot_cipher: string }[] = await m.query(
        "SELECT snapshot_cipher FROM research_revisions WHERE tenant_id=? AND recommendation_id=? ORDER BY version DESC",
        [c.tenantId, id],
      );
      return {
        ...(await this.item(m, c, a, row)),
        history: revisions.map((r) =>
          unseal<ResearchSnapshot>(this.key, r.snapshot_cipher),
        ),
      };
    });
  }
  /** Save a complete editable draft with optimistic concurrency; published facts remain unchanged. */
  async save(c: ResearchContext, input: unknown) {
    const p = researchSaveSchema.safeParse(input);
    if (!p.success)
      throw new ResearchValidationError(
        p.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    const v = p.data;
    return this.db.transaction(async (m) => {
      await this.actor(m, c, true);
      const [existing]: Row[] = await m.query(
        "SELECT * FROM research_items WHERE tenant_id=? AND id=? FOR UPDATE",
        [c.tenantId, v.id],
      );
      if (existing) {
        requireValue(
          existing.version === v.version,
          "research_version_conflict",
          409,
        );
        requireValue(
          ["draft", "active"].includes(existing.status),
          "recommendation_final",
          409,
        );
        if (existing.latest_revision_id) {
          const old = unseal<ResearchDraft>(this.key, existing.draft_cipher);
          requireValue(
            old.offering === v.draft.offering &&
              JSON.stringify(old.audience) ===
                JSON.stringify(v.draft.audience) &&
              JSON.stringify(old.legs.map((l) => [l.instrumentKey, l.side])) ===
                JSON.stringify(
                  v.draft.legs.map((l) => [l.instrumentKey, l.side]),
                ),
            "published_scope_locked",
          );
        }
        await m.query(
          "UPDATE research_items SET version=?,draft_cipher=?,updated_at=? WHERE tenant_id=? AND id=?",
          [
            v.version + 1,
            seal(this.key, v.draft),
            this.now(),
            c.tenantId,
            v.id,
          ],
        );
      } else {
        requireValue(v.version === 0, "research_version_conflict", 409);
        await m.query(
          "INSERT INTO research_items(id,tenant_id,version,status,draft_cipher,created_at,updated_at) VALUES (?,?,1,?,?,?,?)",
          [
            v.id,
            c.tenantId,
            "draft",
            seal(this.key, v.draft),
            this.now(),
            this.now(),
          ],
        );
      }
      return { id: v.id, version: v.version + 1 };
    });
  }
  /** List bounded tenant choices and safe file metadata, never another RA's identities or private storage IDs. */
  async options(c: ResearchContext): Promise<ResearchOptions> {
    return this.db.transaction(async (m) => {
      await this.actor(m, c, true);
      const plans = await m.query(
        "SELECT id,name FROM subscription_plans WHERE tenant_id=? ORDER BY name LIMIT 1000",
        [c.tenantId],
      );
      const clients = await m.query(
        "SELECT id,COALESCE(full_name,id) AS name FROM tenant_memberships WHERE tenant_id=? AND role='subscriber' AND status='active' ORDER BY id LIMIT 1000",
        [c.tenantId],
      );
      const groups: {
        id: string;
        name: string;
        version: number;
        members_cipher: string;
      }[] = await m.query(
        "SELECT * FROM research_groups WHERE tenant_id=? ORDER BY name LIMIT 100",
        [c.tenantId],
      );
      const attachments = await m.query(
        "SELECT id,original_name AS name,mime_type AS mime,byte_size AS bytes,sha256 FROM documents WHERE tenant_id=? AND kind='general' AND customer_id IS NULL ORDER BY created_at DESC LIMIT 100",
        [c.tenantId],
      );
      return {
        plans,
        clients,
        attachments,
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          version: g.version,
          membershipIds: unseal<string[]>(this.key, g.members_cipher),
        })),
      };
    });
  }
  /** Store reusable recipient cohorts; group membership never bypasses paid offering eligibility. */
  async saveGroup(c: ResearchContext, input: unknown) {
    const p = researchGroupSchema.safeParse(input);
    requireValue(p.success, "invalid_group");
    const v = p.data;
    return this.db.transaction(async (m) => {
      await this.actor(m, c, true);
      const [old] = await m.query(
        "SELECT version FROM research_groups WHERE tenant_id=? AND id=? FOR UPDATE",
        [c.tenantId, v.id],
      );
      requireValue(
        (old?.version ?? 0) === v.version,
        "research_version_conflict",
        409,
      );
      for (const id of v.membershipIds) {
        const [member] = await m.query(
          "SELECT id FROM tenant_memberships WHERE tenant_id=? AND id=? AND role='subscriber' AND status='active' LOCK IN SHARE MODE",
          [c.tenantId, id],
        );
        requireValue(member, "invalid_group_member");
      }
      if (old)
        await m.query(
          "UPDATE research_groups SET name=?,version=?,members_cipher=? WHERE tenant_id=? AND id=?",
          [
            v.name,
            v.version + 1,
            seal(this.key, [...new Set(v.membershipIds)]),
            c.tenantId,
            v.id,
          ],
        );
      else
        await m.query(
          "INSERT INTO research_groups(id,tenant_id,name,version,members_cipher) VALUES (?,?,?,1,?)",
          [
            v.id,
            c.tenantId,
            v.name,
            seal(this.key, [...new Set(v.membershipIds)]),
          ],
        );
      return { id: v.id, version: v.version + 1 };
    });
  }
  /** Current locking reads freeze only members with KYC, paid evidence and the matching offering on the same selected order. */
  private async recipients(
    m: EntityManager,
    c: ResearchContext,
    row: Row,
    draft: ResearchDraft,
    summary?: ResearchRecipientSummary,
  ): Promise<string[]> {
    if (row.latest_revision_id) {
      const rows: { membership_id: string }[] = await m.query(
        "SELECT membership_id FROM research_recipients WHERE tenant_id=? AND recommendation_id=? ORDER BY membership_id LOCK IN SHARE MODE",
        [c.tenantId, row.id],
      );
      if (summary) {
        summary.candidates = rows.length;
        summary.historical = true;
      }
      return rows.map((r) => r.membership_id);
    }
    let groupMembers: Set<string> | null = null;
    for (const id of draft.audience.ids) {
      if (draft.audience.mode === "plans") {
        const [p] = await m.query(
          "SELECT id FROM subscription_plans WHERE tenant_id=? AND id=? LOCK IN SHARE MODE",
          [c.tenantId, id],
        );
        requireValue(p, "invalid_audience");
      }
      if (draft.audience.mode === "groups") {
        const [g] = await m.query(
          "SELECT members_cipher FROM research_groups WHERE tenant_id=? AND id=? LOCK IN SHARE MODE",
          [c.tenantId, id],
        );
        requireValue(g, "invalid_audience");
        groupMembers ??= new Set();
        for (const member of unseal<string[]>(this.key, g.members_cipher))
          groupMembers.add(member);
      }
    }
    const members: { id: string }[] = await m.query(
      "SELECT id FROM tenant_memberships WHERE tenant_id=? AND role='subscriber' AND status='active' ORDER BY id LIMIT 2001 LOCK IN SHARE MODE",
      [c.tenantId],
    );
    requireValue(members.length <= 2000, "audience_too_large");
    if (summary) summary.candidates = members.length;
    const recipients: string[] = [];
    for (const member of members) {
      if (groupMembers && !groupMembers.has(member.id)) {
        if (summary) summary.outsideGroup++;
        continue;
      }
      const [kyc] = await m.query(
        "SELECT status FROM investor_kyc WHERE tenant_id=? AND membership_id=? LOCK IN SHARE MODE",
        [c.tenantId, member.id],
      );
      if (!(
        kyc?.status === "verified" ||
        (devEnabled(this.env) && kyc?.status === "skipped_dev")
      )) {
        if (summary) summary.kyc++;
        continue;
      }
      const orders: { plan_id: string; dev: number }[] = await m.query(
        "SELECT o.plan_id,o.dev FROM subscription_orders o JOIN research_order_offerings g ON g.order_id=o.id AND g.tenant_id=o.tenant_id WHERE o.tenant_id=? AND o.membership_id=? AND g.offering=? AND o.status='paid' AND o.starts_at<=? AND o.ends_at>? AND o.agreement_id IS NOT NULL LOCK IN SHARE MODE",
        [c.tenantId, member.id, draft.offering, this.now(), this.now()],
      );
      const eligibleOrders = orders.filter(
        (o) => !isProductionDeployment(this.env) || !o.dev,
      );
      if (!eligibleOrders.length) {
        if (summary) summary.subscriptionOrOffering++;
        continue;
      }
      if (
        draft.audience.mode === "plans" &&
        !eligibleOrders.some((o) => draft.audience.ids.includes(o.plan_id))
      ) {
        if (summary) summary.outsidePlan++;
        continue;
      }
      recipients.push(member.id);
    }
    return recipients;
  }
  /** Build the exact report preview and a signed decision fingerprint; publication recomputes every guard. */
  private async prepare(
    m: EntityManager,
    c: ResearchContext,
    a: Actor,
    row: Row,
  ) {
    const draft = unseal<ResearchDraft>(this.key, row.draft_cipher),
      reasons: string[] = [];
    const instruments = draft.legs.map((l) =>
      this.catalogue.get(l.instrumentKey),
    );
    requireValue(
      instruments.every((i) => i && i.type !== "INDEX"),
      "instrument_not_found",
    );
    const resolved = instruments.filter((i) => !!i);
    if (
      resolved.some(
        (i) =>
          (draft.offering === "equity" && i.type !== "EQ") ||
          (draft.offering === "futures" && i.type !== "FUT") ||
          (draft.offering === "options" && !["CE", "PE"].includes(i.type)),
      )
    )
      reasons.push("offering_instrument_mismatch");
    if (
      resolved.some(
        (i, n) => i.type !== "EQ" && draft.legs[n].quantity % i.lotSize !== 0,
      )
    )
      reasons.push("quantity_must_match_lot_size");
    if (Date.parse(draft.validUntil) <= this.now().getTime())
      reasons.push("validity_expired");
    if (
      resolved.some(
        (i) => i.expiry && indiaDate(new Date(draft.validUntil)) > i.expiry,
      )
    )
      reasons.push("validity_after_contract_expiry");
    const [s] = await m.query(
      "SELECT state_cipher FROM ra_market_state WHERE tenant_id=? LOCK IN SHARE MODE",
      [c.tenantId],
    );
    const market = s
      ? unseal<MarketState>(this.key, s.state_cipher)
      : emptyMarket();
    const check = publicationCheck(market, resolved, this.now());
    if (
      !this.catalogue.metadata(this.now()) ||
      this.catalogue.metadata(this.now())?.stale
    )
      check.reasons.push("catalogue_stale");
    check.allowed = check.reasons.length === 0;
    if (!a.issuer.registration) reasons.push("registration_required");
    const attachments: ResearchAttachment[] = [];
    for (const id of draft.attachmentIds) {
      const [file] = await m.query(
        "SELECT id,original_name AS name,mime_type AS mime,byte_size AS bytes,sha256 FROM documents WHERE tenant_id=? AND id=? AND kind='general' AND customer_id IS NULL LOCK IN SHARE MODE",
        [c.tenantId, id],
      );
      requireValue(file, "attachment_not_found");
      attachments.push(file);
    }
    const recipientSummary: ResearchRecipientSummary = {
      candidates: 0,
      historical: false,
      outsideGroup: 0,
      kyc: 0,
      subscriptionOrOffering: 0,
      outsidePlan: 0,
    };
    const recipients = await this.recipients(
      m,
      c,
      row,
      draft,
      recipientSummary,
    );
    if (!recipients.length) reasons.push("no_eligible_recipients");
    if (
      isProductionDeployment(this.env) &&
      this.env.ONBOARDING_PRODUCTION_APPROVED !== "true"
    )
      reasons.push("production_review_required");
    const {
      audience: privateAudience,
      attachmentIds: privateIds,
      ...content
    } = draft;
    void privateAudience;
    void privateIds;
    const snapshot: ResearchSnapshot = {
      ...content,
      instruments: resolved,
      attachments,
      issuer: a.issuer,
      status: "active",
      reason: "",
      publishedAt: this.now().toISOString(),
      version: row.version + 1,
    };
    const token = createHmac("sha256", this.key)
      .update(
        JSON.stringify({
          id: row.id,
          version: row.version,
          draft,
          recipients,
          marketVersion: market.version,
          day: indiaDate(this.now()),
          source: this.catalogue.metadata(this.now())?.sourceModified,
          instruments: resolved,
          attachments,
          issuer: a.issuer,
        }),
      )
      .digest("hex");
    return {
      snapshot,
      check,
      reasons,
      recipients,
      recipientSummary,
      market,
      token,
    };
  }
  /** Preview is informational; its token becomes invalid when content, recipients or declaration state changes. */
  async preview(c: ResearchContext, id: string): Promise<ResearchPreview> {
    await this.catalogue.load();
    return this.db.transaction(async (m) => {
      const a = await this.actor(m, c, true),
        row = await this.row(m, c, id);
      requireValue(
        ["draft", "active"].includes(row.status),
        "recommendation_final",
        409,
      );
      const p = await this.prepare(m, c, a, row);
      return {
        snapshot: p.snapshot,
        check: p.check,
        reasons: p.reasons,
        recipientCount: p.recipients.length,
        recipientSummary: p.recipientSummary,
        token: p.check.allowed && !p.reasons.length ? p.token : null,
      };
    });
  }
  /** Publish report, frozen grants, notification rows and trading register entries in one database transaction. */
  async publish(c: ResearchContext, id: string, input: unknown) {
    const p = researchPublishSchema.safeParse(input);
    requireValue(p.success, "invalid_publication");
    await this.catalogue.load();
    return this.db.transaction(async (m) => {
      const a = await this.actor(m, c, true),
        row = await this.row(m, c, id);
      requireValue(
        row.version === p.data.version,
        "research_version_conflict",
        409,
      );
      requireValue(
        ["draft", "active"].includes(row.status),
        "recommendation_final",
        409,
      );
      const prepared = await this.prepare(m, c, a, row);
      requireValue(
        prepared.check.allowed && !prepared.reasons.length,
        "publication_blocked",
        409,
      );
      requireValue(prepared.token === p.data.token, "preview_changed", 409);
      requireValue(
        !row.latest_revision_id || p.data.reason.length >= 10,
        "update_reason_required",
      );
      prepared.snapshot.reason = p.data.reason;
      const revision = await this.revision(
        m,
        c,
        row,
        prepared.snapshot,
        prepared.recipients,
      );
      if (p.data.sendTelegram) {
        requireValue(this.telegram, "telegram_not_connected", 409);
        await this.telegram.enqueue(
          m,
          c.tenantId,
          revision,
          prepared.recipients,
        );
      }
      for (const member of prepared.recipients)
        if (!row.latest_revision_id)
          await m.query(
            "INSERT INTO research_recipients(tenant_id,recommendation_id,membership_id,granted_at) VALUES (?,?,?,?)",
            [c.tenantId, id, member, this.now()],
          );
      const market = prepared.market,
        today = indiaDate(this.now());
      for (const rec of market.recommendations)
        if (rec.sourceResearchId === id && !rec.closedOn) {
          rec.closedOn = today;
          rec.closeReason = "Superseded by published update";
        }
      for (const [n, leg] of prepared.snapshot.legs.entries())
        market.recommendations.push({
          id: randomUUID(),
          sourceResearchId: id,
          instrumentKey: leg.instrumentKey,
          instrument: prepared.snapshot.instruments[n],
          publishedOn: today,
          direction: leg.side,
          audience: `Dashboard · ${prepared.recipients.length} recipients`,
          rationale: leg.rationale,
          recordedAt: this.now().toISOString(),
        });
      await this.marketEvent(m, c, a, market, "research.published");
      return {
        id,
        version: prepared.snapshot.version,
        revisionId: revision,
        recipientCount: prepared.recipients.length,
      };
    });
  }
  /** Close or withdraw without inventing price outcomes; notify the original audience even after plan expiry. */
  async close(c: ResearchContext, id: string, input: unknown) {
    const p = researchCloseSchema.safeParse(input);
    requireValue(p.success, "invalid_closure");
    return this.db.transaction(async (m) => {
      const a = await this.actor(m, c, true),
        row = await this.row(m, c, id);
      requireValue(
        row.version === p.data.version,
        "research_version_conflict",
        409,
      );
      requireValue(
        row.status === "active" && row.latest_revision_id,
        "recommendation_not_active",
        409,
      );
      const [old] = await m.query(
        "SELECT snapshot_cipher FROM research_revisions WHERE tenant_id=? AND id=?",
        [c.tenantId, row.latest_revision_id],
      );
      const snapshot = unseal<ResearchSnapshot>(this.key, old.snapshot_cipher);
      snapshot.status = p.data.status;
      snapshot.reason = p.data.reason;
      snapshot.version = row.version + 1;
      snapshot.publishedAt = this.now().toISOString();
      snapshot.issuer.author = a.name;
      const recipients = await this.recipients(
        m,
        c,
        row,
        unseal<ResearchDraft>(this.key, row.draft_cipher),
      );
      const revision = await this.revision(m, c, row, snapshot, recipients);
      if (p.data.sendTelegram) {
        requireValue(this.telegram, "telegram_not_connected", 409);
        await this.telegram.enqueue(m, c.tenantId, revision, recipients);
      }
      const [s] = await m.query(
        "SELECT state_cipher FROM ra_market_state WHERE tenant_id=? LOCK IN SHARE MODE",
        [c.tenantId],
      );
      const market = s
        ? unseal<MarketState>(this.key, s.state_cipher)
        : emptyMarket();
      for (const rec of market.recommendations)
        if (rec.sourceResearchId === id && !rec.closedOn) {
          rec.closedOn = indiaDate(this.now());
          rec.closeReason = p.data.reason;
        }
      await this.marketEvent(m, c, a, market, `research.${p.data.status}`);
      return { id, version: snapshot.version };
    });
  }
  /** Send the latest immutable publication to its original audience, once per revision. */
  async sendTelegram(c: ResearchContext, id: string, version: unknown) {
    return this.db.transaction(async (m) => {
      await this.actor(m, c, true);
      const row = await this.row(m, c, id);
      requireValue(row.latest_revision_id, "recommendation_not_published", 409);
      requireValue(row.version === version, "research_version_conflict", 409);
      requireValue(this.telegram, "telegram_not_connected", 409);
      const members: { membership_id: string }[] = await m.query(
        "SELECT membership_id FROM research_recipients WHERE tenant_id=? AND recommendation_id=?",
        [c.tenantId, id],
      );
      await this.telegram.enqueue(
        m,
        c.tenantId,
        row.latest_revision_id,
        members.map((r) => r.membership_id),
      );
      return {
        ok: true,
        delivery: await this.telegram.summary(
          m,
          c.tenantId,
          row.latest_revision_id,
        ),
      };
    });
  }
  /** Append immutable published evidence and atomically expose the same revision to all original recipients. */
  private async revision(
    m: EntityManager,
    c: ResearchContext,
    row: Row,
    s: ResearchSnapshot,
    recipients: string[],
  ) {
    const id = randomUUID();
    await m.query(
      "INSERT INTO research_revisions(id,tenant_id,recommendation_id,version,snapshot_cipher,created_at) VALUES (?,?,?,?,?,?)",
      [id, c.tenantId, row.id, s.version, seal(this.key, s), this.now()],
    );
    await m.query(
      "UPDATE research_items SET version=?,status=?,latest_revision_id=?,updated_at=? WHERE tenant_id=? AND id=?",
      [s.version, s.status, id, this.now(), c.tenantId, row.id],
    );
    for (const member of recipients)
      await m.query(
        "INSERT INTO research_deliveries(id,tenant_id,revision_id,membership_id,channel,status,attempts,created_at) VALUES (?,?,?,?,?,?,1,?)",
        [
          randomUUID(),
          c.tenantId,
          id,
          member,
          "dashboard",
          "delivered",
          this.now(),
        ],
      );
    return id;
  }
  /** Keep the existing private trading register and audit revision in the same publication transaction. */
  private async marketEvent(
    m: EntityManager,
    c: ResearchContext,
    a: Actor,
    state: MarketState,
    action: string,
  ) {
    state.version++;
    await m.query(
      "INSERT INTO ra_market_state(tenant_id,version,state_cipher) VALUES (?,?,?) ON DUPLICATE KEY UPDATE version=VALUES(version),state_cipher=VALUES(state_cipher)",
      [c.tenantId, state.version, seal(this.key, state)],
    );
    await m.query(
      "INSERT INTO ra_market_events(id,tenant_id,actor_id,version,action,snapshot_cipher,created_at) VALUES (?,?,?,?,?,?,?)",
      [
        randomUUID(),
        c.tenantId,
        a.id,
        state.version,
        action,
        seal(this.key, { state }),
        this.now(),
      ],
    );
  }
  /** Mark only the caller's delivered revision as read; repeated acknowledgements are harmless. */
  async markRead(c: ResearchContext, id: string, version: number) {
    requireValue(Number.isInteger(version) && version > 0, "invalid_version");
    return this.db.transaction(async (m) => {
      const a = await this.actor(m, c),
        row = await this.row(m, c, id);
      await this.access(m, c, a, row);
      const [r] = await m.query(
        "SELECT id FROM research_revisions WHERE tenant_id=? AND recommendation_id=? AND version=?",
        [c.tenantId, id, version],
      );
      requireValue(r, "revision_not_found", 404);
      await m.query(
        "UPDATE research_deliveries SET read_at=COALESCE(read_at,?) WHERE tenant_id=? AND revision_id=? AND membership_id=? AND channel='dashboard'",
        [this.now(), c.tenantId, r.id, a.membershipId],
      );
      return { ok: true };
    });
  }
  /** Download only files frozen into an authorized report revision; reauthorize and verify integrity after storage I/O. */
  async download(c: ResearchContext, id: string, fileId: string) {
    /** Recheck current membership and the immutable attachment grant before and after provider I/O. */
    const authorize = () =>
      this.db.transaction(async (m) => {
        const a = await this.actor(m, c),
          row = await this.row(m, c, id);
        await this.access(m, c, a, row);
        const revisions: { snapshot_cipher: string }[] = await m.query(
          "SELECT snapshot_cipher FROM research_revisions WHERE tenant_id=? AND recommendation_id=?",
          [c.tenantId, id],
        );
        const allowed = revisions
          .flatMap(
            (r) =>
              unseal<ResearchSnapshot>(this.key, r.snapshot_cipher).attachments,
          )
          .find((f) => f.id === fileId);
        requireValue(allowed, "attachment_not_found", 404);
        const [file] = await m.query(
          "SELECT * FROM documents WHERE tenant_id=? AND id=? AND kind='general' AND customer_id IS NULL",
          [c.tenantId, fileId],
        );
        requireValue(
          file && file.sha256 === allowed.sha256,
          "attachment_not_found",
          404,
        );
        return file;
      });
    const file = await authorize();
    requireValue(this.drive, "document_storage_unavailable", 503);
    await this.drive.verify();
    const bytes = await this.drive.download(
      file.drive_file_id,
      file.drive_folder_id,
    );
    requireValue(
      bytes.length === Number(file.byte_size) &&
        createHash("sha256").update(bytes).digest("hex") === file.sha256,
      "document_integrity_failed",
      502,
    );
    await authorize();
    return {
      bytes,
      name: file.original_name as string,
      mime: file.mime_type as string,
    };
  }
}

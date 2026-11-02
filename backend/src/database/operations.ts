import { randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import { sectionIds, tenantSchema } from "@ra/contracts";
import { canAccessTenant } from "../access/authorization";
import {
  canonicalJson,
  digest,
  validateSnapshot,
  type Snapshot,
} from "../../../database/snapshots";

export type Operation = { token: string; tenantId: string; key: string };
type LockedActor = {
  userId: string;
  membershipId: string | null;
  role: string | null;
};
type Receipt = {
  id?: string;
  revision?: number;
  version?: number;
  membershipId?: string;
};

/** Carry stable domain failures without exposing SQL, credentials or cross-tenant records. */
export class DatabaseConflict extends Error {
  /** Attach a safe machine-readable reason for application handlers. */
  constructor(public readonly code: string) {
    super(code);
  }
}

/** Transactional tenant foundation operations; callers must obtain tokens through the authentication boundary. */
export class TenantOperations {
  /** Retain the application-owned bounded MariaDB pool. */
  constructor(private readonly db: DataSource) {}

  /** Verify authoritative session storage without trusting client-supplied identity or role. */
  private async session(
    manager: EntityManager,
    token: string,
    current = false,
  ) {
    const [row] = await manager.query(
      "SELECT u.id,u.platform_role,u.email_verified FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>UTC_TIMESTAMP(3)" +
        (current ? " LOCK IN SHARE MODE" : ""),
      [token],
    );
    if (!row) throw new DatabaseConflict("unauthorized");
    return row as {
      id: string;
      platform_role: string | null;
      email_verified: number;
    };
  }

  /** Lock actor, tenant and membership in a consistent order, then evaluate current capabilities. */
  private async authorize(
    manager: EntityManager,
    context: Operation,
    capability: "website:edit" | "staff:manage" | "enroll",
  ) {
    const session = await this.session(manager, context.token);
    const [user] = await manager.query(
      "SELECT id,platform_role,email_verified FROM auth_users WHERE id=? FOR UPDATE",
      [session.id],
    );
    const [tenant] = await manager.query(
      "SELECT * FROM tenants WHERE id=? FOR UPDATE",
      [context.tenantId],
    );
    if (!tenant || tenant.status !== "active")
      throw new DatabaseConflict("tenant_unavailable");
    const [member] = await manager.query(
      "SELECT * FROM tenant_memberships WHERE tenant_id=? AND user_id=? FOR UPDATE",
      [tenant.id, user.id],
    );
    if (capability === "enroll") {
      if (!user.email_verified || member?.status === "revoked")
        throw new DatabaseConflict("enrollment_unavailable");
      if (member && member.role !== "subscriber")
        throw new DatabaseConflict("staff_only");
    } else if (
      !member ||
      !canAccessTenant(
        { userId: user.id, platformRole: null },
        tenant,
        [
          {
            userId: member.user_id,
            tenantId: member.tenant_id,
            role: member.role,
            status: member.status,
          },
        ],
        capability,
      )
    )
      throw new DatabaseConflict("forbidden");
    if (member) {
      const overrides = JSON.parse(member.capabilities_json);
      if (overrides.allow?.length || overrides.deny?.length)
        throw new DatabaseConflict("capability_overrides_not_enabled");
    }
    await this.session(manager, context.token, true);
    return {
      tenant,
      actor: {
        userId: user.id,
        membershipId: member?.id ?? null,
        role: member?.role ?? null,
      } as LockedActor,
    };
  }

  /** Return an authorized committed retry result or reject a reused key with different semantics. */
  private async replay(
    manager: EntityManager,
    context: Operation,
    actor: LockedActor,
    action: string,
    request: unknown,
  ): Promise<Receipt | null> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        context.key,
      )
    )
      throw new DatabaseConflict("invalid_operation_key");
    const [receipt] = await manager.query(
      "SELECT tenant_id,actor_user_id,action,request_sha256,metadata_json FROM audit_events WHERE operation_key=? LOCK IN SHARE MODE",
      [context.key],
    );
    if (!receipt) return null;
    if (
      receipt.tenant_id !== context.tenantId ||
      receipt.actor_user_id !== actor.userId ||
      receipt.action !== action ||
      receipt.request_sha256 !==
        digest({
          actor: actor.userId,
          tenant: context.tenantId,
          action,
          request,
        })
    )
      throw new DatabaseConflict("idempotency_conflict");
    return JSON.parse(receipt.metadata_json).operationResult;
  }

  /** Commit the operation receipt with its business writes in the same transaction. */
  private async receipt(
    manager: EntityManager,
    context: Operation,
    actor: LockedActor,
    action: string,
    request: unknown,
    result: Receipt,
  ) {
    await this.session(manager, context.token, true);
    await manager.query(
      "INSERT INTO audit_events(id,scope,tenant_id,actor_type,actor_user_id,actor_membership_id,action,entity_type,entity_id,metadata_json,operation_key,request_sha256) VALUES (?,'tenant',?,'user',?,?,?,?,?,?,?,?)",
      [
        randomUUID(),
        context.tenantId,
        actor.userId,
        actor.membershipId,
        action,
        action.startsWith("website") ? "website" : "tenant",
        result.id ?? result.membershipId ?? context.tenantId,
        canonicalJson({ schemaVersion: 1, operationResult: result }),
        context.key,
        digest({
          actor: actor.userId,
          tenant: context.tenantId,
          action,
          request,
        }),
      ],
    );
  }

  /** Read the latest private draft or current publication only after fresh tenant authorization. */
  async readWebsite(context: Operation) {
    return this.db.transaction(async (manager) => {
      const { tenant } = await this.authorize(manager, context, "website:edit");
      const [row] = await manager.query(
        "SELECT * FROM website_revisions WHERE tenant_id=? AND (status='draft' OR revision=?) ORDER BY (status='draft') DESC,revision DESC LIMIT 1",
        [tenant.id, tenant.published_revision],
      );
      if (!row)
        return {
          id: null,
          revision: 0,
          version: 0,
          snapshot: {
            schemaVersion: 1 as const,
            publicProfile: {
              name: tenant.display_name,
              legalName: tenant.legal_name,
              registration: tenant.registration_number,
              monogram: tenant.monogram,
            },
            branding: {
              accent: "#244b3b",
              surface: "#edf2ec",
              font: "classic" as const,
            },
            languages: { default: "en" as const, enabled: ["en" as const] },
            layout: { template: "classic" as const, sections: [...sectionIds] },
            content: { en: {} },
          },
        };
      const stored =
        typeof row.snapshot_json === "string"
          ? JSON.parse(row.snapshot_json)
          : row.snapshot_json;
      if (digest(stored) !== row.snapshot_sha256)
        throw new DatabaseConflict("invalid_snapshot_checksum");
      return {
        id: row.status === "draft" ? row.id : null,
        revision: row.revision,
        version: row.status === "draft" ? row.lock_version : 0,
        snapshot: validateSnapshot(stored),
      };
    });
  }

  /** Create a partial website draft from the current publication generation, safely replaying retries. */
  async createDraft(context: Operation, input: unknown) {
    const snapshot = validateSnapshot(input);
    const action = "website.draft_created";
    return this.db.transaction(async (manager) => {
      const { tenant, actor } = await this.authorize(
        manager,
        context,
        "website:edit",
      );
      const replay = await this.replay(
        manager,
        context,
        actor,
        action,
        snapshot,
      );
      if (replay) return replay;
      const [{ next }] = await manager.query(
        "SELECT COALESCE(MAX(revision),0)+1 AS next FROM website_revisions WHERE tenant_id=? FOR UPDATE",
        [tenant.id],
      );
      const result = { id: randomUUID(), revision: Number(next), version: 1 };
      await manager.query(
        "INSERT INTO website_revisions(id,tenant_id,revision,base_revision,base_publication_version,snapshot_json,snapshot_sha256,created_by) VALUES (?,?,?,?,?,?,?,?)",
        [
          result.id,
          tenant.id,
          result.revision,
          tenant.published_revision,
          tenant.publication_version,
          canonicalJson(snapshot),
          digest(snapshot),
          actor.membershipId,
        ],
      );
      await this.receipt(manager, context, actor, action, snapshot, result);
      return result;
    });
  }

  /** Save or explicitly rebase a draft using optimistic versions; historical publications remain immutable. */
  async saveDraft(
    context: Operation,
    id: string,
    version: number,
    input: unknown,
    rebase = false,
  ) {
    const snapshot = validateSnapshot(input);
    const action = rebase ? "website.draft_rebased" : "website.draft_saved";
    const request = { id, version, snapshot, rebase };
    return this.db.transaction(async (manager) => {
      const { tenant, actor } = await this.authorize(
        manager,
        context,
        "website:edit",
      );
      const replay = await this.replay(
        manager,
        context,
        actor,
        action,
        request,
      );
      if (replay) return replay;
      const [draft] = await manager.query(
        "SELECT * FROM website_revisions WHERE tenant_id=? AND id=? FOR UPDATE",
        [tenant.id, id],
      );
      if (!draft || draft.status !== "draft" || draft.lock_version !== version)
        throw new DatabaseConflict("stale_draft");
      await manager.query(
        "UPDATE website_revisions SET snapshot_json=?,snapshot_sha256=?,base_revision=?,base_publication_version=?,lock_version=lock_version+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",
        [
          canonicalJson(snapshot),
          digest(snapshot),
          rebase ? tenant.published_revision : draft.base_revision,
          rebase ? tenant.publication_version : draft.base_publication_version,
          tenant.id,
          id,
        ],
      );
      const result = { id, revision: draft.revision, version: version + 1 };
      await this.receipt(manager, context, actor, action, request, result);
      return result;
    });
  }

  /** Publish a complete draft only against its captured base; replay success before checking stale versions. */
  async publish(context: Operation, id: string, version: number) {
    const action = "website.published";
    const request = { id, version };
    return this.db.transaction(async (manager) => {
      const { tenant, actor } = await this.authorize(
        manager,
        context,
        "website:edit",
      );
      const replay = await this.replay(
        manager,
        context,
        actor,
        action,
        request,
      );
      if (replay) return replay;
      const [draft] = await manager.query(
        "SELECT * FROM website_revisions WHERE tenant_id=? AND id=? FOR UPDATE",
        [tenant.id, id],
      );
      if (!draft || draft.status !== "draft" || draft.lock_version !== version)
        throw new DatabaseConflict("stale_draft");
      if (
        draft.base_revision !== tenant.published_revision ||
        draft.base_publication_version !== tenant.publication_version
      )
        throw new DatabaseConflict("stale_publication");
      const stored = JSON.parse(draft.snapshot_json);
      if (digest(stored) !== draft.snapshot_sha256)
        throw new DatabaseConflict("invalid_snapshot_checksum");
      validateSnapshot(stored, true);
      await manager.query(
        "UPDATE website_revisions SET status='published',published_by=?,published_at=UTC_TIMESTAMP(3),lock_version=lock_version+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",
        [actor.membershipId, tenant.id, id],
      );
      await manager.query(
        "UPDATE tenants SET published_revision=?,publication_version=publication_version+1,lock_version=lock_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",
        [draft.revision, tenant.id],
      );
      const result = { id, revision: draft.revision, version: version + 1 };
      await this.receipt(manager, context, actor, action, request, result);
      return result;
    });
  }

  /** Explicitly remove public availability without falling back to a historical revision. */
  async unpublish(context: Operation) {
    return this.db.transaction(async (manager) => {
      const { actor } = await this.authorize(manager, context, "website:edit");
      const replay = await this.replay(
        manager,
        context,
        actor,
        "website.unpublished",
        {},
      );
      if (replay) return replay;
      await manager.query(
        "UPDATE tenants SET published_revision=NULL,publication_version=publication_version+1,lock_version=lock_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",
        [context.tenantId],
      );
      const result = { id: context.tenantId };
      await this.receipt(
        manager,
        context,
        actor,
        "website.unpublished",
        {},
        result,
      );
      return result;
    });
  }

  /** Enroll verified subscribers only; staff identities in this RA must use another email, and revoked membership never reactivates. */
  async enroll(context: Operation) {
    return this.db.transaction(async (manager) => {
      const { actor } = await this.authorize(manager, context, "enroll");
      const replay = await this.replay(
        manager,
        context,
        actor,
        "membership.enrolled",
        {},
      );
      if (replay) return replay;
      if (!actor.membershipId) {
        actor.membershipId = randomUUID();
        await manager.query(
          "INSERT INTO tenant_memberships(id,tenant_id,user_id,profile_json,capabilities_json) VALUES (?,?,?,?,?)",
          [
            actor.membershipId,
            context.tenantId,
            actor.userId,
            canonicalJson({ schemaVersion: 1 }),
            canonicalJson({ schemaVersion: 1, allow: [], deny: [] }),
          ],
        );
      }
      const result = { membershipId: actor.membershipId! };
      await this.receipt(
        manager,
        context,
        actor,
        "membership.enrolled",
        {},
        result,
      );
      return result;
    });
  }

  /** Review role/reactivation explicitly and preserve the last active owner; overrides stay empty in this foundation. */
  async changeMembership(
    context: Operation,
    id: string,
    version: number,
    role: "owner" | "analyst" | "support" | "subscriber",
    active: boolean,
  ) {
    if (!["owner", "analyst", "support", "subscriber"].includes(role))
      throw new DatabaseConflict("invalid_role");
    const request = { id, version, role, active };
    return this.db.transaction(async (manager) => {
      // Updating a member can require an InnoDB parent-identity FK lock. Acquire
      // every affected identity before tenant locks to avoid revoke/publish cycles.
      const caller = await this.session(manager, context.token);
      const [target] = await manager.query(
        "SELECT user_id FROM tenant_memberships WHERE tenant_id=? AND id=?",
        [context.tenantId, id],
      );
      const userIds = [
        ...new Set(
          [caller.id, target?.user_id].filter(
            (value): value is string => typeof value === "string",
          ),
        ),
      ].sort();
      for (const userId of userIds)
        await manager.query("SELECT id FROM auth_users WHERE id=? FOR UPDATE", [
          userId,
        ]);
      const { actor } = await this.authorize(manager, context, "staff:manage");
      const replay = await this.replay(
        manager,
        context,
        actor,
        "membership.changed",
        request,
      );
      if (replay) return replay;
      const [member] = await manager.query(
        "SELECT * FROM tenant_memberships WHERE tenant_id=? AND id=? FOR UPDATE",
        [context.tenantId, id],
      );
      if (!member || member.lock_version !== version)
        throw new DatabaseConflict("stale_membership");
      if (role === "owner" || member.role === "owner") {
        const currentCaller = await this.session(manager, context.token, true);
        if (currentCaller.platform_role !== "owner")
          throw new DatabaseConflict("forbidden");
      }
      if (
        member.role !== role &&
        (member.role === "subscriber" || role === "subscriber")
      )
        throw new DatabaseConflict("role_category_conflict");
      const owners = await manager.query(
        "SELECT id,capabilities_json FROM tenant_memberships WHERE tenant_id=? AND role='owner' AND status='active' FOR UPDATE",
        [context.tenantId],
      );
      if (
        member.role === "owner" &&
        member.status === "active" &&
        (!active || role !== "owner") &&
        !owners.some((owner: { id: string; capabilities_json: string }) => {
          const overrides = JSON.parse(owner.capabilities_json);
          return (
            owner.id !== id &&
            !overrides.allow?.length &&
            !overrides.deny?.length
          );
        })
      )
        throw new DatabaseConflict("last_owner");
      await manager.query(
        "UPDATE tenant_memberships SET role=?,status=?,revoked_at=?,capabilities_json=?,lock_version=lock_version+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",
        [
          role,
          active ? "active" : "revoked",
          active ? null : new Date(),
          canonicalJson({ schemaVersion: 1, allow: [], deny: [] }),
          context.tenantId,
          id,
        ],
      );
      const result = { membershipId: id, version: version + 1 };
      await this.receipt(
        manager,
        context,
        actor,
        "membership.changed",
        request,
        result,
      );
      return result;
    });
  }

  /** Provision a real managed tenant, effective first owner and initial draft atomically from an existing verified identity. */
  async provision(
    context: Operation,
    tenantInput: unknown,
    ownerUserId: string,
    snapshotInput: unknown,
  ) {
    const tenant = tenantSchema.parse(tenantInput);
    const snapshot: Snapshot = validateSnapshot(snapshotInput);
    if (
      tenant.id !== context.tenantId ||
      tenant.synthetic ||
      tenant.status !== "active"
    )
      throw new DatabaseConflict("invalid_provisioning");
    const request = { tenant, ownerUserId, snapshot };
    return this.db.transaction(async (manager) => {
      const user = await this.session(manager, context.token);
      const ids = [...new Set([user.id, ownerUserId])].sort();
      const users = [];
      for (const id of ids) {
        const [record] = await manager.query(
          "SELECT * FROM auth_users WHERE id=? FOR UPDATE",
          [id],
        );
        if (record) users.push(record);
      }
      if (
        !users.some(
          (row) => row.id === user.id && row.platform_role === "owner",
        ) ||
        !users.some((row) => row.id === ownerUserId && row.email_verified)
      )
        throw new DatabaseConflict("forbidden");
      const actor: LockedActor = {
        userId: user.id,
        membershipId: null,
        role: null,
      };
      const replay = await this.replay(
        manager,
        context,
        actor,
        "tenant.provisioned",
        request,
      );
      if (replay) return replay;
      await manager.query(
        "INSERT INTO tenants(id,slug,status,is_synthetic,display_name,legal_name,registration_number,monogram,settings_json) VALUES (?,?,'draft',0,?,?,?,?,?)",
        [
          tenant.id,
          tenant.slug,
          tenant.profile.name,
          tenant.profile.legalName,
          tenant.profile.registration,
          tenant.profile.monogram,
          canonicalJson({ schemaVersion: 1 }),
        ],
      );
      const membershipId = randomUUID();
      const draftId = randomUUID();
      await manager.query(
        "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,profile_json,capabilities_json) VALUES (?,?,?,'owner',?,?)",
        [
          membershipId,
          tenant.id,
          ownerUserId,
          canonicalJson({ schemaVersion: 1 }),
          canonicalJson({ schemaVersion: 1, allow: [], deny: [] }),
        ],
      );
      await manager.query(
        "INSERT INTO website_revisions(id,tenant_id,revision,base_publication_version,snapshot_json,snapshot_sha256) VALUES (?,?,1,0,?,?)",
        [draftId, tenant.id, canonicalJson(snapshot), digest(snapshot)],
      );
      await manager.query("UPDATE tenants SET status='active' WHERE id=?", [
        tenant.id,
      ]);
      const result = { id: tenant.id, membershipId, revision: 1 };
      await this.receipt(
        manager,
        context,
        actor,
        "tenant.provisioned",
        request,
        result,
      );
      return result;
    });
  }
}

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import { tenantSchema, type Tenant } from "@ra/contracts";
import { DatabaseConflict } from "../database/operations";
import { canInvite, mergeInvitationRole, type StaffRole } from "./policy";

type Actor = {
  id: string;
  email: string;
  email_verified: number;
  platform_role: string | null;
};
type Invite = {
  id: string;
  tenant_id: string;
  email: string;
  role: StaffRole;
  created_by: string;
  accepted_at: string | null;
  revoked_at: string | null;
};
/** Hash an unguessable invitation credential before it crosses the persistence boundary. */
function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
/** Validate the exact supported invitation grant, without accepting subscriber or platform roles. */
function validRole(role: string): asserts role is StaffRole {
  if (!["owner", "analyst", "support"].includes(role))
    throw new DatabaseConflict("invalid_role");
}
/** Project a minimal tenant identity without exposing administrative settings. */
function tenant(row: Record<string, unknown>): Tenant {
  return tenantSchema.parse({
    id: row.id,
    slug: row.slug,
    status: row.status,
    synthetic: Boolean(row.is_synthetic),
    profile: {
      name: row.display_name,
      legalName: row.legal_name,
      registration: row.registration_number ?? null,
      monogram: row.monogram,
    },
  });
}

/** Authorize platform setup and tenant invitations against current database facts in every transaction. */
export class OrganisationService {
  /** Use the runtime-owned pool, never a client-supplied identity or role. */
  constructor(private readonly db: DataSource) {}
  /** Resolve a currently valid session and its current authoritative identity. */
  private async actor(
    query: Pick<EntityManager, "query">,
    token: string,
    lock = false,
  ): Promise<Actor> {
    const [row] = await query.query(
      "SELECT u.id,u.email,u.email_verified,u.platform_role FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>UTC_TIMESTAMP(3)" +
        (lock ? " LOCK IN SHARE MODE" : ""),
      [token],
    );
    if (!row) throw new DatabaseConflict("unauthorized");
    return row;
  }
  /** Resolve the separate platform-owner permission without granting tenant membership. */
  async isPlatformOwner(token: string) {
    const actor = await this.actor(this.db, token);
    return actor.platform_role === "owner" && !!actor.email_verified;
  }
  /** Lock the actor before a tenant to serialize invitations with membership changes and revocation. */
  private async issuer(
    manager: EntityManager,
    token: string,
    tenantId: string,
    role: StaffRole,
  ) {
    const identity = await this.actor(manager, token);
    const [actor] = await manager.query(
      "SELECT id,email,email_verified,platform_role FROM auth_users WHERE id=? FOR UPDATE",
      [identity.id],
    );
    const [row] = await manager.query(
      "SELECT * FROM tenants WHERE id=? FOR UPDATE",
      [tenantId],
    );
    if (!row || !["active", "draft"].includes(row.status))
      throw new DatabaseConflict("tenant_unavailable");
    const [member] = await manager.query(
      "SELECT id,role,status,capabilities_json FROM tenant_memberships WHERE tenant_id=? AND user_id=? FOR UPDATE",
      [tenantId, actor.id],
    );
    const overrides = member ? JSON.parse(member.capabilities_json) : {};
    const memberRole =
      member?.status === "active" &&
      !overrides.allow?.length &&
      !overrides.deny?.length
        ? member.role
        : null;
    if (
      !actor.email_verified ||
      !canInvite(actor.platform_role === "owner", memberRole, role) ||
      (row.status === "draft" && actor.platform_role !== "owner")
    )
      throw new DatabaseConflict("forbidden");
    await this.actor(manager, token, true);
    return { actor: actor as Actor, tenant: tenant(row) };
  }
  /** Append minimal evidence in the same transaction as each administrative change. */
  private async audit(
    manager: EntityManager,
    actorId: string,
    tenantId: string | null,
    action: string,
    entity: string,
    id: string,
  ) {
    await manager.query(
      "INSERT INTO audit_events(id,scope,tenant_id,actor_type,actor_user_id,action,entity_type,entity_id,metadata_json) VALUES (?,?,?,'user',?,?,?,?,?)",
      [
        randomUUID(),
        tenantId ? "tenant" : "platform",
        tenantId,
        actorId,
        action,
        entity,
        id,
        JSON.stringify({ schemaVersion: 1 }),
      ],
    );
  }
  /** Create an unpublished draft organisation; no account passwords or invented website content are generated. */
  async create(
    token: string,
    input: {
      slug: string;
      name: string;
      legalName: string;
      monogram: string;
      registration?: string;
    },
  ) {
    const record = tenantSchema.parse({
      id: randomUUID(),
      slug: input.slug,
      status: "draft",
      synthetic: false,
      profile: {
        name: input.name,
        legalName: input.legalName,
        monogram: input.monogram,
        registration: input.registration || null,
      },
    });
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, token, true);
      if (actor.platform_role !== "owner" || !actor.email_verified)
        throw new DatabaseConflict("forbidden");
      await manager.query(
        "INSERT INTO tenants(id,slug,status,is_synthetic,display_name,legal_name,registration_number,monogram,settings_json) VALUES (?,?,'draft',0,?,?,?,?,?)",
        [
          record.id,
          record.slug,
          record.profile.name,
          record.profile.legalName,
          record.profile.registration,
          record.profile.monogram,
          '{"schemaVersion":1}',
        ],
      );
      await this.audit(
        manager,
        actor.id,
        record.id,
        "organisation.created",
        "tenant",
        record.id,
      );
      return record;
    });
  }
  /** List organisations only for a verified platform owner. */
  async list(token: string) {
    if (!(await this.isPlatformOwner(token)))
      throw new DatabaseConflict("forbidden");
    const rows: Record<string, unknown>[] = await this.db.query(
      "SELECT t.*, (SELECT COUNT(*) FROM tenant_memberships m WHERE m.tenant_id=t.id AND m.role='owner' AND m.status='active') AS administrators FROM tenants t ORDER BY t.slug",
    );
    return rows.map((row: Record<string, unknown>) => ({
      ...tenant(row),
      administrators: Number(row.administrators),
    }));
  }
  /** Create a one-hour invitation and revoke prior pending grants to the same identity in this tenant. */
  async invite(token: string, tenantId: string, email: string, role: string) {
    validRole(role);
    email = email.trim().toLowerCase();
    if (email.length > 254 || !/^\S+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new DatabaseConflict("invalid_email");
    const credential = randomBytes(32).toString("hex"),
      id = randomUUID();
    return this.db.transaction(async (manager) => {
      const { actor, tenant: record } = await this.issuer(
        manager,
        token,
        tenantId,
        role,
      );
      await manager.query(
        "UPDATE organisation_invitations SET revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL",
        [tenantId, email],
      );
      await manager.query(
        "INSERT INTO organisation_invitations(id,tenant_id,email,role,created_by,token_hash,expires_at) VALUES (?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR))",
        [id, tenantId, email, role, actor.id, hash(credential)],
      );
      await this.audit(
        manager,
        actor.id,
        tenantId,
        "organisation.invited",
        "invitation",
        id,
      );
      return { id, token: credential, email, role, tenant: record };
    });
  }
  /** Persist delivery outcome without retaining bearer credentials or provider responses. */
  async delivered(id: string, sent: boolean) {
    await this.db.query(
      "UPDATE organisation_invitations SET delivery_status=? WHERE id=?",
      [sent ? "sent" : "failed", id],
    );
  }
  /** Return an invitation only while its stored grant is pending and valid for the exact tenant route. */
  async preview(slug: string, credential: string) {
    if (!/^[a-f0-9]{64}$/.test(credential)) return null;
    const [invite]: Invite[] = await this.db.query(
      "SELECT * FROM organisation_invitations WHERE token_hash=? AND expires_at>UTC_TIMESTAMP(3) AND accepted_at IS NULL AND revoked_at IS NULL",
      [hash(credential)],
    );
    if (!invite) return null;
    const [row] = await this.db.query(
      "SELECT * FROM tenants WHERE id=? AND slug=? AND status IN ('active','draft')",
      [invite.tenant_id, slug],
    );
    if (!row) return null;
    return { tenant: tenant(row), email: invite.email, role: invite.role };
  }
  /** List redacted pending/accepted/revoked invitation state after fresh staff-management authorization. */
  async invitations(token: string, tenantId: string) {
    return this.db.transaction(async (manager) => {
      await this.issuer(manager, token, tenantId, "analyst");
      return manager.query(
        "SELECT id,email,role,delivery_status,expires_at,accepted_at,revoked_at FROM organisation_invitations WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100",
        [tenantId],
      );
    });
  }
  /** Consume the stored grant for a verified matching identity; never reactivate a revoked member. */
  async accept(token: string, tenantId: string, credential: string) {
    if (!/^[a-f0-9]{64}$/.test(credential))
      throw new DatabaseConflict("invitation_unavailable");
    return this.db.transaction(async (manager) => {
      const identity = await this.actor(manager, token);
      const [hint]: Invite[] = await manager.query(
        "SELECT * FROM organisation_invitations WHERE token_hash=? AND expires_at>UTC_TIMESTAMP(3)",
        [hash(credential)],
      );
      if (!hint || hint.tenant_id !== tenantId)
        throw new DatabaseConflict("invitation_unavailable");
      const users: Actor[] = [];
      for (const id of [...new Set([identity.id, hint.created_by])].sort()) {
        const [row] = await manager.query(
          "SELECT id,email,email_verified,platform_role FROM auth_users WHERE id=? FOR UPDATE",
          [id],
        );
        if (row) users.push(row);
      }
      const recipient = users.find((u) => u.id === identity.id),
        sender = users.find((u) => u.id === hint.created_by);
      const [row] = await manager.query(
        "SELECT * FROM tenants WHERE id=? FOR UPDATE",
        [tenantId],
      );
      const [invite]: Invite[] = await manager.query(
        "SELECT * FROM organisation_invitations WHERE token_hash=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE",
        [hash(credential)],
      );
      if (
        !recipient?.email_verified ||
        !sender?.email_verified ||
        !row ||
        !["active", "draft"].includes(row.status) ||
        !invite ||
        invite.tenant_id !== tenantId ||
        invite.email !== recipient.email ||
        invite.accepted_at ||
        invite.revoked_at
      )
        throw new DatabaseConflict("invitation_unavailable");
      const [issuer] = await manager.query(
        "SELECT role,status,capabilities_json FROM tenant_memberships WHERE tenant_id=? AND user_id=? FOR UPDATE",
        [tenantId, sender.id],
      );
      const permissions = issuer ? JSON.parse(issuer.capabilities_json) : {};
      const role =
        issuer?.status === "active" &&
        !permissions.allow?.length &&
        !permissions.deny?.length
          ? issuer.role
          : null;
      if (!canInvite(sender.platform_role === "owner", role, invite.role))
        throw new DatabaseConflict("invitation_unavailable");
      const [member] = await manager.query(
        "SELECT id,role,status FROM tenant_memberships WHERE tenant_id=? AND user_id=? FOR UPDATE",
        [tenantId, recipient.id],
      );
      if (member?.status === "revoked")
        throw new DatabaseConflict("membership_revoked");
      const granted = mergeInvitationRole(member?.role ?? null, invite.role);
      if (member)
        await manager.query(
          "UPDATE tenant_memberships SET role=?,lock_version=lock_version+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",
          [granted, tenantId, member.id],
        );
      else
        await manager.query(
          "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,profile_json,capabilities_json) VALUES (?,?,?,?,?,?)",
          [
            randomUUID(),
            tenantId,
            recipient.id,
            granted,
            '{"schemaVersion":1}',
            '{"schemaVersion":1,"allow":[],"deny":[]}',
          ],
        );
      if (row.status === "draft" && granted === "owner")
        await manager.query(
          "UPDATE tenants SET status='active',updated_at=UTC_TIMESTAMP(3) WHERE id=?",
          [tenantId],
        );
      await manager.query(
        "UPDATE organisation_invitations SET accepted_at=UTC_TIMESTAMP(3),accepted_by=? WHERE id=?",
        [recipient.id, invite.id],
      );
      await this.actor(manager, token, true);
      await this.audit(
        manager,
        recipient.id,
        tenantId,
        "organisation.invitation_accepted",
        "invitation",
        invite.id,
      );
      return { role: granted };
    });
  }
}

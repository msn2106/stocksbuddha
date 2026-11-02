import { hashPassword } from "better-auth/crypto";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import { tenantSchema, type Tenant } from "@ra/contracts";
import { DatabaseConflict } from "../database/operations";
import { canInvite, invitationRoleConflict, type StaffRole } from "./policy";

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
  full_name: string | null;
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
/** Require a printable recipient name before persisting or personalizing mail. */
function recipientName(input: unknown): string {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.trim().length > 100 ||
    [...input].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new DatabaseConflict("invalid_name");
  return input.trim();
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
    adminOnly = false,
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
      (adminOnly && (memberRole !== "owner" || row.status !== "active")) ||
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
  /** Check the recipient in this RA after its tenant lock; never disclose other organisations or change a stored role. */
  private async recipientRole(
    manager: EntityManager,
    tenantId: string,
    email: string,
    role: StaffRole,
  ) {
    const [member] = await manager.query(
      "SELECT m.role,m.status FROM tenant_memberships m JOIN auth_users u ON u.id=m.user_id WHERE m.tenant_id=? AND u.email=?",
      [tenantId, email],
    );
    if (member?.status === "revoked")
      throw new DatabaseConflict("membership_revoked");
    const conflict = invitationRoleConflict(member?.role ?? null, role);
    if (conflict) throw new DatabaseConflict(conflict);
  }
  /** Create a one-hour invitation and revoke prior pending grants to the same identity in this tenant. */
  async invite(
    token: string,
    tenantId: string,
    email: string,
    role: string,
    fullName: string,
  ) {
    validRole(role);
    fullName = recipientName(fullName);
    email = email.trim().toLowerCase();
    if (email.length > 254 || !/^\S+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new DatabaseConflict("invalid_email");
    const credential = randomBytes(32).toString("hex"),
      id = randomUUID();
    return this.db.transaction("READ COMMITTED", async (manager) => {
      const { actor, tenant: record } = await this.issuer(
        manager,
        token,
        tenantId,
        role,
      );
      await this.recipientRole(manager, tenantId, email, role);
      await manager.query(
        "UPDATE organisation_invitations SET revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL",
        [tenantId, email],
      );
      await manager.query(
        "INSERT INTO organisation_invitations(id,tenant_id,email,role,created_by,token_hash,full_name,expires_at) VALUES (?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR))",
        [id, tenantId, email, role, actor.id, hash(credential), fullName],
      );
      await this.audit(
        manager,
        actor.id,
        tenantId,
        "organisation.invited",
        "invitation",
        id,
      );
      return { id, token: credential, email, role, fullName, tenant: record };
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
    const [account] = await this.db.query(
      "SELECT id FROM auth_users WHERE email=?",
      [invite.email],
    );
    return {
      tenant: tenant(row),
      email: invite.email,
      role: invite.role,
      fullName: invite.full_name,
      accountExists: !!account,
    };
  }
  /** List redacted pending/accepted/revoked invitation state after fresh staff-management authorization. */
  async invitations(token: string, tenantId: string) {
    return this.db.transaction(async (manager) => {
      await this.issuer(manager, token, tenantId, "analyst");
      return manager.query(
        "SELECT id,email,full_name,role,delivery_status,expires_at,accepted_at,revoked_at FROM organisation_invitations WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100",
        [tenantId],
      );
    });
  }
  /** Replace a pending grant using its stored recipient and role, after a fresh tenant-admin check. */
  async resend(
    token: string,
    tenantId: string,
    invitationId: string,
    fullName?: string,
  ) {
    return this.db.transaction("READ COMMITTED", async (manager) => {
      const { actor, tenant: record } = await this.issuer(
        manager,
        token,
        tenantId,
        "analyst",
        true,
      );
      const [invite]: Invite[] = await manager.query(
        "SELECT * FROM organisation_invitations WHERE tenant_id=? AND id=? FOR UPDATE",
        [tenantId, invitationId],
      );
      if (
        !invite ||
        invite.accepted_at ||
        invite.revoked_at ||
        invite.role === "owner"
      )
        throw new DatabaseConflict("invitation_unavailable");
      const name = recipientName(invite.full_name ?? fullName);
      await this.recipientRole(manager, tenantId, invite.email, invite.role);
      const credential = randomBytes(32).toString("hex"),
        id = randomUUID();
      await manager.query(
        "UPDATE organisation_invitations SET revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL",
        [tenantId, invite.email],
      );
      await manager.query(
        "INSERT INTO organisation_invitations(id,tenant_id,email,role,created_by,token_hash,full_name,expires_at) VALUES (?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR))",
        [
          id,
          tenantId,
          invite.email,
          invite.role,
          actor.id,
          hash(credential),
          name,
        ],
      );
      await this.audit(
        manager,
        actor.id,
        tenantId,
        "organisation.invitation_resent",
        "invitation",
        id,
      );
      return {
        id,
        token: credential,
        email: invite.email,
        role: invite.role,
        fullName: name,
        tenant: record,
      };
    });
  }
  /** List current tenant users so access can be revoked even when no invitation record exists. */
  async members(token: string, tenantId: string) {
    return this.db.transaction(async (manager) => {
      const { actor } = await this.issuer(
        manager,
        token,
        tenantId,
        "analyst",
        true,
      );
      const rows: {
        id: string;
        user_id: string;
        name: string;
        email: string;
        role: string;
        status: string;
      }[] = await manager.query(
        "SELECT m.id,m.user_id,u.name,u.email,m.role,m.status FROM tenant_memberships m JOIN auth_users u ON u.id=m.user_id WHERE m.tenant_id=? ORDER BY u.email",
        [tenantId],
      );
      return rows.map(({ user_id, ...member }) => ({
        ...member,
        canRevoke: user_id !== actor.id && member.status === "active",
      }));
    });
  }
  /** Cancel a pending invitation without granting access or changing the global identity. */
  async revokeInvitation(
    token: string,
    tenantId: string,
    invitationId: string,
  ) {
    return this.db.transaction(async (manager) => {
      const { actor } = await this.issuer(
        manager,
        token,
        tenantId,
        "analyst",
        true,
      );
      const [invite]: Invite[] = await manager.query(
        "SELECT * FROM organisation_invitations WHERE tenant_id=? AND id=? FOR UPDATE",
        [tenantId, invitationId],
      );
      if (!invite || invite.accepted_at || invite.revoked_at)
        throw new DatabaseConflict("invitation_unavailable");
      await manager.query(
        "UPDATE organisation_invitations SET revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",
        [tenantId, invitationId],
      );
      await this.audit(
        manager,
        actor.id,
        tenantId,
        "organisation.invitation_revoked",
        "invitation",
        invitationId,
      );
    });
  }
  /** Revoke another tenant user's membership and outstanding grants, preserving their other organisations. */
  async revokeMember(token: string, tenantId: string, membershipId: string) {
    return this.db.transaction(async (manager) => {
      const identity = await this.actor(manager, token);
      const [hint] = await manager.query(
        "SELECT user_id FROM tenant_memberships WHERE tenant_id=? AND id=?",
        [tenantId, membershipId],
      );
      if (!hint || hint.user_id === identity.id)
        throw new DatabaseConflict("membership_unavailable");
      // Match acceptance's sorted identity locks before taking the tenant lock.
      for (const id of [...new Set([identity.id, hint.user_id])].sort())
        await manager.query("SELECT id FROM auth_users WHERE id=? FOR UPDATE", [
          id,
        ]);
      const { actor } = await this.issuer(
        manager,
        token,
        tenantId,
        "analyst",
        true,
      );
      const [member] = await manager.query(
        "SELECT m.*,u.email FROM tenant_memberships m JOIN auth_users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.id=? FOR UPDATE",
        [tenantId, membershipId],
      );
      if (
        !member ||
        member.user_id !== hint.user_id ||
        member.status !== "active"
      )
        throw new DatabaseConflict("membership_unavailable");
      await manager.query(
        "UPDATE tenant_memberships SET status='revoked',revoked_at=UTC_TIMESTAMP(3),lock_version=lock_version+1,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",
        [tenantId, membershipId],
      );
      await manager.query(
        "UPDATE organisation_invitations SET revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL",
        [tenantId, member.email],
      );
      await this.audit(
        manager,
        actor.id,
        tenantId,
        "organisation.access_revoked",
        "membership",
        membershipId,
      );
    });
  }
  /** Consume the stored grant for a verified matching identity; never reactivate a revoked member. */
  async accept(token: string, tenantId: string, credential: string) {
    return this.consume(tenantId, credential, token);
  }
  /** Use the emailed credential to create a verified account and consume its grant atomically; never overwrite an existing account. */
  async register(
    tenantId: string,
    credential: string,
    name: string,
    password: string,
    clientAddress: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(credential))
      throw new DatabaseConflict("invitation_unavailable");
    name = recipientName(name);
    if (
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128
    )
      throw new DatabaseConflict("invalid_password");
    // Bound expensive password hashing with a shared, server-derived IP bucket.
    const allowed = await this.db.transaction(async (manager) => {
      const key = hash(`invitation-signup:${clientAddress}`);
      await manager.query(
        "INSERT INTO auth_rate_limits(bucket_key,hits,started_at,expires_at) VALUES (?,0,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND)) ON DUPLICATE KEY UPDATE bucket_key=VALUES(bucket_key)",
        [key],
      );
      const [bucket] = await manager.query(
        "SELECT hits,TIMESTAMPDIFF(SECOND,started_at,UTC_TIMESTAMP(3)) AS elapsed FROM auth_rate_limits WHERE bucket_key=? FOR UPDATE",
        [key],
      );
      const expired = Number(bucket.elapsed) >= 60;
      if (!expired && Number(bucket.hits) >= 10) return false;
      await manager.query(
        expired
          ? "UPDATE auth_rate_limits SET hits=1,started_at=UTC_TIMESTAMP(3),expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND) WHERE bucket_key=?"
          : "UPDATE auth_rate_limits SET hits=hits+1 WHERE bucket_key=?",
        [key],
      );
      return true;
    });
    if (!allowed) throw new DatabaseConflict("throttled");
    const passwordHash = await hashPassword(password);
    return this.consume(tenantId, credential, undefined, {
      name,
      passwordHash,
    });
  }
  /** Lock and validate the grant, issuer and recipient before one atomic identity/membership change. */
  private async consume(
    tenantId: string,
    credential: string,
    token?: string,
    registration?: { name: string; passwordHash: string },
  ) {
    if (!/^[a-f0-9]{64}$/.test(credential))
      throw new DatabaseConflict("invitation_unavailable");
    return this.db.transaction(async (manager) => {
      const identity = token ? await this.actor(manager, token) : null;
      const [hint]: Invite[] = await manager.query(
        "SELECT * FROM organisation_invitations WHERE token_hash=? AND expires_at>UTC_TIMESTAMP(3)",
        [hash(credential)],
      );
      if (!hint || hint.tenant_id !== tenantId)
        throw new DatabaseConflict("invitation_unavailable");
      const users: Actor[] = [];
      for (const id of [
        ...new Set(
          [identity?.id, hint.created_by].filter((id): id is string => !!id),
        ),
      ].sort()) {
        const [row] = await manager.query(
          "SELECT id,email,email_verified,platform_role FROM auth_users WHERE id=? FOR UPDATE",
          [id],
        );
        if (row) users.push(row);
      }
      let recipient = users.find((u) => u.id === identity?.id);
      const sender = users.find((u) => u.id === hint.created_by);
      const [row] = await manager.query(
        "SELECT * FROM tenants WHERE id=? FOR UPDATE",
        [tenantId],
      );
      const [invite]: Invite[] = await manager.query(
        "SELECT * FROM organisation_invitations WHERE token_hash=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE",
        [hash(credential)],
      );
      if (
        (!registration && !recipient?.email_verified) ||
        !sender?.email_verified ||
        !row ||
        !["active", "draft"].includes(row.status) ||
        !invite ||
        invite.tenant_id !== tenantId ||
        (!registration && invite.email !== recipient?.email) ||
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
      if (registration) {
        const [existing] = await manager.query(
          "SELECT id FROM auth_users WHERE email=? FOR UPDATE",
          [invite.email],
        );
        if (existing) throw new DatabaseConflict("account_exists");
        recipient = {
          id: randomUUID(),
          email: invite.email,
          email_verified: 1,
          platform_role: null,
        };
        await manager.query(
          "INSERT INTO auth_users(id,name,email,email_verified,signup_tenant_id) VALUES (?,?,?,1,?)",
          [recipient.id, registration.name, recipient.email, tenantId],
        );
        await manager.query(
          "INSERT INTO auth_accounts(id,user_id,provider_id,account_id,password) VALUES (?,?,'credential',?,?)",
          [randomUUID(), recipient.id, recipient.id, registration.passwordHash],
        );
        await this.audit(
          manager,
          recipient.id,
          tenantId,
          "organisation.account_created",
          "user",
          recipient.id,
        );
      }
      if (!recipient) throw new DatabaseConflict("invitation_unavailable");
      const [member] = await manager.query(
        "SELECT id,role,status FROM tenant_memberships WHERE tenant_id=? AND user_id=? FOR UPDATE",
        [tenantId, recipient.id],
      );
      if (member?.status === "revoked")
        throw new DatabaseConflict("membership_revoked");
      const conflict = invitationRoleConflict(
        member?.role ?? null,
        invite.role,
      );
      if (conflict) throw new DatabaseConflict(conflict);
      const granted = invite.role;
      if (!member)
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
      if (token) await this.actor(manager, token, true);
      await this.audit(
        manager,
        recipient.id,
        tenantId,
        "organisation.invitation_accepted",
        "invitation",
        invite.id,
      );
      return { role: granted, email: recipient.email };
    });
  }
}

import { storageLease } from "./lease";
import { researchEligible } from "../onboarding/eligibility";
import { createHash, randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import {
  documentAllowed,
  documentKinds,
  uuidPattern,
  validateDocument,
  type DocumentActor,
  type DocumentKind,
} from "./policy";
import { GoogleDriveStorage } from "./drive";
/** Represent an authorization or validation failure without exposing database/provider details. */
export class DocumentError extends Error {
  /** Carry only an application error code and HTTP status, never provider details. */
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}
type Context = { token: string; tenantId: string | null };
type AuthorizedActor = DocumentActor & { tenantName: string | null };
type RecordRow = {
  id: string;
  tenant_id: string | null;
  customer_id: string | null;
  kind: DocumentKind;
  original_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  drive_file_id: string;
  drive_folder_id: string;
  created_at: string;
};
/** Project only application metadata; Drive IDs and server credentials remain private. */
function project(row: RecordRow) {
  return {
    id: row.id,
    kind: row.kind,
    customerId: row.customer_id,
    name: row.original_name,
    mime: row.mime_type,
    bytes: row.byte_size,
    createdAt: row.created_at,
  };
}
/** Hash stored and downloaded bytes for corruption detection. */
function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
/** Authorize every operation against live database facts and retain upload/download audit evidence. */
export class DocumentService {
  /** Share the existing database pool and an optional configured Drive client. */
  constructor(
    private readonly db: DataSource,
    private readonly drive: GoogleDriveStorage | null,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}
  /** Check session revocation, verification, tenant status, membership and unsupported overrides afresh. */
  private async actor(
    manager: EntityManager,
    context: Context,
  ): Promise<AuthorizedActor> {
    const [session] = await manager.query(
      "SELECT u.id,u.platform_role FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>UTC_TIMESTAMP(3) AND u.email_verified=1",
      [context.token],
    );
    if (!session) throw new DocumentError("unauthorized", 401);
    const [user] = await manager.query(
      "SELECT id,platform_role,email_verified FROM auth_users WHERE id=? FOR UPDATE",
      [session.id],
    );
    if (!user?.email_verified) throw new DocumentError("unauthorized", 401);
    const [current] = await manager.query(
      "SELECT id FROM auth_sessions WHERE token=? AND user_id=? AND expires_at>UTC_TIMESTAMP(3) LOCK IN SHARE MODE",
      [context.token, user.id],
    );
    if (!current) throw new DocumentError("unauthorized", 401);
    if (!context.tenantId) {
      if (user.platform_role !== "owner")
        throw new DocumentError("forbidden", 403);
      return {
        id: user.id,
        tenantId: null,
        platformOwner: true,
        tenantName: null,
        role: null,
        membershipId: null,
      };
    }
    const [tenant] = await manager.query(
      "SELECT id,display_name FROM tenants WHERE id=? AND status='active' FOR UPDATE",
      [context.tenantId],
    );
    const [member] = await manager.query(
      "SELECT id,role,capabilities_json FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND status='active' FOR UPDATE",
      [context.tenantId, user.id],
    );
    if (!tenant || !member) throw new DocumentError("forbidden", 403);
    const overrides =
      typeof member.capabilities_json === "string"
        ? JSON.parse(member.capabilities_json)
        : member.capabilities_json;
    if (!overrides || overrides.allow?.length || overrides.deny?.length)
      throw new DocumentError("forbidden", 403);
    return {
      id: user.id,
      tenantId: context.tenantId,
      platformOwner: false,
      tenantName: tenant.display_name,
      role: member.role,
      membershipId: member.id,
    };
  }
  /** Reject unavailable storage only after authentication, without exposing configuration to guests. */
  private storage() {
    if (!this.drive)
      throw new DocumentError("document_storage_unavailable", 503);
    return this.drive;
  }
  /** Append an audit event without filenames, customer identity values or document contents. */
  private async audit(
    manager: EntityManager,
    context: Context,
    actor: DocumentActor,
    id: string,
    action: string,
  ) {
    await manager.query(
      "INSERT INTO audit_events(id,scope,tenant_id,actor_type,actor_user_id,actor_membership_id,action,entity_type,entity_id,metadata_json) VALUES (?,?,?,'user',?,?,?,'document',?,'{\"schemaVersion\":1}')",
      [
        randomUUID(),
        context.tenantId ? "tenant" : "platform",
        context.tenantId,
        actor.id,
        actor.membershipId,
        action,
        id,
      ],
    );
  }
  /** List authorized metadata with stable cursor pagination; never expose customer documents to other customers. */
  async list(context: Context, before?: string) {
    if (before && !uuidPattern.test(before))
      throw new DocumentError("invalid_cursor", 400);
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context);
      const research =
        actor.role !== "subscriber" ||
        (await researchEligible(
          manager,
          context.tenantId!,
          actor.membershipId!,
          this.env,
          new Date(),
        ));
      if (before) {
        const [cursor]: RecordRow[] = await manager.query(
          "SELECT * FROM documents WHERE tenant_id <=> ? AND id=?",
          [context.tenantId, before],
        );
        if (
          !cursor ||
          (!research && cursor.kind === "recommendation") ||
          !documentAllowed(
            actor,
            {
              tenantId: cursor.tenant_id,
              kind: cursor.kind,
              customerId: cursor.customer_id,
            },
            false,
          )
        )
          throw new DocumentError("invalid_cursor", 400);
      }
      const visibility = !context.tenantId
        ? "kind IN ('contract','owner')"
        : actor.role === "owner"
          ? "kind IN ('general','kyc','mitc','recommendation')"
          : actor.role === "analyst"
            ? "kind IN ('general','recommendation')"
            : actor.role === "support"
              ? "kind IN ('general','kyc','mitc')"
              : actor.role === "subscriber"
                ? `kind IN (${research ? "'kyc','mitc','recommendation'" : "'kyc','mitc'"}) AND customer_id=?`
                : "1=0";
      const parameters = [
        context.tenantId,
        before ?? null,
        context.tenantId,
        before ?? null,
        ...(actor.role === "subscriber" ? [actor.membershipId] : []),
      ];
      const rows: RecordRow[] = await manager.query(
        `SELECT * FROM documents WHERE tenant_id <=> ? AND (? IS NULL OR (created_at,id) < (SELECT created_at,id FROM documents WHERE tenant_id <=> ? AND id=?)) AND (${visibility}) ORDER BY created_at DESC,id DESC LIMIT 101`,
        parameters,
      );
      const visible = rows.filter(
        (row) =>
          (research || row.kind !== "recommendation") &&
          documentAllowed(
            actor,
            {
              tenantId: row.tenant_id,
              kind: row.kind,
              customerId: row.customer_id,
            },
            false,
          ),
      );
      return {
        configured: !!this.drive,
        documents: visible.slice(0, 100).map(project),
        nextCursor: visible.length > 100 ? visible[99].id : null,
      };
    });
  }
  /** Resolve active subscriber IDs for staff selection without exposing a global user directory. */
  async customers(context: Context) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context);
      if (
        !context.tenantId ||
        !["owner", "analyst", "support"].includes(actor.role ?? "")
      )
        return [];
      return manager.query(
        "SELECT m.id,u.name FROM tenant_memberships m JOIN auth_users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.role='subscriber' AND m.status='active' ORDER BY u.name,m.id LIMIT 1000",
        [context.tenantId],
      );
    });
  }
  /** Append a new immutable object in the server-resolved tenant/customer hierarchy. */
  async upload(
    context: Context,
    input: {
      kind: string;
      customerId?: string;
      name: string;
      mime: string;
      bytes: Buffer;
    },
  ) {
    if (!documentKinds.includes(input.kind as DocumentKind))
      throw new DocumentError("invalid_document_kind", 400);
    const kind = input.kind as DocumentKind;
    try {
      validateDocument(input.name, input.mime, input.bytes);
    } catch {
      throw new DocumentError("invalid_document", 400);
    }
    return storageLease(
      this.db,
      context.tenantId ?? "platform",
      async (manager) => {
        const actor = await this.actor(manager, context);
        const personal = ["kyc", "mitc", "recommendation"].includes(kind);
        const customerId = personal
          ? actor.role === "subscriber"
            ? actor.membershipId
            : (input.customerId ?? null)
          : null;
        if (
          (!context.tenantId && !["contract", "owner"].includes(kind)) ||
          (context.tenantId && ["contract", "owner"].includes(kind)) ||
          (personal && (!customerId || !uuidPattern.test(customerId)))
        )
          throw new DocumentError("invalid_document_target", 400);
        if (
          !documentAllowed(
            actor,
            { tenantId: context.tenantId, kind, customerId },
            true,
          )
        )
          throw new DocumentError("forbidden", 403);
        if (customerId) {
          const [customer] = await manager.query(
            "SELECT id FROM tenant_memberships WHERE tenant_id=? AND id=? AND role='subscriber' AND status='active'",
            [context.tenantId, customerId],
          );
          if (!customer) throw new DocumentError("customer_not_found", 404);
        }
        this.storage();
        return { actor, customerId };
      },
      async ({ actor, customerId }) => {
        const drive = this.storage();
        await drive.verify();
        let folder = drive.config.mainId;
        if (context.tenantId) {
          const ra = await drive.tenantFolder(
            context.tenantId,
            actor.tenantName!,
          );
          if (kind === "general") folder = await drive.folder(ra, "General");
          else {
            const customers = await drive.folder(ra, "Customer");
            const customer = await drive.folder(customers, customerId!);
            folder =
              kind === "recommendation"
                ? await drive.folder(customer, "ForYouByRA")
                : customer;
          }
        }
        const id = randomUUID();
        // Provider success followed by DB failure can leave an unindexed object. Retain it for reconciliation, never silently delete evidence.
        const fileId = await drive.upload(
          folder,
          input.name,
          input.mime,
          input.bytes,
          id,
        );
        return { id, fileId, folder };
      },
      async (manager, { customerId }, { id, fileId, folder }) => {
        const actor = await this.actor(manager, context);
        if (
          !documentAllowed(
            actor,
            { tenantId: context.tenantId, kind, customerId },
            true,
          )
        )
          throw new DocumentError("forbidden", 403);
        if (customerId) {
          const [customer] = await manager.query(
            "SELECT id FROM tenant_memberships WHERE tenant_id=? AND id=? AND role='subscriber' AND status='active'",
            [context.tenantId, customerId],
          );
          if (!customer) throw new DocumentError("customer_not_found", 404);
        }
        await manager.query(
          "INSERT INTO documents(id,tenant_id,customer_id,kind,original_name,mime_type,byte_size,sha256,drive_file_id,drive_folder_id,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          [
            id,
            context.tenantId,
            customerId,
            kind,
            input.name,
            input.mime,
            input.bytes.length,
            sha256(input.bytes),
            fileId,
            folder,
            actor.id,
          ],
        );
        await this.audit(manager, context, actor, id, "document.uploaded");
        return { id };
      },
    );
  }
  /** Check exact tenant/object authorization and byte integrity before releasing a download. */
  async download(context: Context, id: string) {
    if (!uuidPattern.test(id))
      throw new DocumentError("document_not_found", 404);
    /** Recheck access both before storage access and before releasing bytes after network waits. */
    const authorize = () =>
      this.db.transaction(async (manager) => {
        const actor = await this.actor(manager, context);
        const [row]: RecordRow[] = await manager.query(
          "SELECT * FROM documents WHERE tenant_id <=> ? AND id=?",
          [context.tenantId, id],
        );
        if (
          !row ||
          !documentAllowed(
            actor,
            {
              tenantId: row.tenant_id,
              kind: row.kind,
              customerId: row.customer_id,
            },
            false,
          )
        )
          throw new DocumentError("document_not_found", 404);
        if (
          row.kind === "recommendation" &&
          actor.role === "subscriber" &&
          !(await researchEligible(
            manager,
            context.tenantId!,
            actor.membershipId!,
            this.env,
            new Date(),
          ))
        )
          throw new DocumentError("research_eligibility_required", 403);
        return { actor, row };
      });
    const { row } = await authorize();
    const drive = this.storage();
    await drive.verify();
    const bytes = await drive.download(row.drive_file_id, row.drive_folder_id);
    if (bytes.length !== row.byte_size || sha256(bytes) !== row.sha256)
      throw new DocumentError("document_integrity_failed", 502);
    const { actor } = await authorize();
    await this.db.transaction((manager) =>
      this.audit(manager, context, actor, id, "document.downloaded"),
    );
    return { bytes, name: row.original_name, mime: row.mime_type };
  }

  /** Store only server-generated order evidence; the order is authoritative and no HTTP caller can select these bytes or targets. */
  async storeOrderEvidence(
    orderId: string,
    type: "agreement" | "invoice",
    bytes: Buffer,
  ): Promise<string> {
    const [scope] = await this.db.query(
      "SELECT tenant_id FROM subscription_orders WHERE id=?",
      [orderId],
    );
    if (!scope) throw new DocumentError("document_not_found", 404);
    const result = await storageLease(
      this.db,
      scope.tenant_id,
      async (manager) => {
        const [tenant] = await manager.query(
          "SELECT id,display_name FROM tenants WHERE id=? AND status='active' FOR UPDATE",
          [scope.tenant_id],
        );
        const [order] = await manager.query(
          "SELECT o.*,m.user_id FROM subscription_orders o JOIN tenant_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id WHERE o.id=? FOR UPDATE",
          [orderId],
        );
        if (
          !tenant ||
          !order ||
          !["signed", "payment_pending", "paid"].includes(order.status) ||
          (type === "invoice" && order.status !== "paid")
        )
          throw new DocumentError("forbidden", 403);
        const existing =
          type === "agreement" ? order.agreement_id : order.invoice_id;
        if (existing) return { tenant, order, existing: existing as string };
        return { tenant, order, existing: null };
      },
      async ({ tenant, order, existing }) => {
        if (existing)
          return { existing, id: existing, name: "", folder: "", fileId: "" };
        const name = `${type === "agreement" ? "Signed-Agreement" : "Invoice"}-${orderId}.pdf`;
        validateDocument(name, "application/pdf", bytes);
        const drive = this.storage();
        await drive.verify();
        const ra = await drive.tenantFolder(tenant.id, tenant.display_name);
        const customers = await drive.folder(ra, "Customer");
        const folder = await drive.folder(customers, order.membership_id);
        const id = randomUUID();
        const fileId = await drive.upload(
          folder,
          name,
          "application/pdf",
          bytes,
          id,
        );
        return { existing: null, id, name, folder, fileId };
      },
      async (manager, { tenant, order }, uploaded) => {
        if (uploaded.existing) return uploaded.existing;
        const [active] = await manager.query(
          "SELECT id FROM tenants WHERE id=? AND status='active' FOR UPDATE",
          [tenant.id],
        );
        if (!active) throw new DocumentError("forbidden", 403);
        const [current] = await manager.query(
          "SELECT * FROM subscription_orders WHERE id=? FOR UPDATE",
          [orderId],
        );
        if (
          !current ||
          !["signed", "payment_pending", "paid"].includes(current.status) ||
          (type === "invoice" && current.status !== "paid")
        )
          throw new DocumentError("forbidden", 403);
        const existing =
          type === "agreement" ? current.agreement_id : current.invoice_id;
        if (existing) return existing as string;
        const { id, name, fileId, folder } = uploaded;
        await manager.query(
          "INSERT INTO documents(id,tenant_id,customer_id,kind,original_name,mime_type,byte_size,sha256,drive_file_id,drive_folder_id,uploaded_by) VALUES (?,?,?,'mitc',?,'application/pdf',?,?,?,?,?)",
          [
            id,
            tenant.id,
            order.membership_id,
            name,
            bytes.length,
            sha256(bytes),
            fileId,
            folder,
            order.user_id,
          ],
        );
        await manager.query(
          type === "agreement"
            ? "UPDATE subscription_orders SET agreement_id=? WHERE id=?"
            : "UPDATE subscription_orders SET invoice_id=? WHERE id=?",
          [id, orderId],
        );
        await manager.query(
          "INSERT INTO audit_events(id,scope,tenant_id,actor_type,action,entity_type,entity_id,metadata_json) VALUES (?,'tenant',?,'system','order.evidence_stored','document',?,'{\"schemaVersion\":1}')",
          [randomUUID(), tenant.id, id],
        );
        return id;
      },
    );
    return result;
  }

  /** Read canonical archived order bytes for delivery, checking their stored integrity before attaching them to email. */
  async readOrderEvidence(
    orderId: string,
    type: "agreement" | "invoice",
  ): Promise<Buffer> {
    const [row] = await this.db.query(
      type === "agreement"
        ? "SELECT d.* FROM documents d JOIN subscription_orders o ON o.agreement_id=d.id AND o.tenant_id=d.tenant_id AND o.membership_id=d.customer_id WHERE o.id=?"
        : "SELECT d.* FROM documents d JOIN subscription_orders o ON o.invoice_id=d.id AND o.tenant_id=d.tenant_id AND o.membership_id=d.customer_id WHERE o.id=?",
      [orderId],
    );
    if (!row) throw new DocumentError("document_not_found", 404);
    const drive = this.storage();
    await drive.verify();
    const bytes = await drive.download(row.drive_file_id, row.drive_folder_id);
    if (bytes.length !== row.byte_size || sha256(bytes) !== row.sha256)
      throw new DocumentError("document_integrity_failed", 502);
    return bytes;
  }
}

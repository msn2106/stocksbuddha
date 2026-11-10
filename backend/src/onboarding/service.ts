import {
  qrFile,
  qrSettingsSchema,
  qrSubmissionSchema,
  qrReviewSchema,
  type QrSettings,
} from "./qr";
import { indianMobile } from "../sms/policy";
import { requireVerifiedMobile } from "../sms/kyc";
import { reportBackground } from "../background-monitoring";
import { researchEligible } from "./eligibility";
import { randomInt, randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import type {
  AgreementSettings,
  Coupon,
  KycProfile,
  KycView,
  OnboardingView,
  OrderView,
  Plan,
} from "@ra/contracts";
import type { BusinessMailer } from "../auth/email";
import type { DocumentService } from "../documents/service";
import { uuidPattern } from "../documents/policy";
import type { PaymentGateway } from "./cashfree";
import {
  agreement,
  couponInput,
  devEnabled,
  equal,
  hash,
  keyed,
  kycProfile,
  money,
  pdf,
  planInput,
  requireValue,
  seal,
  settingsInput,
  text,
  unseal,
  uuid,
} from "./domain";

export type OnboardingContext = { token: string; tenantId: string };
type Actor = {
  userId: string;
  membershipId: string;
  tenantId: string;
  slug: string;
  role: string;
  name: string;
  email: string;
  phone: string;
  raName: string;
  registration: string | null;
};
type KycRow = {
  membership_id: string;
  tenant_id: string;
  profile_cipher: string;
  status: KycView["status"];
  version: number;
  reason: string;
  provider: string;
  checked_at: string | null;
  family_hash: string;
  pan_hash: string;
};
type OrderRow = {
  id: string;
  tenant_id: string;
  membership_id: string;
  plan_id: string;
  coupon_id: string | null;
  snapshot_cipher: string;
  signature_cipher: string | null;
  agreement_hash: string;
  status: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  days: number;
  dev: number;
  expires_at: string;
  signed_at: string | null;
  paid_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  agreement_id: string | null;
  invoice_id: string | null;
  payment_session: string | null;
  payment_method: "qr" | "cashfree" | null;
  otp_hash: string | null;
  otp_attempts: number;
  otp_sent_at: string | null;
  otp_expires_at: string | null;
  payment_id: string | null;
  family_hash: string;
};
type Snapshot = {
  text: string;
  planName: string;
  profile: KycProfile;
  email: string;
  raName: string;
  registration: string;
  settings: AgreementSettings;
  kycVersion: number;
  planVersion: number;
  termsVersion: number;
  couponCode: string;
  taxBps: number;
};
type Signature = {
  name: string;
  signedAt: string;
  hash: string;
  method: "typed_email_otp" | "skipped_dev";
  userId: string;
  membershipId: string;
  consent: string;
};
export type OnboardingOptions = {
  env: NodeJS.ProcessEnv;
  mailer?: BusinessMailer;
  documents: Pick<DocumentService, "storeOrderEvidence" | "readOrderEvidence">;
  gateways?: Map<string, PaymentGateway>;
  resolveGateway?: (
    slug: string,
    manager?: EntityManager,
  ) => Promise<PaymentGateway | undefined>;
  now?: () => Date;
  report?: typeof reportBackground;
};
/** Normalize MariaDB UTC values for browser transport and absolute expiry checks. */
export function iso(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(
        value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
      ).toISOString();
}
/** Map stored integer plan facts to a safe transport shape. */
export function planView(row: Record<string, unknown>): Plan {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    days: Number(row.days),
    price: Number(row.price),
    taxBps: Number(row.tax_bps),
    active: Boolean(row.active),
    version: Number(row.version),
  };
}
/** Map stored coupon dates and limits without returning provider configuration. */
export function couponView(row: Record<string, unknown>): Coupon {
  return {
    id: String(row.id),
    code: String(row.code),
    type: row.type as Coupon["type"],
    value: Number(row.value),
    planId: row.plan_id ? String(row.plan_id) : null,
    startsAt: iso(String(row.starts_at)),
    endsAt: iso(String(row.ends_at)),
    limit: Number(row.usage_limit),
    perUser: Number(row.per_user),
    active: Boolean(row.active),
    version: Number(row.version),
  };
}
/** Keep all tenant workflows behind fresh database authorization and serialized tenant mutations. */
export class OnboardingService {
  private readonly secret: string;
  private readonly now: () => Date;
  /** Share runtime dependencies; production signing remains closed until explicit compliance approval. */
  constructor(
    private readonly db: DataSource,
    private readonly options: OnboardingOptions,
  ) {
    requireValue(
      options.env.AUTH_SECRET && options.env.AUTH_SECRET.length >= 32,
      "invalid_onboarding_secret",
    );
    if (options.env.NODE_ENV === "production")
      requireValue(
        options.env.ONBOARDING_DATA_KEY &&
          /^[0-9a-f]{64}$/.test(options.env.ONBOARDING_DATA_KEY),
        "production_data_key_required",
      );
    this.secret = options.env.ONBOARDING_DATA_KEY ?? options.env.AUTH_SECRET;
    this.now = options.now ?? (() => new Date());
  }
  /** Check expiry, verified identity, active tenant/member and unsupported capability overrides under locks. */
  private async actor(
    manager: EntityManager,
    context: OnboardingContext,
  ): Promise<Actor> {
    const [session] = await manager.query(
      "SELECT u.id FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>UTC_TIMESTAMP(3) AND u.email_verified=1",
      [context.token],
    );
    requireValue(session, "unauthorized", 401);
    const [user] = await manager.query(
      "SELECT id,name,email,email_verified,signup_phone FROM auth_users WHERE id=? FOR UPDATE",
      [session.id],
    );
    const [current] = await manager.query(
      "SELECT id FROM auth_sessions WHERE token=? AND user_id=? AND expires_at>UTC_TIMESTAMP(3) LOCK IN SHARE MODE",
      [context.token, session.id],
    );
    requireValue(user?.email_verified && current, "unauthorized", 401);
    const [tenant] = await manager.query(
      "SELECT id,slug,legal_name,registration_number FROM tenants WHERE id=? AND status='active' FOR UPDATE",
      [context.tenantId],
    );
    const [member] = await manager.query(
      "SELECT id,role,capabilities_json FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND status='active' FOR UPDATE",
      [context.tenantId, user.id],
    );
    requireValue(
      tenant && member && ["owner", "subscriber"].includes(member.role),
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
      userId: user.id,
      membershipId: member.id,
      tenantId: tenant.id,
      slug: tenant.slug,
      role: member.role,
      name: user.name,
      email: user.email,
      phone: user.signup_phone ?? "",
      raName: tenant.legal_name,
      registration: tenant.registration_number,
    };
  }
  /** Record business changes without identity values or OTPs in audit metadata. */
  private async audit(
    manager: EntityManager,
    actor: Actor,
    action: string,
    id: string,
  ) {
    await manager.query(
      "INSERT INTO audit_events(id,scope,tenant_id,actor_type,actor_user_id,actor_membership_id,action,entity_type,entity_id,metadata_json) VALUES (?,'tenant',?,'user',?,?,?,'onboarding',?,'{\"schemaVersion\":1}')",
      [
        randomUUID(),
        actor.tenantId,
        actor.userId,
        actor.membershipId,
        action,
        id,
      ],
    );
  }
  /** Resolve a subscriber target from the actor, never accepting cross-tenant or staff records. */
  private async customer(
    manager: EntityManager,
    actor: Actor,
    target?: unknown,
  ) {
    const id = target ? uuid(target) : actor.membershipId;
    requireValue(
      actor.role === "owner" || id === actor.membershipId,
      "forbidden",
      403,
    );
    const [row] = await manager.query(
      "SELECT m.id,m.full_name,m.mobile,m.mobile_verified_at,u.name,u.email,u.signup_phone FROM tenant_memberships m JOIN auth_users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.id=? AND m.role='subscriber' AND m.status='active' FOR UPDATE",
      [actor.tenantId, id],
    );
    requireValue(row, "customer_not_found", 404);
    return row;
  }
  /** Project only the selected customer's decrypted identity; table listings mask PAN. */
  private kycView(
    row: KycRow | undefined,
    customer: {
      id: string;
      name: string;
      email: string;
      signup_phone?: string;
      full_name?: string;
      mobile?: string;
      mobile_verified_at?: string;
    },
  ): KycView {
    return {
      mobileVerified: !!customer.mobile_verified_at,
      verifiedMobile: customer.mobile_verified_at ? customer.mobile : undefined,
      id: customer.id,
      name: customer.full_name || customer.name,
      email: customer.email,
      status: row?.status ?? "not_started",
      version: row?.version ?? 0,
      profile: row
        ? unseal<KycProfile>(this.secret, row.profile_cipher)
        : {
            fullName: customer.full_name || customer.name,
            phone: customer.mobile || customer.signup_phone || "",
            pan: "",
            dob: "",
            documentId: "",
            familyPan: "",
            declaration: false,
          },
      reason: row?.reason ?? "",
      provider: row?.provider ?? "kfin_manual",
      checkedAt: row?.checked_at ? iso(row.checked_at) : null,
    };
  }
  /** Read the versioned agreement settings approved by this RA. */
  private async settings(
    manager: EntityManager,
    tenantId: string,
  ): Promise<AgreementSettings | null> {
    const [row] = await manager.query(
      "SELECT * FROM ra_agreement_settings WHERE tenant_id=?",
      [tenantId],
    );
    return row
      ? {
          terms: row.terms,
          contact: row.contact,
          address: row.address,
          gstin: row.gstin,
          annualLimit: row.annual_limit,
          reviewed: Boolean(row.reviewed),
          version: row.version,
        }
      : null;
  }
  /** Permit development signing, or explicitly reviewed production signing with production database settings. */
  private signingEnabled() {
    return this.options.env.NODE_ENV !== "production"
      ? this.options.env.DB_ENV === "dev"
      : this.options.env.DB_ENV === "prod" &&
          this.options.env.ONBOARDING_PRODUCTION_APPROVED === "true";
  }
  /** Decrypt the immutable checkout snapshot into the current customer's safe projection. */
  private orderView(row: OrderRow): OrderView {
    const snapshot = unseal<Snapshot>(this.secret, row.snapshot_cipher);
    return {
      id: row.id,
      status: row.status,
      paymentMethod: row.payment_method,
      planName: snapshot.planName,
      subtotal: row.subtotal,
      discount: row.discount,
      tax: row.tax,
      total: row.total,
      days: row.days,
      text: snapshot.text,
      hash: row.agreement_hash,
      expiresAt: iso(row.expires_at),
      signedAt: row.signed_at ? iso(row.signed_at) : null,
      startsAt: row.starts_at ? iso(row.starts_at) : null,
      endsAt: row.ends_at ? iso(row.ends_at) : null,
      agreementId: row.agreement_id,
      invoiceId: row.invoice_id,
      dev: Boolean(row.dev),
    };
  }
  /** Read a private dashboard, bounded admin roster, or exact customer detail. */
  async read(
    context: OnboardingContext,
    target?: string,
    before?: string,
  ): Promise<OnboardingView> {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context),
        admin = actor.role === "owner";
      const settings = await this.settings(manager, actor.tenantId);
      const plans = (
        await manager.query(
          `SELECT * FROM subscription_plans WHERE tenant_id=?${admin ? "" : " AND active=1"} ORDER BY name,id`,
          [actor.tenantId],
        )
      ).map(planView);
      const coupons = admin
        ? (
            await manager.query(
              "SELECT * FROM discount_codes WHERE tenant_id=? ORDER BY code",
              [actor.tenantId],
            )
          ).map(couponView)
        : [];
      let customer: KycView | null = null;
      let orders: OrderView[] = [];
      let users: KycView[] = [];
      if (!admin || target) {
        const member = await this.customer(manager, actor, target);
        const [row]: KycRow[] = await manager.query(
          "SELECT * FROM investor_kyc WHERE tenant_id=? AND membership_id=?",
          [actor.tenantId, member.id],
        );
        customer = this.kycView(row, member);
        const rows: OrderRow[] = await manager.query(
          "SELECT * FROM subscription_orders WHERE tenant_id=? AND membership_id=? ORDER BY created_at DESC,id DESC LIMIT 50",
          [actor.tenantId, member.id],
        );
        orders = rows.map((order) => this.orderView(order));
      } else {
        if (before) uuid(before);
        const members = await manager.query(
          `SELECT m.id,m.full_name,m.mobile,m.mobile_verified_at,u.name,u.email,u.signup_phone FROM tenant_memberships m JOIN auth_users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.role='subscriber' AND m.status='active'${before ? " AND m.id>?" : ""} ORDER BY m.id LIMIT 51`,
          [actor.tenantId, ...(before ? [before] : [])],
        );
        for (const member of members) {
          const [row]: KycRow[] = await manager.query(
            "SELECT * FROM investor_kyc WHERE tenant_id=? AND membership_id=?",
            [actor.tenantId, member.id],
          );
          const view = this.kycView(row, member);
          view.profile = {
            ...view.profile,
            pan: view.profile.pan ? `******${view.profile.pan.slice(-4)}` : "",
            dob: "",
            documentId: "",
            familyPan: "",
            declaration: false,
          };
          users.push(view);
        }
      }
      const nextCursor = users.length > 50 ? users[49].id : null;
      users = users.slice(0, 50);
      return {
        admin,
        devSkip: devEnabled(this.options.env),
        signingEnabled: this.signingEnabled(),
        paymentEnabled: Boolean(await this.gateway(actor.slug, manager)),
        qrEnabled:
          this.signingEnabled() &&
          Boolean((await this.qrConfig(manager, actor.tenantId))?.enabled),
        plans,
        coupons,
        settings: admin ? settings : null,
        users,
        customer,
        orders,
        nextCursor,
      };
    });
  }
  /** Authoritative guard shared with recommendation delivery; sessions, KYC, paid periods and evidence must all remain valid. */
  async canUseResearch(context: OnboardingContext): Promise<boolean> {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context);
      if (actor.role !== "subscriber") return false;
      return researchEligible(
        manager,
        actor.tenantId,
        actor.membershipId,
        this.options.env,
        this.now(),
      );
    });
  }
  /** Append an encrypted history entry for every submitted, edited or reviewed KYC revision. */
  private async history(
    manager: EntityManager,
    actor: Actor,
    memberId: string,
  ) {
    const [row] = await manager.query(
      "SELECT * FROM investor_kyc WHERE tenant_id=? AND membership_id=?",
      [actor.tenantId, memberId],
    );
    await manager.query(
      "INSERT INTO kyc_history(id,tenant_id,membership_id,version,snapshot_cipher,actor_id) VALUES (?,?,?,?,?,?)",
      [
        randomUUID(),
        actor.tenantId,
        memberId,
        row.version,
        seal(this.secret, row),
        actor.userId,
      ],
    );
  }
  /** Save a versioned plan, coupon or legal template only for a fresh RA Admin membership. */
  async manage(
    context: OnboardingContext,
    kind: string,
    input: Record<string, unknown>,
  ) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context);
      requireValue(actor.role === "owner", "forbidden", 403);
      if (kind === "settings") {
        const value = settingsInput(input),
          current = await this.settings(manager, actor.tenantId);
        requireValue(
          input.version === (current?.version ?? 0),
          "version_conflict",
          409,
        );
        await manager.query(
          "INSERT INTO ra_agreement_settings(tenant_id,terms,contact,address,gstin,annual_limit,reviewed,version) VALUES (?,?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE terms=VALUES(terms),contact=VALUES(contact),address=VALUES(address),gstin=VALUES(gstin),annual_limit=VALUES(annual_limit),reviewed=VALUES(reviewed),version=version+1",
          [
            actor.tenantId,
            value.terms,
            value.contact,
            value.address,
            value.gstin,
            value.annualLimit,
            value.reviewed,
          ],
        );
        await this.audit(
          manager,
          actor,
          "agreement.settings_saved",
          actor.tenantId,
        );
        return { id: actor.tenantId };
      }
      const id = input.id ? uuid(input.id) : randomUUID();
      const table = kind === "plan" ? "subscription_plans" : "discount_codes";
      requireValue(kind === "plan" || kind === "coupon", "invalid_action");
      const [current] = await manager.query(
        `SELECT * FROM ${table} WHERE tenant_id=? AND id=?`,
        [actor.tenantId, id],
      );
      requireValue(
        input.id
          ? current && input.version === current.version
          : input.version === 0,
        "version_conflict",
        409,
      );
      if (kind === "plan") {
        const v = planInput(input);
        const [count] = await manager.query(
          "SELECT COUNT(*) AS count FROM subscription_plans WHERE tenant_id=?",
          [actor.tenantId],
        );
        requireValue(current || count.count < 100, "plan_limit");
        await manager.query(
          "INSERT INTO subscription_plans(id,tenant_id,name,description,days,price,tax_bps,active,version) VALUES (?,?,?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),days=VALUES(days),price=VALUES(price),tax_bps=VALUES(tax_bps),active=VALUES(active),version=version+1",
          [
            id,
            actor.tenantId,
            v.name,
            v.description,
            v.days,
            v.price,
            v.taxBps,
            v.active,
          ],
        );
      } else {
        const v = couponInput(input);
        if (v.planId) {
          const [plan] = await manager.query(
            "SELECT id FROM subscription_plans WHERE tenant_id=? AND id=?",
            [actor.tenantId, v.planId],
          );
          requireValue(plan, "plan_unavailable");
        }
        const [count] = await manager.query(
          "SELECT COUNT(*) AS count FROM discount_codes WHERE tenant_id=?",
          [actor.tenantId],
        );
        requireValue(current || count.count < 500, "coupon_limit");
        await manager.query(
          "INSERT INTO discount_codes(id,tenant_id,code,type,value,plan_id,starts_at,ends_at,usage_limit,per_user,active,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE code=VALUES(code),type=VALUES(type),value=VALUES(value),plan_id=VALUES(plan_id),starts_at=VALUES(starts_at),ends_at=VALUES(ends_at),usage_limit=VALUES(usage_limit),per_user=VALUES(per_user),active=VALUES(active),version=version+1",
          [
            id,
            actor.tenantId,
            v.code,
            v.type,
            v.value,
            v.planId,
            new Date(v.startsAt),
            new Date(v.endsAt),
            v.limit,
            v.perUser,
            v.active,
          ],
        );
      }
      await this.audit(manager, actor, `${kind}.saved`, id);
      return { id };
    });
  }
  /** Save or submit tenant-local identity facts, invalidating unfinished agreements after any edit. */
  async saveKyc(
    context: OnboardingContext,
    input: Record<string, unknown>,
    submit: boolean,
  ) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context),
        member = await this.customer(manager, actor, input.customerId);
      const profile = kycProfile(input, this.now());
      if (submit)
        await requireVerifiedMobile(
          manager,
          actor.tenantId,
          member.id,
          profile.phone,
        );
      if (member.mobile_verified_at && member.mobile) {
        try {
          if (indianMobile(profile.phone) === indianMobile(member.mobile))
            profile.phone = member.mobile;
        } catch {
          /* Draft values remain unverified. */
        }
      }
      const [document] = await manager.query(
        "SELECT id FROM documents WHERE tenant_id=? AND customer_id=? AND id=? AND kind='kyc'",
        [actor.tenantId, member.id, profile.documentId],
      );
      requireValue(document, "pan_document_required");
      const [row]: KycRow[] = await manager.query(
        "SELECT * FROM investor_kyc WHERE tenant_id=? AND membership_id=?",
        [actor.tenantId, member.id],
      );
      requireValue(
        input.version === (row?.version ?? 0),
        "version_conflict",
        409,
      );
      requireValue(
        actor.role === "owner" ||
          !["pending", "verified"].includes(row?.status ?? ""),
        "kyc_locked",
        409,
      );
      const panHash = keyed(
          this.secret,
          `pan:${actor.tenantId}:${profile.pan}`,
        ),
        familyHash = keyed(
          this.secret,
          `pan:${actor.tenantId}:${profile.familyPan}`,
        );
      let phoneChanged = false;
      if (row) {
        const oldPhone = unseal<KycProfile>(
          this.secret,
          row.profile_cipher,
        ).phone;
        try {
          phoneChanged = indianMobile(oldPhone) !== indianMobile(profile.phone);
        } catch {
          phoneChanged = oldPhone !== profile.phone;
        }
      }
      if (
        row &&
        (phoneChanged ||
          row.pan_hash !== panHash ||
          row.family_hash !== familyHash ||
          unseal<KycProfile>(this.secret, row.profile_cipher).dob !==
            profile.dob ||
          unseal<KycProfile>(this.secret, row.profile_cipher).fullName !==
            profile.fullName)
      ) {
        const [paid] = await manager.query(
          "SELECT id FROM subscription_orders WHERE tenant_id=? AND membership_id=? AND status='paid' LIMIT 1",
          [actor.tenantId, member.id],
        );
        requireValue(
          !paid,
          "paid_identity_change_requires_compliance_review",
          409,
        );
      }
      const status = submit ? "pending" : "draft";
      await manager.query(
        "INSERT INTO investor_kyc(membership_id,tenant_id,profile_cipher,pan_hash,family_hash,status,version,submitted_at) VALUES (?,?,?,?,?,?,1,?) ON DUPLICATE KEY UPDATE profile_cipher=VALUES(profile_cipher),pan_hash=VALUES(pan_hash),family_hash=VALUES(family_hash),status=VALUES(status),version=version+1,reason='',reviewed_by=NULL,checked_at=NULL,submitted_at=VALUES(submitted_at)",
        [
          member.id,
          actor.tenantId,
          seal(this.secret, profile),
          panHash,
          familyHash,
          status,
          submit ? this.now() : null,
        ],
      );
      await manager.query(
        "UPDATE tenant_memberships SET full_name=?,mobile_verified_at=CASE WHEN mobile=? THEN mobile_verified_at ELSE NULL END,mobile=?,onboarding_stage='verification_pending',lock_version=lock_version+1 WHERE tenant_id=? AND id=?",
        [
          profile.fullName,
          profile.phone,
          profile.phone,
          actor.tenantId,
          member.id,
        ],
      );
      // Payment-pending orders cannot be cancelled: the provider may already have collected money.
      const [pending] = await manager.query(
        "SELECT id FROM subscription_orders WHERE tenant_id=? AND membership_id=? AND status='payment_pending' LIMIT 1",
        [actor.tenantId, member.id],
      );
      requireValue(!pending, "payment_in_progress", 409);
      await manager.query(
        "UPDATE subscription_orders SET status='cancelled' WHERE tenant_id=? AND membership_id=? AND status IN ('quoted','signed')",
        [actor.tenantId, member.id],
      );
      await this.history(manager, actor, member.id);
      await this.audit(
        manager,
        actor,
        submit ? "kyc.submitted" : "kyc.saved",
        member.id,
      );
      return { id: member.id };
    });
  }
  /** Require a KFIN result and retained evidence for manual approval; corrections and rejection require a reason. */
  async review(context: OnboardingContext, input: Record<string, unknown>) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context);
      requireValue(actor.role === "owner", "forbidden", 403);
      const member = await this.customer(manager, actor, input.customerId);
      const [row]: KycRow[] = await manager.query(
        "SELECT * FROM investor_kyc WHERE tenant_id=? AND membership_id=?",
        [actor.tenantId, member.id],
      );
      requireValue(
        row && row.version === input.version && row.status === "pending",
        "version_conflict",
        409,
      );
      requireValue(
        ["verified", "changes", "rejected"].includes(String(input.status)),
        "invalid_action",
      );
      const reason = text(
        input.reason ?? "",
        1000,
        input.status === "verified" ? 0 : 5,
      );
      if (input.status === "verified")
        await requireVerifiedMobile(
          manager,
          actor.tenantId,
          member.id,
          unseal<KycProfile>(this.secret, row.profile_cipher).phone,
        );
      let reference = "",
        evidenceId: string | null = null,
        providerStatus = "";
      if (input.status === "verified") {
        reference = text(input.reference, 200);
        providerStatus = text(input.providerStatus, 80);
        requireValue(
          providerStatus === "KYC VALIDATED",
          "kra_remediation_required",
        );
        requireValue(
          typeof input.evidenceId === "string" &&
            uuidPattern.test(input.evidenceId),
          "verification_evidence_required",
        );
        evidenceId = uuid(input.evidenceId);
        const [evidence] = await manager.query(
          "SELECT id FROM documents WHERE tenant_id=? AND customer_id=? AND id=? AND kind='kyc'",
          [actor.tenantId, member.id, evidenceId],
        );
        requireValue(evidence, "verification_evidence_required");
        const profile = unseal<KycProfile>(this.secret, row.profile_cipher);
        requireValue(
          evidenceId !== profile.documentId,
          "verification_evidence_required",
        );
      }
      await manager.query(
        "UPDATE investor_kyc SET status=?,reason=?,provider='kfin_manual',provider_status=?,reference=?,evidence_id=?,reviewed_by=?,checked_at=?,version=version+1 WHERE tenant_id=? AND membership_id=?",
        [
          input.status,
          reason,
          providerStatus,
          reference,
          evidenceId,
          actor.userId,
          this.now(),
          actor.tenantId,
          member.id,
        ],
      );
      await manager.query(
        "UPDATE tenant_memberships SET onboarding_stage=?,lock_version=lock_version+1 WHERE tenant_id=? AND id=?",
        [
          input.status === "verified"
            ? "agreement_pending"
            : "verification_pending",
          actor.tenantId,
          member.id,
        ],
      );
      await this.history(manager, actor, member.id);
      await this.audit(manager, actor, `kyc.${input.status}`, member.id);
      return { id: member.id };
    });
  }
  /** Reserve a coupon and family fee allowance atomically while freezing the actual agreement and pricing. */
  async quote(context: OnboardingContext, input: Record<string, unknown>) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context);
      requireValue(actor.role === "subscriber", "forbidden", 403);
      const key = uuid(input.key),
        planId = uuid(input.planId);
      const [retry]: OrderRow[] = await manager.query(
        "SELECT * FROM subscription_orders WHERE tenant_id=? AND membership_id=? AND request_key=?",
        [actor.tenantId, actor.membershipId, key],
      );
      if (retry) {
        const prior = unseal<Snapshot>(this.secret, retry.snapshot_cipher);
        requireValue(
          retry.plan_id === planId &&
            prior.couponCode ===
              (input.code ? text(input.code, 32).toUpperCase() : ""),
          "idempotency_conflict",
          409,
        );
        return { id: retry.id };
      }
      const [kyc]: KycRow[] = await manager.query(
        "SELECT * FROM investor_kyc WHERE tenant_id=? AND membership_id=?",
        [actor.tenantId, actor.membershipId],
      );
      requireValue(
        kyc?.status === "verified" ||
          (devEnabled(this.options.env) && kyc?.status === "skipped_dev"),
        "kyc_required",
        409,
      );
      if (kyc.status !== "skipped_dev")
        await requireVerifiedMobile(
          manager,
          actor.tenantId,
          actor.membershipId,
          unseal<KycProfile>(this.secret, kyc.profile_cipher).phone,
        );
      const [active] = await manager.query(
        "SELECT id FROM subscription_orders WHERE tenant_id=? AND membership_id=? AND ((status='paid' AND ends_at>?) OR status='payment_pending' OR (status IN ('quoted','signed') AND expires_at>?)) LIMIT 1",
        [actor.tenantId, actor.membershipId, this.now(), this.now()],
      );
      requireValue(!active, "existing_checkout_or_subscription", 409);
      const [planRow] = await manager.query(
        "SELECT * FROM subscription_plans WHERE tenant_id=? AND id=? AND active=1",
        [actor.tenantId, planId],
      );
      requireValue(planRow, "plan_unavailable", 409);
      const plan = planView(planRow),
        settings = await this.settings(manager, actor.tenantId);
      requireValue(
        settings?.reviewed && actor.registration,
        "agreement_not_ready",
        409,
      );
      let coupon: Coupon | undefined;
      if (input.code) {
        const code = text(input.code, 32).toUpperCase();
        const [row] = await manager.query(
          "SELECT * FROM discount_codes WHERE tenant_id=? AND code=? AND active=1 AND starts_at<=? AND ends_at>?",
          [actor.tenantId, code, this.now(), this.now()],
        );
        requireValue(row, "coupon_unavailable", 409);
        coupon = couponView(row);
        requireValue(
          !coupon.planId || coupon.planId === plan.id,
          "coupon_unavailable",
          409,
        );
        const [usage] = await manager.query(
          "SELECT COUNT(*) AS total,COALESCE(SUM(membership_id=?),0) AS personal FROM subscription_orders WHERE tenant_id=? AND coupon_id=? AND (status IN ('paid','payment_pending') OR (status IN ('quoted','signed') AND expires_at>?))",
          [actor.membershipId, actor.tenantId, coupon.id, this.now()],
        );
        requireValue(
          Number(usage.total) < coupon.limit &&
            Number(usage.personal) < coupon.perUser,
          "coupon_exhausted",
          409,
        );
      }
      const { priceQuote } = await import("./domain");
      const amounts = priceQuote(plan, coupon);
      requireValue(
        plan.taxBps === 0 || settings.gstin,
        "tax_details_required",
        409,
      );
      const since = new Date(this.now().getTime() - 366 * 86400000);
      const [fees] = await manager.query(
        "SELECT COALESCE(SUM(subtotal-discount),0) AS total FROM subscription_orders WHERE tenant_id=? AND family_hash=? AND ((status='paid' AND paid_at>=?) OR status='payment_pending' OR (status IN ('quoted','signed') AND expires_at>?))",
        [actor.tenantId, kyc.family_hash, since, this.now()],
      );
      requireValue(
        Number(fees.total) + amounts.subtotal - amounts.discount <=
          settings.annualLimit,
        "family_fee_limit",
        409,
      );
      const profile = unseal<KycProfile>(this.secret, kyc.profile_cipher),
        id = randomUUID();
      const values = {
        orderId: id,
        raName: actor.raName,
        registration: actor.registration,
        contact: settings.contact,
        address: settings.address,
        clientName: profile.fullName,
        clientEmail: actor.email,
        clientPan: profile.pan,
        clientDob: profile.dob,
        clientPhone: profile.phone,
        planName: plan.name,
        offering: plan.description,
        days: String(plan.days),
        subtotal: money(amounts.subtotal),
        discount: money(amounts.discount),
        tax: money(amounts.tax),
        total: money(amounts.total),
        date: this.now().toISOString(),
      };
      const rendered = agreement(settings.terms, values);
      const snapshot: Snapshot = {
        text: rendered,
        planName: plan.name,
        profile,
        email: actor.email,
        raName: actor.raName,
        registration: actor.registration,
        settings,
        kycVersion: kyc.version,
        planVersion: plan.version,
        termsVersion: settings.version,
        couponCode: coupon?.code ?? "",
        taxBps: plan.taxBps,
      };
      const expires = new Date(this.now().getTime() + 30 * 60000);
      await manager.query(
        "INSERT INTO subscription_orders(id,tenant_id,membership_id,plan_id,coupon_id,request_key,snapshot_cipher,agreement_hash,family_hash,subtotal,discount,tax,total,days,expires_at,dev) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          actor.tenantId,
          actor.membershipId,
          plan.id,
          coupon?.id ?? null,
          key,
          seal(this.secret, snapshot),
          hash(rendered),
          kyc.family_hash,
          amounts.subtotal,
          amounts.discount,
          amounts.tax,
          amounts.total,
          plan.days,
          expires,
          kyc.status === "skipped_dev" ||
            this.options.env.NODE_ENV !== "production",
        ],
      );
      await this.audit(manager, actor, "checkout.created", id);
      return { id };
    });
  }
  /** Resolve an exact current investor order and reject cross-account IDs. */
  private async order(
    manager: EntityManager,
    actor: Actor,
    id: unknown,
  ): Promise<OrderRow> {
    requireValue(actor.role === "subscriber", "forbidden", 403);
    const [row]: OrderRow[] = await manager.query(
      "SELECT * FROM subscription_orders WHERE id=? AND tenant_id=? AND membership_id=? FOR UPDATE",
      [uuid(id), actor.tenantId, actor.membershipId],
    );
    requireValue(row, "order_not_found", 404);
    return row;
  }
  /** Validate quote expiry and the exact KYC revision before consent or payment. */
  private async eligible(manager: EntityManager, row: OrderRow) {
    requireValue(
      Date.parse(iso(row.expires_at)) > this.now().getTime(),
      "checkout_expired",
      409,
    );
    const [kyc]: KycRow[] = await manager.query(
      "SELECT * FROM investor_kyc WHERE tenant_id=? AND membership_id=?",
      [row.tenant_id, row.membership_id],
    );
    const snapshot = unseal<Snapshot>(this.secret, row.snapshot_cipher);
    if (kyc?.status !== "skipped_dev")
      await requireVerifiedMobile(
        manager,
        row.tenant_id,
        row.membership_id,
        snapshot.profile.phone,
      );
    requireValue(
      kyc &&
        kyc.version === snapshot.kycVersion &&
        (kyc.status === "verified" ||
          (devEnabled(this.options.env) && kyc.status === "skipped_dev")),
      "kyc_required",
      409,
    );
    requireValue(
      this.options.env.NODE_ENV !== "production" || !row.dev,
      "development_evidence_forbidden",
      403,
    );
  }
  /** Issue a bounded, order-bound code only to the authenticated investor's verified mailbox. */
  async sendCode(context: OnboardingContext, id: unknown) {
    const delivery = await this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context),
        row = await this.order(manager, actor, id);
      requireValue(
        this.signingEnabled() && this.options.mailer,
        "signing_unavailable",
        503,
      );
      requireValue(row.status === "quoted", "invalid_order_state", 409);
      await this.eligible(manager, row);
      requireValue(
        !row.otp_sent_at ||
          this.now().getTime() - Date.parse(iso(row.otp_sent_at)) >= 60000,
        "code_rate_limited",
        429,
      );
      requireValue(row.otp_attempts < 10, "code_attempts_exhausted", 429);
      const [rate] = await manager.query(
        "SELECT COUNT(*) AS count FROM audit_events WHERE actor_user_id=? AND action='agreement.code_requested' AND occurred_at>=?",
        [actor.userId, new Date(this.now().getTime() - 3600000)],
      );
      requireValue(Number(rate.count) < 10, "code_hourly_limit", 429);
      const code = String(randomInt(100000, 1000000));
      await manager.query(
        "UPDATE subscription_orders SET otp_hash=?,otp_sent_at=?,otp_expires_at=? WHERE id=?",
        [
          keyed(this.secret, `otp:${row.id}:${row.agreement_hash}:${code}`),
          this.now(),
          new Date(this.now().getTime() + 600000),
          row.id,
        ],
      );
      await this.audit(manager, actor, "agreement.code_requested", row.id);
      return {
        to: actor.email,
        url: `${this.options.env.AUTH_BASE_URL}/ra/${actor.slug}/account/onboarding`,
        kind: "signing" as const,
        code,
      };
    });
    await this.options.mailer!(delivery);
    return { sent: true };
  }
  /** Persist explicit consent and a typed signature tied to an immutable agreement hash and single-use email code. */
  async sign(context: OnboardingContext, input: Record<string, unknown>) {
    const result = await this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context),
        row = await this.order(manager, actor, input.orderId);
      if (["signed", "payment_pending", "paid"].includes(row.status))
        return { id: row.id };
      requireValue(
        this.signingEnabled() && row.status === "quoted",
        "signing_unavailable",
        409,
      );
      await this.eligible(manager, row);
      requireValue(
        input.hash === row.agreement_hash && input.consent === true,
        "agreement_consent_required",
      );
      const snapshot = unseal<Snapshot>(this.secret, row.snapshot_cipher),
        name = text(input.name, 160);
      requireValue(
        name.normalize("NFKC").toLowerCase() ===
          snapshot.profile.fullName.normalize("NFKC").toLowerCase(),
        "signature_name_mismatch",
      );
      const code = typeof input.code === "string" ? input.code : "";
      const valid =
        row.otp_hash &&
        row.otp_expires_at &&
        Date.parse(iso(row.otp_expires_at)) > this.now().getTime() &&
        row.otp_attempts < 10 &&
        equal(
          row.otp_hash,
          keyed(this.secret, `otp:${row.id}:${row.agreement_hash}:${code}`),
        );
      if (!valid) {
        await manager.query(
          "UPDATE subscription_orders SET otp_attempts=otp_attempts+1 WHERE id=?",
          [row.id],
        );
        return { id: row.id, invalid: true };
      }
      const signature: Signature = {
        name,
        signedAt: this.now().toISOString(),
        hash: row.agreement_hash,
        method: "typed_email_otp",
        userId: actor.userId,
        membershipId: actor.membershipId,
        consent:
          "I have read and agree to the research service terms, including MITC and the final payable amount shown in this agreement.",
      };
      await manager.query(
        "UPDATE subscription_orders SET status='signed',signature_cipher=?,signed_at=?,otp_hash=NULL WHERE id=?",
        [seal(this.secret, signature), this.now(), row.id],
      );
      await this.audit(manager, actor, "agreement.signed", row.id);
      return { id: row.id };
    });
    requireValue(!result.invalid, "invalid_or_expired_code", 400);
    await this.archive(result.id);
    return { id: result.id };
  }
  /** Development-only simulation retains distinct provenance and cannot produce production evidence. */
  async skip(context: OnboardingContext, input: Record<string, unknown>) {
    requireValue(
      devEnabled(this.options.env),
      "development_skip_forbidden",
      403,
    );
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context);
      requireValue(actor.role === "subscriber", "forbidden", 403);
      if (input.step === "kyc") {
        const member = await this.customer(manager, actor);
        const [existing] = await manager.query(
          "SELECT * FROM investor_kyc WHERE tenant_id=? AND membership_id=?",
          [actor.tenantId, member.id],
        );
        requireValue(
          !existing || existing.status !== "verified",
          "kyc_already_verified",
          409,
        );
        // Explicitly synthetic development facts never masquerade as real PAN/KRA evidence.
        const profile: KycProfile = {
          fullName: member.name,
          phone: member.signup_phone || "9999999999",
          pan: "DEVPX0000A",
          dob: "1990-01-01",
          documentId: "",
          familyPan: "DEVPX0000A",
          declaration: false,
        };
        await manager.query(
          "INSERT INTO investor_kyc(membership_id,tenant_id,profile_cipher,family_hash,status,version,provider) VALUES (?,?,?,?,'skipped_dev',1,'development') ON DUPLICATE KEY UPDATE status='skipped_dev',provider='development',version=version+1",
          [
            member.id,
            actor.tenantId,
            seal(this.secret, profile),
            keyed(this.secret, `dev:${member.id}`),
          ],
        );
        await this.history(manager, actor, member.id);
        await this.audit(manager, actor, "kyc.skipped_dev", member.id);
        return { id: member.id };
      }
      requireValue(input.step === "mitc", "invalid_action");
      const row = await this.order(manager, actor, input.orderId);
      requireValue(row.status === "quoted", "invalid_order_state", 409);
      await this.eligible(manager, row);
      const signature: Signature = {
        name: "DEVELOPMENT SIMULATION",
        signedAt: this.now().toISOString(),
        hash: row.agreement_hash,
        method: "skipped_dev",
        userId: actor.userId,
        membershipId: actor.membershipId,
        consent:
          "Development skip; no investor signature or legal consent captured.",
      };
      await manager.query(
        "UPDATE subscription_orders SET status='signed',dev=1,signature_cipher=?,signed_at=? WHERE id=?",
        [seal(this.secret, signature), this.now(), row.id],
      );
      await this.audit(manager, actor, "agreement.skipped_dev", row.id);
      return { id: row.id };
    });
  }
  /** Archive exact signed bytes once; retry after Drive failures without consuming another signing code. */
  async archive(id: string) {
    const [row]: OrderRow[] = await this.db.query(
      "SELECT * FROM subscription_orders WHERE id=?",
      [uuid(id)],
    );
    requireValue(
      row?.signature_cipher &&
        ["signed", "payment_pending", "paid"].includes(row.status),
      "agreement_not_signed",
      409,
    );
    if (row.agreement_id)
      return this.options.documents.readOrderEvidence(row.id, "agreement");
    const snapshot = unseal<Snapshot>(this.secret, row.snapshot_cipher),
      signature = unseal<Signature>(this.secret, row.signature_cipher);
    requireValue(
      hash(snapshot.text) === row.agreement_hash &&
        signature.hash === row.agreement_hash,
      "agreement_integrity_failed",
      409,
    );
    const bytes = await pdf(
      `${row.dev ? "DEVELOPMENT / SANDBOX EVIDENCE\n\n" : ""}${snapshot.text}\n\nCONSENT RECORD\nName: ${signature.name}\nMethod: ${signature.method}\nSigned: ${signature.signedAt}\nAgreement SHA-256: ${signature.hash}\n${signature.consent}\n`,
    );
    await this.options.documents.storeOrderEvidence(row.id, "agreement", bytes);
    return this.options.documents.readOrderEvidence(row.id, "agreement");
  }
  /** Cancel only orders that have not reached the gateway; provider-pending funds must be reconciled. */
  async cancel(context: OnboardingContext, id: unknown) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context),
        row = await this.order(manager, actor, id);
      requireValue(
        ["quoted", "signed", "cancelled"].includes(row.status),
        "payment_in_progress",
        409,
      );
      await manager.query(
        "UPDATE subscription_orders SET status='cancelled',otp_hash=NULL WHERE id=?",
        [row.id],
      );
      await this.audit(manager, actor, "checkout.cancelled", row.id);
      return { id: row.id };
    });
  }
  /** Read retained private configuration inside the caller's tenant transaction. */
  private async qrConfig(
    manager: EntityManager,
    tenantId: string,
  ): Promise<QrSettings | null> {
    const [row] = await manager.query(
      "SELECT config_cipher,version FROM ra_qr_settings WHERE tenant_id=? FOR UPDATE",
      [tenantId],
    );
    return row ? unseal<QrSettings>(this.secret, row.config_cipher) : null;
  }
  /** RA-only settings are independent of the frozen Cashfree merchant configuration. */
  async qrSettings(context: OnboardingContext, input?: unknown) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context);
      requireValue(actor.role === "owner", "forbidden", 403);
      const [row] = await manager.query(
        "SELECT config_cipher,version FROM ra_qr_settings WHERE tenant_id=? FOR UPDATE",
        [actor.tenantId],
      );
      const previous = row
        ? unseal<QrSettings>(this.secret, row.config_cipher)
        : { enabled: false, payee: "", upiId: "", instructions: "", image: "" };
      if (input === undefined)
        return { ...previous, version: row?.version ?? 0 };
      const parsed = qrSettingsSchema.safeParse(input);
      requireValue(parsed.success, "invalid_qr_settings", 422);
      const { version, removeImage, ...values } = parsed.data;
      requireValue(version === (row?.version ?? 0), "version_conflict", 409);
      const config = {
        ...values,
        image: removeImage ? "" : (values.image ?? previous.image),
      };
      if (config.image) qrFile(config.image);
      requireValue(!config.enabled || config.image, "qr_image_required", 422);
      await manager.query(
        "INSERT INTO ra_qr_settings(tenant_id,config_cipher,version) VALUES (?,?,?) ON DUPLICATE KEY UPDATE config_cipher=VALUES(config_cipher),version=VALUES(version)",
        [actor.tenantId, seal(this.secret, config), version + 1],
      );
      await this.audit(manager, actor, "qr.settings.updated", actor.tenantId);
      return { ...config, version: version + 1 };
    });
  }
  /** Reserve one manual payment and freeze its payee before revealing the QR; archive consent first. */
  async startQr(context: OnboardingContext, id: unknown) {
    await this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context),
        row = await this.order(manager, actor, id);
      requireValue(
        row.status === "signed" ||
          (row.status === "payment_pending" && row.payment_method === "qr"),
        "agreement_required",
        409,
      );
      if (row.payment_method !== "qr") await this.eligible(manager, row);
    });
    await this.archive(uuid(id));
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context),
        row = await this.order(manager, actor, id);
      requireValue(
        this.signingEnabled() &&
          (this.options.env.NODE_ENV !== "production" || !row.dev),
        "production_payments_not_approved",
        403,
      );
      requireValue(
        row.agreement_id && row.signed_at,
        "agreement_required",
        409,
      );
      if (row.status === "payment_pending" && row.payment_method === "qr")
        return { ok: true };
      requireValue(
        row.status === "signed" &&
          !row.payment_session &&
          !row.payment_method &&
          row.total > 0,
        "payment_method_locked",
        409,
      );
      await this.eligible(manager, row);
      const config = await this.qrConfig(manager, actor.tenantId);
      requireValue(config?.enabled && config.image, "qr_unavailable", 409);
      await manager.query(
        "INSERT INTO qr_payment_attempts(order_id,tenant_id,config_cipher,status) VALUES (?,?,?,'started')",
        [row.id, actor.tenantId, seal(this.secret, config)],
      );
      await manager.query(
        "UPDATE subscription_orders SET status='payment_pending',payment_method='qr' WHERE id=?",
        [row.id],
      );
      await this.audit(manager, actor, "qr.payment.started", row.id);
      return { ok: true };
    });
  }
  /** Authorize a frozen QR attempt for its investor or the RA; proof bytes are fetched separately. */
  private async qrAttempt(manager: EntityManager, actor: Actor, id: unknown) {
    const [order]: OrderRow[] = await manager.query(
      "SELECT * FROM subscription_orders WHERE id=? AND tenant_id=? FOR UPDATE",
      [uuid(id), actor.tenantId],
    );
    requireValue(
      order &&
        (actor.role === "owner" || order.membership_id === actor.membershipId),
      "order_not_found",
      404,
    );
    const [attempt] = await manager.query(
      "SELECT * FROM qr_payment_attempts WHERE order_id=? AND tenant_id=? FOR UPDATE",
      [order.id, actor.tenantId],
    );
    requireValue(attempt, "qr_payment_not_found", 404);
    return { order, attempt };
  }
  /** Return only authorized payment instructions and review facts, retaining old QR versions after replacement. */
  async qrPayment(context: OnboardingContext, id: unknown) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context),
        { order, attempt } = await this.qrAttempt(manager, actor, id);
      const proof = attempt.proof_cipher
        ? unseal<{ reference: string; paidAt: string }>(
            this.secret,
            attempt.proof_cipher,
          )
        : null;
      return {
        orderId: order.id,
        total: order.total,
        status: attempt.status,
        version: attempt.version,
        config: unseal<QrSettings>(this.secret, attempt.config_cipher),
        reference: proof?.reference ?? "",
        paidAt: proof?.paidAt ?? null,
        reason: attempt.reason_cipher
          ? unseal<string>(this.secret, attempt.reason_cipher)
          : "",
      };
    });
  }
  /** Retain one immutable claim, deduplicating normalized UTRs within each RA before manual verification. */
  async submitQr(context: OnboardingContext, input: unknown) {
    const parsed = qrSubmissionSchema.safeParse(input);
    requireValue(parsed.success, "invalid_qr_submission", 422);
    const data = parsed.data;
    qrFile(data.proof, true);
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context);
      requireValue(actor.role === "subscriber", "forbidden", 403);
      const { order, attempt } = await this.qrAttempt(
        manager,
        actor,
        data.orderId,
      );
      requireValue(
        order.status === "payment_pending" && order.payment_method === "qr",
        "invalid_order_state",
        409,
      );
      const referenceHash = keyed(
        this.secret,
        `qr:${actor.tenantId}:${data.reference}`,
      );
      if (attempt.status === "submitted") {
        const saved = unseal<{
          reference: string;
          paidAt: string;
          proof: string;
        }>(this.secret, attempt.proof_cipher);
        requireValue(
          saved.reference === data.reference &&
            saved.paidAt === data.paidAt &&
            saved.proof === data.proof,
          "qr_already_submitted",
          409,
        );
        return { ok: true };
      }
      requireValue(attempt.status === "started", "qr_already_reviewed", 409);
      const paidAt = Date.parse(data.paidAt);
      requireValue(
        paidAt >= Date.parse(iso(attempt.created_at)) - 60000 &&
          paidAt <= this.now().getTime() + 60000,
        "invalid_payment_date",
        422,
      );
      const [duplicate] = await manager.query(
        "SELECT order_id FROM qr_payment_attempts WHERE tenant_id=? AND reference_hash=? FOR UPDATE",
        [actor.tenantId, referenceHash],
      );
      requireValue(!duplicate, "payment_reference_used", 409);
      await manager.query(
        "UPDATE qr_payment_attempts SET status='submitted',proof_cipher=?,reference_hash=?,submitted_at=?,version=version+1 WHERE order_id=?",
        [seal(this.secret, data), referenceHash, this.now(), order.id],
      );
      await this.audit(manager, actor, "qr.payment.submitted", order.id);
      return { ok: true };
    });
  }
  /** Bound review queue; started attempts can be closed only after the RA checks for received funds. */
  async qrQueue(context: OnboardingContext) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context);
      requireValue(actor.role === "owner", "forbidden", 403);
      const rows = await manager.query(
        "SELECT q.order_id,q.status,q.version,q.created_at,q.submitted_at,o.total,o.membership_id FROM qr_payment_attempts q JOIN subscription_orders o ON o.id=q.order_id AND o.tenant_id=q.tenant_id WHERE q.tenant_id=? AND q.status IN ('started','submitted') ORDER BY CASE WHEN q.status='submitted' THEN 0 ELSE 1 END,q.created_at,q.order_id LIMIT 100",
        [actor.tenantId],
      );
      return rows.map((row: Record<string, unknown>) => ({
        orderId: row.order_id,
        status: row.status,
        version: row.version,
        total: row.total,
        customerId: row.membership_id,
        createdAt: iso(row.created_at as string),
      }));
    });
  }
  /** Confirm bank receipt explicitly; serialize review, entitlement and durable receipt/email work atomically. */
  async reviewQr(context: OnboardingContext, input: unknown) {
    const parsed = qrReviewSchema.safeParse(input);
    requireValue(parsed.success, "invalid_qr_review", 422);
    const data = parsed.data;
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context);
      requireValue(actor.role === "owner", "forbidden", 403);
      const { order, attempt } = await this.qrAttempt(
        manager,
        actor,
        data.orderId,
      );
      requireValue(attempt.version === data.version, "version_conflict", 409);
      requireValue(
        order.status === "payment_pending" &&
          order.payment_method === "qr" &&
          ["started", "submitted"].includes(attempt.status),
        "qr_already_reviewed",
        409,
      );
      if (data.approve) {
        requireValue(
          this.signingEnabled() &&
            (this.options.env.NODE_ENV !== "production" || !order.dev),
          "production_payments_not_approved",
          403,
        );
        requireValue(
          attempt.status === "submitted" && attempt.proof_cipher,
          "qr_proof_required",
          409,
        );
        await this.activate(manager, order, `qr-${order.id}`);
      } else {
        await manager.query(
          "UPDATE subscription_orders SET status='cancelled' WHERE id=?",
          [order.id],
        );
      }
      await manager.query(
        "UPDATE qr_payment_attempts SET status=?,reviewed_by=?,reviewed_at=?,reason_cipher=?,version=version+1 WHERE order_id=?",
        [
          data.approve ? "approved" : "rejected",
          actor.userId,
          this.now(),
          seal(this.secret, data.reason),
          order.id,
        ],
      );
      await this.audit(
        manager,
        actor,
        data.approve ? "qr.payment.approved" : "qr.payment.rejected",
        order.id,
      );
      return { ok: true };
    });
  }
  /** Release proof only as an authenticated attachment; never render uploaded PDF/image evidence inline. */
  async qrProof(context: OnboardingContext, id: unknown) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context),
        { attempt } = await this.qrAttempt(manager, actor, id);
      requireValue(attempt.proof_cipher, "qr_proof_required", 404);
      const saved = unseal<{ proof: string }>(
        this.secret,
        attempt.proof_cipher,
      );
      return qrFile(saved.proof, true);
    });
  }

  /** Create or resume one hosted payment only after consent evidence has been durably archived. */
  async payment(context: OnboardingContext, id: unknown) {
    const authorized = await this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context),
        row = await this.order(manager, actor, id);
      requireValue(
        ["signed", "payment_pending", "paid"].includes(row.status),
        "agreement_required",
        409,
      );
      if (row.status !== "paid") await this.eligible(manager, row);
      return { id: row.id };
    });
    await this.archive(authorized.id);
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context),
        row = await this.order(manager, actor, id);
      if (row.status === "paid") return { paid: true };
      requireValue(
        ["signed", "payment_pending"].includes(row.status) && row.agreement_id,
        "agreement_required",
        409,
      );
      await this.eligible(manager, row);
      if (row.total === 0) {
        await this.activate(manager, row, "no_charge");
        return { paid: true };
      }
      requireValue(row.payment_method !== "qr", "payment_method_locked", 409);
      const gateway = await this.gateway(actor.slug, manager);
      requireValue(gateway, "payments_unavailable", 503);
      requireValue(
        !row.dev || gateway.mode === "sandbox",
        "development_evidence_forbidden",
        403,
      );
      if (!row.payment_session) {
        const snapshot = unseal<Snapshot>(this.secret, row.snapshot_cipher);
        const session = await gateway.create({
          id: row.id,
          total: row.total,
          customerId: row.membership_id,
          name: snapshot.profile.fullName,
          email: snapshot.email,
          phone: snapshot.profile.phone,
          returnUrl: `${this.options.env.AUTH_BASE_URL}/ra/${actor.slug}/account/onboarding?order=${row.id}`,
          notifyUrl: `${this.options.env.AUTH_BASE_URL}/api/onboarding/webhooks/${actor.slug}`,
          expiresAt: iso(row.expires_at),
        });
        await manager.query(
          "UPDATE subscription_orders SET status='payment_pending',payment_method='cashfree',payment_session=? WHERE id=?",
          [session, row.id],
        );
        row.payment_session = session;
        await this.audit(manager, actor, "payment.created", row.id);
      }
      return { session: row.payment_session, mode: gateway.mode };
    });
  }
  /** Atomically activate once and queue documents/email independently of the browser lifecycle. */
  private async activate(
    manager: EntityManager,
    row: OrderRow,
    paymentId: string,
  ) {
    if (row.status === "paid") return;
    requireValue(
      row.agreement_id &&
        row.signed_at &&
        ["signed", "payment_pending"].includes(row.status),
      "agreement_required",
      409,
    );
    const start = this.now(),
      finish = new Date(start.getTime() + row.days * 86400000);
    await manager.query(
      "UPDATE subscription_orders SET status='paid',paid_at=?,starts_at=?,ends_at=?,payment_id=? WHERE id=?",
      [start, start, finish, paymentId, row.id],
    );
    await manager.query(
      "UPDATE tenant_memberships SET onboarding_stage='complete',lock_version=lock_version+1 WHERE tenant_id=? AND id=?",
      [row.tenant_id, row.membership_id],
    );
    await manager.query(
      "INSERT IGNORE INTO onboarding_deliveries(order_id) VALUES (?)",
      [row.id],
    );
    await manager.query(
      "INSERT INTO audit_events(id,scope,tenant_id,actor_type,action,entity_type,entity_id,metadata_json) VALUES (?,'tenant',?,'system','subscription.activated','order',?,'{\"schemaVersion\":1}')",
      [randomUUID(), row.tenant_id, row.id],
    );
  }
  /** Resolve tenant credentials using the current transaction when available, preserving replica and pool consistency. */
  private async gateway(slug: string, manager?: EntityManager) {
    return this.options.resolveGateway
      ? this.options.resolveGateway(slug, manager)
      : this.options.gateways?.get(slug);
  }
  /** Reconcile a callback/webhook with Cashfree, including payments arriving after quote expiry. */
  async reconcile(slug: string, id: string) {
    const gateway = await this.gateway(slug);
    requireValue(gateway, "payments_unavailable", 503);
    return this.db.transaction(async (manager) => {
      const [tenant] = await manager.query(
        "SELECT id FROM tenants WHERE slug=? FOR UPDATE",
        [slug],
      );
      requireValue(tenant, "order_not_found", 404);
      const [row]: OrderRow[] = await manager.query(
        "SELECT * FROM subscription_orders WHERE tenant_id=? AND id=? FOR UPDATE",
        [tenant.id, uuid(id)],
      );
      requireValue(row, "order_not_found", 404);
      requireValue(row.payment_method !== "qr", "payment_method_locked", 409);
      if (row.status === "paid") return { paid: true };
      requireValue(
        row.status === "payment_pending" &&
          (!row.dev || gateway.mode === "sandbox"),
        "invalid_order_state",
        409,
      );
      const paymentId = await gateway.paid(row.id, row.total);
      if (!paymentId) {
        if (await gateway.closed?.(row.id))
          await manager.query(
            "UPDATE subscription_orders SET status='cancelled' WHERE id=?",
            [row.id],
          );
        return { paid: false };
      }
      // A late genuine payment is retained and fulfilled, never lost solely due to local quote expiry.
      await this.activate(manager, row, paymentId);
      return { paid: true };
    });
  }
  /** Authorize a browser's reconciliation request before checking provider state. */
  async confirm(context: OnboardingContext, id: unknown) {
    const target = await this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context),
        row = await this.order(manager, actor, id);
      return { slug: actor.slug, id: row.id };
    });
    return this.reconcile(target.slug, target.id);
  }
  /** Verify raw webhook bytes with the exact RA merchant secret before reading its order ID. */
  async webhook(
    slug: string,
    raw: Buffer,
    timestamp: string,
    signature: string,
  ) {
    const gateway = await this.gateway(slug);
    requireValue(
      gateway?.verify(raw, timestamp, signature),
      "invalid_webhook_signature",
      401,
    );
    const payload = JSON.parse(raw.toString("utf8"));
    if (payload.type !== "PAYMENT_SUCCESS_WEBHOOK") return { received: true };
    return this.reconcile(slug, uuid(payload.data?.order?.order_id));
  }
  /** Generate the RA-issued invoice from frozen tax/pricing facts and confirmed payment, separately from Cashfree merchant fees. */
  private async invoice(row: OrderRow): Promise<Buffer> {
    const snapshot = unseal<Snapshot>(this.secret, row.snapshot_cipher);
    const [qrAttempt] =
      row.payment_method === "qr"
        ? await this.db.query(
            "SELECT proof_cipher FROM qr_payment_attempts WHERE order_id=? AND tenant_id=?",
            [row.id, row.tenant_id],
          )
        : [];
    const qrReference = qrAttempt?.proof_cipher
      ? unseal<{ reference: string }>(this.secret, qrAttempt.proof_cipher)
          .reference
      : "";
    const content = `${row.dev ? "DEVELOPMENT / SANDBOX — NOT A TAX INVOICE\n" : "PAYMENT RECEIPT / COMMERCIAL INVOICE\n"}Invoice number: SB-${row.id}\nRA: ${snapshot.raName}\nSEBI: ${snapshot.registration}\nAddress: ${snapshot.settings.address}\nContact: ${snapshot.settings.contact}\nGSTIN: ${snapshot.settings.gstin || "Not registered / no GST charged"}\nCustomer: ${snapshot.profile.fullName}\nEmail: ${snapshot.email}\nPlan: ${snapshot.planName}\nFees: ${money(row.subtotal)}\nDiscount (${snapshot.couponCode || "none"}): ${money(row.discount)}\nTax: ${money(row.tax)}\nTotal paid: ${money(row.total)}\nPayment method: ${row.payment_id === "no_charge" ? "no_charge" : (row.payment_method ?? "cashfree")}\nPayment reference: ${qrReference || row.payment_id}\nPaid: ${row.paid_at ? iso(row.paid_at) : ""}\nService starts: ${row.starts_at ? iso(row.starts_at) : ""}\nService ends: ${row.ends_at ? iso(row.ends_at) : ""}\n`;
    return pdf(content);
  }
  /** Lease one durable delivery, archive invoice and retry email independently of successful payment. */
  async deliverOne(): Promise<boolean> {
    const job = await this.db.transaction(async (manager) => {
      const [row] = await manager.query(
        "SELECT order_id FROM onboarding_deliveries WHERE status<>'sent' AND available_at<=UTC_TIMESTAMP(3) AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3)) ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!row) return null;
      await manager.query(
        "UPDATE onboarding_deliveries SET status='sending',attempts=attempts+1,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE) WHERE order_id=?",
        [row.order_id],
      );
      return String(row.order_id);
    });
    if (!job) return false;
    try {
      const [row]: OrderRow[] = await this.db.query(
        "SELECT * FROM subscription_orders WHERE id=? AND status='paid'",
        [job],
      );
      requireValue(row, "order_not_paid", 409);
      const snapshot = unseal<Snapshot>(this.secret, row.snapshot_cipher);
      const agreementBytes = await this.archive(row.id),
        invoiceBytes = await this.invoice(row);
      await this.options.documents.storeOrderEvidence(
        row.id,
        "invoice",
        invoiceBytes,
      );
      const archivedInvoice = await this.options.documents.readOrderEvidence(
        row.id,
        "invoice",
      );
      requireValue(this.options.mailer, "email_unavailable", 503);
      const [tenant] = await this.db.query(
        "SELECT slug FROM tenants WHERE id=?",
        [row.tenant_id],
      );
      await this.options.mailer({
        to: snapshot.email,
        url: `${this.options.env.AUTH_BASE_URL}/ra/${tenant.slug}/account/onboarding`,
        kind: "receipt",
        attachments: [
          {
            filename: `Agreement-${row.id}.pdf`,
            content: agreementBytes,
            contentType: "application/pdf",
          },
          {
            filename: `Invoice-${row.id}.pdf`,
            content: archivedInvoice,
            contentType: "application/pdf",
          },
        ],
      });
      await this.db.query(
        "UPDATE onboarding_deliveries SET status='sent',sent_at=UTC_TIMESTAMP(3),lease_until=NULL WHERE order_id=?",
        [job],
      );
      return true;
    } catch {
      (this.options.report ?? reportBackground)("delivery", job);
      await this.db.query(
        "UPDATE onboarding_deliveries SET status='pending',lease_until=NULL,available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE) WHERE order_id=?",
        [job],
      );
      return false;
    }
  }
  private lastQueueAlert = 0;
  /** Report backlogs older than one hour at most once per fifteen minutes per worker process. */
  async monitorQueues(): Promise<void> {
    const now = this.now().getTime();
    if (now - this.lastQueueAlert < 15 * 60 * 1000) return;
    const [row] = await this.db.query(
      "SELECT MIN(CASE WHEN d.status<>'sent' THEN o.paid_at END) AS delivery_since,MIN(CASE WHEN o.status='payment_pending' THEN o.created_at END) AS payment_since FROM subscription_orders o LEFT JOIN onboarding_deliveries d ON d.order_id=o.id",
    );
    for (const [field, stage] of [
      ["delivery_since", "delivery_queue_age"],
      ["payment_since", "payment_queue_age"],
    ] as const)
      if (
        row?.[field] &&
        now - new Date(iso(row[field])).getTime() >= 60 * 60 * 1000
      )
        (this.options.report ?? reportBackground)(stage);
    this.lastQueueAlert = now;
  }
  /** Project bounded operational status only to the current tenant's RA administrator. */
  async queueStatus(context: OnboardingContext) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context);
      requireValue(actor.role === "owner", "forbidden", 403);
      const rows = await manager.query(
        "SELECT o.id,o.payment_method,o.status AS payment_status,o.created_at,o.last_reconciled_at,d.status AS delivery_status,d.attempts,d.available_at,d.lease_until,d.sent_at,o.paid_at FROM subscription_orders o LEFT JOIN onboarding_deliveries d ON d.order_id=o.id WHERE o.tenant_id=? AND (o.status='payment_pending' OR d.order_id IS NOT NULL) ORDER BY (o.status='payment_pending' OR d.status<>'sent') DESC,CASE WHEN o.status='payment_pending' OR d.status<>'sent' THEN o.created_at END,o.created_at DESC,o.id LIMIT 100",
        [actor.tenantId],
      );
      return rows.map((row: Record<string, string | number | Date | null>) => ({
        id: String(row.id),
        paymentStatus: String(row.payment_status),
        paymentMethod: row.payment_method ? String(row.payment_method) : null,
        deliveryStatus: row.delivery_status
          ? String(row.delivery_status)
          : null,
        attempts: Number(row.attempts ?? 0),
        queuedAt: iso((row.paid_at ?? row.created_at) as string | Date),
        availableAt: row.available_at
          ? iso(row.available_at as string | Date)
          : null,
        leaseUntil: row.lease_until
          ? iso(row.lease_until as string | Date)
          : null,
        sentAt: row.sent_at ? iso(row.sent_at as string | Date) : null,
        lastReconciledAt: row.last_reconciled_at
          ? iso(row.last_reconciled_at as string | Date)
          : null,
      }));
    });
  }
  /** Requeue an unsent, unleased delivery or reconcile pending funds after fresh tenant-admin authorization. */
  async retryJob(context: OnboardingContext, input: Record<string, unknown>) {
    const id = uuid(input.orderId);
    const target = await this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, context);
      requireValue(actor.role === "owner", "forbidden", 403);
      const [row]: OrderRow[] = await manager.query(
        "SELECT * FROM subscription_orders WHERE id=? AND tenant_id=? FOR UPDATE",
        [id, actor.tenantId],
      );
      requireValue(row, "order_not_found", 404);
      requireValue(
        ["paid", "payment_pending"].includes(row.status),
        "invalid_order_status",
        409,
      );
      requireValue(
        row.payment_method !== "qr" || row.status === "paid",
        "qr_manual_review_required",
        409,
      );
      if (row.status === "paid") {
        const [job] = await manager.query(
          "SELECT *,lease_until>UTC_TIMESTAMP(3) AS leased FROM onboarding_deliveries WHERE order_id=? FOR UPDATE",
          [id],
        );
        requireValue(
          job && job.status !== "sent" && !job.leased,
          "delivery_not_retryable",
          409,
        );
        await manager.query(
          "UPDATE onboarding_deliveries SET status='pending',available_at=UTC_TIMESTAMP(3),lease_until=NULL WHERE order_id=?",
          [id],
        );
      }
      await this.audit(manager, actor, "onboarding.retry_requested", id);
      return { slug: actor.slug, pending: row.status === "payment_pending" };
    });
    if (target.pending) await this.reconcile(target.slug, id);
    return { ok: true };
  }
  /** Recheck bounded pending payments to recover missed webhook notifications. */
  async reconcilePending(): Promise<void> {
    const rows: { id: string; slug: string }[] = await this.db.query(
      "SELECT o.id,t.slug FROM subscription_orders o JOIN tenants t ON t.id=o.tenant_id WHERE o.status='payment_pending' AND (o.payment_method IS NULL OR o.payment_method='cashfree') ORDER BY COALESCE(o.last_reconciled_at,o.created_at) LIMIT 20",
    );
    for (const row of rows) {
      try {
        await this.reconcile(row.slug, row.id);
      } catch {
        (this.options.report ?? reportBackground)("reconciliation", row.id);
      }
      await this.db.query(
        "UPDATE subscription_orders SET last_reconciled_at=UTC_TIMESTAMP(3) WHERE id=?",
        [row.id],
      );
    }
  }
}

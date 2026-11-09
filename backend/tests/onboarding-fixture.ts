import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import type { GoogleDriveStorage } from "../src/documents/drive";
import { DocumentService } from "../src/documents/service";
import { OnboardingService } from "../src/onboarding/service";
import type { ApplicationEmail } from "../src/auth/email";
import type { PaymentGateway } from "../src/onboarding/cashfree";

/** Controlled in-memory persistence adapter for workflow unit tests; real MariaDB/browser tests verify the actual dialect and constraints separately. */
export function onboardingFixture() {
  const memory = new DatabaseSync(":memory:");
  const definitions: Record<string, string> = {
    auth_users:
      "id TEXT PRIMARY KEY,name TEXT,email TEXT,email_verified INTEGER,signup_phone TEXT,platform_role TEXT",
    auth_sessions:
      "id TEXT PRIMARY KEY,user_id TEXT,token TEXT,expires_at TEXT",
    tenants:
      "id TEXT PRIMARY KEY,slug TEXT,status TEXT,legal_name TEXT,registration_number TEXT,display_name TEXT",
    tenant_memberships:
      "id TEXT PRIMARY KEY,tenant_id TEXT,user_id TEXT,role TEXT,status TEXT,capabilities_json TEXT,full_name TEXT,mobile TEXT,onboarding_stage TEXT,lock_version INTEGER DEFAULT 1",
    ra_agreement_settings:
      "tenant_id TEXT PRIMARY KEY,terms TEXT,contact TEXT,address TEXT,gstin TEXT,annual_limit INTEGER,reviewed INTEGER,version INTEGER",
    subscription_plans:
      "id TEXT PRIMARY KEY,tenant_id TEXT,name TEXT,description TEXT,days INTEGER,price INTEGER,tax_bps INTEGER,active INTEGER,version INTEGER",
    discount_codes:
      "id TEXT PRIMARY KEY,tenant_id TEXT,code TEXT,type TEXT,value INTEGER,plan_id TEXT,starts_at TEXT,ends_at TEXT,usage_limit INTEGER,per_user INTEGER,active INTEGER,version INTEGER,UNIQUE(tenant_id,code)",
    investor_kyc:
      "membership_id TEXT PRIMARY KEY,tenant_id TEXT,profile_cipher TEXT,pan_hash TEXT,family_hash TEXT,status TEXT,version INTEGER,reason TEXT DEFAULT '',provider TEXT DEFAULT 'kfin_manual',provider_status TEXT,reference TEXT,evidence_id TEXT,reviewed_by TEXT,checked_at TEXT,submitted_at TEXT",
    kyc_history:
      "id TEXT PRIMARY KEY,tenant_id TEXT,membership_id TEXT,version INTEGER,snapshot_cipher TEXT,actor_id TEXT,created_at TEXT",
    subscription_orders:
      "id TEXT PRIMARY KEY,tenant_id TEXT,membership_id TEXT,plan_id TEXT,coupon_id TEXT,request_key TEXT,snapshot_cipher TEXT,signature_cipher TEXT,agreement_hash TEXT,family_hash TEXT,subtotal INTEGER,discount INTEGER,tax INTEGER,total INTEGER,days INTEGER,status TEXT DEFAULT 'quoted',dev INTEGER,expires_at TEXT,signed_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,paid_at TEXT,last_reconciled_at TEXT,starts_at TEXT,ends_at TEXT,payment_id TEXT,payment_session TEXT,agreement_id TEXT,invoice_id TEXT,otp_hash TEXT,otp_attempts INTEGER DEFAULT 0,otp_sent_at TEXT,otp_expires_at TEXT",
    onboarding_deliveries:
      "order_id TEXT PRIMARY KEY,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,available_at TEXT DEFAULT CURRENT_TIMESTAMP,lease_until TEXT,sent_at TEXT",
    documents:
      "id TEXT PRIMARY KEY,tenant_id TEXT,customer_id TEXT,kind TEXT,original_name TEXT,mime_type TEXT,byte_size INTEGER,sha256 TEXT,drive_file_id TEXT,drive_folder_id TEXT,uploaded_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP",
    audit_events:
      "id TEXT PRIMARY KEY,scope TEXT,tenant_id TEXT,actor_type TEXT,actor_user_id TEXT,actor_membership_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,metadata_json TEXT,occurred_at TEXT DEFAULT CURRENT_TIMESTAMP",
  };
  for (const [table, fields] of Object.entries(definitions))
    memory.exec(`CREATE TABLE ${table} (${fields})`);
  /** Translate only the dialect features exercised by the controlled unit adapter. */
  const query = async (original: string, parameters: unknown[] = []) => {
    let sql = original
      .replace(/\s+(FOR UPDATE(?: SKIP LOCKED)?|LOCK IN SHARE MODE)/g, "")
      .replaceAll("INSERT IGNORE", "INSERT OR IGNORE")
      .replace(
        /DATE_ADD\(UTC_TIMESTAMP\(3\),INTERVAL (\d+) MINUTE\)/g,
        "datetime('now','+$1 minutes')",
      )
      .replaceAll("UTC_TIMESTAMP(3)", "strftime('%Y-%m-%d %H:%M:%f','now')");
    sql = sql
      .replace(" ON DUPLICATE KEY UPDATE ", " ON CONFLICT DO UPDATE SET ")
      .replace(/VALUES\((\w+)\)/g, "excluded.$1");
    const values = parameters.map((value) =>
      value instanceof Date
        ? value.toISOString().replace("T", " ").replace("Z", "")
        : typeof value === "boolean"
          ? Number(value)
          : (value ?? null),
    ) as (string | number | null)[];
    const statement = memory.prepare(sql);
    if (/^SELECT/i.test(sql)) return statement.all(...values);
    statement.run(...values);
    return [];
  };
  const db = {
    query,
    transaction: async <T>(
      operation: (manager: { query: typeof query }) => Promise<T>,
    ) => {
      memory.exec("BEGIN");
      try {
        const result = await operation({ query });
        memory.exec("COMMIT");
        return result;
      } catch (error) {
        memory.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as DataSource;
  const tenantId = randomUUID(),
    otherTenantId = randomUUID(),
    memberId = randomUUID(),
    otherMemberId = randomUUID(),
    adminMemberId = randomUUID(),
    userId = randomUUID(),
    adminId = randomUUID();
  memory
    .prepare("INSERT INTO tenants VALUES (?,?,?,?,?,?)")
    .run(tenantId, "alpha", "active", "Alpha Legal", "INH-FIXTURE", "Alpha");
  memory
    .prepare("INSERT INTO tenants VALUES (?,?,?,?,?,?)")
    .run(otherTenantId, "beta", "active", "Beta Legal", "INH-FIXTURE", "Beta");
  for (const [id, name, email, role, token, membership, scope] of [
    [
      userId,
      "Example Investor",
      "investor@example.test",
      "subscriber",
      "investor-token",
      memberId,
      tenantId,
    ],
    [
      adminId,
      "RA Admin",
      "admin@example.test",
      "owner",
      "admin-token",
      adminMemberId,
      tenantId,
    ],
    [
      randomUUID(),
      "Other Investor",
      "other@example.test",
      "subscriber",
      "other-token",
      otherMemberId,
      tenantId,
    ],
    [
      randomUUID(),
      "Foreign Admin",
      "foreign@example.test",
      "owner",
      "foreign-token",
      randomUUID(),
      otherTenantId,
    ],
  ]) {
    memory
      .prepare("INSERT INTO auth_users VALUES (?,?,?,1,'9876543210',NULL)")
      .run(id, name, email);
    memory
      .prepare("INSERT INTO auth_sessions VALUES (?,?,?,'2099-01-01 00:00:00')")
      .run(randomUUID(), id, token);
    memory
      .prepare(
        "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,status,capabilities_json) VALUES (?,?,?,?,'active','{}')",
      )
      .run(membership, scope, id, role);
  }
  const files = new Map<string, Buffer>();
  const drive = {
    config: { mainId: "main" },
    verify: async () => {},
    tenantFolder: async (id: string) => `ra_${id}`,
    folder: async (parent: string, child: string) => `${parent}_${child}`,
    upload: async (
      _parent: string,
      _name: string,
      _mime: string,
      bytes: Buffer,
    ) => {
      const id = randomUUID();
      files.set(id, Buffer.from(bytes));
      return id;
    },
    download: async (id: string) => files.get(id)!,
  } as unknown as GoogleDriveStorage;
  const documents = new DocumentService(db, drive),
    messages: ApplicationEmail[] = [],
    paid = new Set<string>();
  let mailFail = false,
    terminal = false;
  const gateway: PaymentGateway = {
    mode: "sandbox",
    create: async (order) => `session-${order.id}`,
    paid: async (id) => (paid.has(id) ? `payment-${id}` : null),
    closed: async () => terminal,
    verify: (_raw, _timestamp, signature) => signature === "valid",
  };
  const env = {
    ONBOARDING_DATA_KEY: "a".repeat(64),
    AUTH_SECRET: "unit-test-onboarding-secret-at-least-32-characters",
    AUTH_BASE_URL: "http://localhost:3000",
    DB_ENV: "dev",
    ONBOARDING_DEV_SKIP: "true",
  };
  const options = {
    env,
    documents,
    mailer: async (message: ApplicationEmail) => {
      if (mailFail) throw new Error("mail down");
      messages.push(message);
    },
    gateways: new Map([["alpha", gateway]]),
  };
  const service = new OnboardingService(db, options);
  const investor = { token: "investor-token", tenantId },
    admin = { token: "admin-token", tenantId },
    other = { token: "other-token", tenantId };
  const profile = {
    fullName: "Example Investor",
    phone: "9876543210",
    pan: "ABCPD1234E",
    dob: "1990-01-01",
    familyPan: "",
    declaration: true,
  };
  /** Seed genuine-looking synthetic evidence through the real document service for unit workflow interactions. */
  const evidence = async (context = investor, customerId?: string) =>
    documents.upload(context, {
      kind: "kyc",
      customerId,
      name: "fixture.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-1.4\nFixture\n%%EOF"),
    });
  /** Configure an RA-owned offer and reviewed synthetic legal text before checkout scenarios. */
  const setup = async () => {
    const plan = await service.manage(admin, "plan", {
      version: 0,
      name: "Monthly",
      description: "Research reports",
      days: 30,
      price: 200000,
      taxBps: 0,
      active: true,
    });
    await service.manage(admin, "settings", {
      version: 0,
      terms: "Research services and MITC test wording. ".repeat(25),
      contact: "ra@example.test",
      address: "Example RA address",
      gstin: "",
      annualLimit: 15100000,
      reviewed: true,
    });
    const document = await evidence();
    await service.saveKyc(
      investor,
      { ...profile, version: 0, documentId: document.id },
      true,
    );
    const proof = await evidence(admin, memberId);
    await service.review(admin, {
      customerId: memberId,
      version: 1,
      status: "verified",
      providerStatus: "KYC VALIDATED",
      reference: "KFIN-fixture",
      evidenceId: proof.id,
    });
    return { planId: plan.id, documentId: document.id, evidenceId: proof.id };
  };
  return {
    db,
    memory,
    query,
    service,
    documents,
    messages,
    paid,
    gateway,
    options,
    env,
    tenantId,
    otherTenantId,
    memberId,
    otherMemberId,
    adminMemberId,
    userId,
    adminId,
    investor,
    admin,
    other,
    profile,
    evidence,
    setup,
    files,
    setMailFail: (value: boolean) => {
      mailFail = value;
    },
    setTerminal: (value: boolean) => {
      terminal = value;
    },
    close: () => memory.close(),
  };
}

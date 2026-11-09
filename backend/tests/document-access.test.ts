import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import { DocumentService, DocumentError } from "../src/documents/service";
import type { GoogleDriveStorage } from "../src/documents/drive";
import {
  documentAllowed,
  documentKinds,
  type DocumentActor,
  type DocumentKind,
} from "../src/documents/policy";

const tenantA = randomUUID(),
  tenantB = randomUUID();
const customerA = randomUUID(),
  customerB = randomUUID(),
  customerOtherRA = randomUUID();
const user = randomUUID();
const bytes = Buffer.from("%PDF-1.4\nAccess test\n%%EOF");
type Row = {
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
/** Create independently owned records; provider identifiers and filenames must never determine authorization. */
function row(
  tenant: string | null,
  customer: string | null,
  kind: DocumentKind,
): Row {
  return {
    id: randomUUID(),
    tenant_id: tenant,
    customer_id: customer,
    kind,
    original_name: "private-proof.pdf",
    mime_type: "application/pdf",
    byte_size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    drive_file_id: randomUUID(),
    drive_folder_id: "private-folder",
    created_at: "2026-11-08 00:00:00.000",
  };
}
/** Model current database facts, with strict SQL-envelope assertions and an optional faulty row projection. */
function harness(role = "owner", platform = false) {
  const state = {
    eligible: true,
    inTransaction: false,
    leaseToken: "",
    session: true,
    currentSession: true,
    verified: true,
    platform,
    overrides: { allow: [] as string[], deny: [] as string[] },
    tenants: [
      { id: tenantA, status: "active" },
      { id: tenantB, status: "active" },
    ],
    members: [
      {
        id: role === "subscriber" ? customerA : randomUUID(),
        tenant: tenantA,
        user,
        role,
        status: "active",
      },
    ],
    rows: [] as Row[],
    leakRows: false,
    queries: [] as { sql: string; parameters: unknown[] }[],
    providerCalls: 0,
    downloads: [] as string[],
    audits: [] as unknown[][],
  };
  const query = async (sql: string, parameters: unknown[] = []) => {
    state.queries.push({ sql, parameters });
    if (sql.startsWith("INSERT IGNORE INTO document_storage_leases")) return [];
    if (sql.startsWith("SELECT token,lease_until"))
      return [{ token: state.leaseToken, expired: state.leaseToken ? 0 : 1 }];
    if (sql.startsWith("UPDATE document_storage_leases")) {
      state.leaseToken = String(parameters[0]);
      return [];
    }
    if (sql.startsWith("DELETE FROM document_storage_leases")) {
      state.leaseToken = "";
      return [];
    }
    if (sql.startsWith("SELECT status FROM investor_kyc"))
      return [{ status: state.eligible ? "verified" : "pending" }];
    if (sql.startsWith("SELECT dev FROM subscription_orders"))
      return [{ dev: 0 }];
    if (sql.startsWith("SELECT u.id,u.platform_role FROM auth_sessions"))
      return state.session &&
        state.verified &&
        parameters[0] === "valid-session"
        ? [{ id: user, platform_role: state.platform ? "owner" : null }]
        : [];
    if (
      sql.startsWith("SELECT id,platform_role,email_verified FROM auth_users")
    )
      return [
        {
          id: user,
          platform_role: state.platform ? "owner" : null,
          email_verified: state.verified ? 1 : 0,
        },
      ];
    if (sql.startsWith("SELECT id FROM auth_sessions"))
      return state.currentSession ? [{ id: "session" }] : [];
    if (sql.startsWith("SELECT id,display_name FROM tenants"))
      return state.tenants
        .filter(
          (tenant) => tenant.id === parameters[0] && tenant.status === "active",
        )
        .map((tenant) => ({ ...tenant, display_name: "Same RA name" }));
    if (
      sql.startsWith("SELECT id,role,capabilities_json FROM tenant_memberships")
    )
      return state.members
        .filter(
          (member) =>
            member.tenant === parameters[0] &&
            member.user === parameters[1] &&
            member.status === "active",
        )
        .map((member) => ({
          id: member.id,
          role: member.role,
          capabilities_json: JSON.stringify(state.overrides),
        }));
    if (sql.startsWith("SELECT id FROM tenant_memberships"))
      return [customerA, customerB].some((id) => id === parameters[1]) &&
        parameters[0] === tenantA
        ? [{ id: parameters[1] }]
        : [];
    if (sql.startsWith("SELECT m.id,u.name FROM tenant_memberships")) {
      assert.equal(parameters[0], tenantA);
      return [
        { id: customerA, name: "First client" },
        { id: customerB, name: "Second client" },
      ];
    }
    if (sql.startsWith("SELECT * FROM documents")) {
      assert.match(sql, /WHERE tenant_id <=> \?/);
      if (sql.endsWith("AND id=?"))
        return state.rows.filter(
          (record) =>
            record.id === parameters[1] &&
            (state.leakRows || record.tenant_id === parameters[0]),
        );
      assert.match(sql, /ORDER BY created_at DESC,id DESC LIMIT 101$/);
      if (state.leakRows) return state.rows;
      const kinds =
        sql
          .match(/AND \(kind IN \(([^)]+)\)/)?.[1]
          .replaceAll("'", "")
          .split(",") ?? [];
      const cursor = parameters[1]
        ? state.rows.findIndex((record) => record.id === parameters[1])
        : -1;
      return state.rows
        .filter(
          (record, index) =>
            record.tenant_id === parameters[0] &&
            kinds.includes(record.kind) &&
            (!sql.includes("AND customer_id=?") ||
              record.customer_id === parameters.at(-1)) &&
            (cursor < 0 || index > cursor),
        )
        .slice(0, 101);
    }
    if (sql.startsWith("INSERT INTO documents")) {
      state.rows.push({
        ...row(
          parameters[1] as string | null,
          parameters[2] as string | null,
          parameters[3] as DocumentKind,
        ),
        id: String(parameters[0]),
        drive_file_id: String(parameters[8]),
      });
      return [];
    }
    if (sql.startsWith("INSERT INTO audit_events")) {
      state.audits.push(parameters);
      return [];
    }
    throw new Error(`Unexpected document access query: ${sql}`);
  };
  const db = {
    query,
    transaction: async (run: (manager: EntityManager) => Promise<unknown>) => {
      state.inTransaction = true;
      try {
        return await run({ query } as unknown as EntityManager);
      } finally {
        state.inTransaction = false;
      }
    },
  } as unknown as DataSource;
  const drive = {
    config: { rootId: "root", mainId: "main" },
    verify: async () => {
      assert.equal(
        state.inTransaction,
        false,
        "Drive must not hold database transactions",
      );
      state.providerCalls++;
    },
    tenantFolder: async () => "ra",
    folder: async (_parent: string, name: string) => name,
    upload: async () => {
      assert.equal(
        state.inTransaction,
        false,
        "Drive must not hold database transactions",
      );
      state.providerCalls++;
      return randomUUID();
    },
    download: async (id: string) => {
      assert.equal(
        state.inTransaction,
        false,
        "Drive must not hold database transactions",
      );
      state.providerCalls++;
      state.downloads.push(id);
      return bytes;
    },
  } as unknown as GoogleDriveStorage;
  return {
    state,
    service: new DocumentService(db, drive),
    context: { token: "valid-session", tenantId: tenantA as string | null },
  };
}
/** Require a precise safe error code rather than accepting an unrelated provider/database failure. */
async function denied(operation: Promise<unknown>, code: string) {
  await assert.rejects(
    operation,
    (error: unknown) => error instanceof DocumentError && error.code === code,
  );
}

test("document policy rejects cross-RA access for every role, kind and read/write action", () => {
  for (const role of ["owner", "analyst", "support", "subscriber", "unknown"])
    for (const kind of documentKinds)
      for (const write of [true, false]) {
        const actor: DocumentActor = {
          id: user,
          tenantId: tenantA,
          role,
          membershipId: customerA,
          platformOwner: true,
        };
        assert.equal(
          documentAllowed(
            actor,
            { tenantId: tenantB, kind, customerId: customerA },
            write,
          ),
          false,
          `${role}/${kind}/${write}`,
        );
      }
});

test("eligible customers can read only their own KYC, MITC and RA-provided evidence; guessed IDs cannot change ownership", async () => {
  const { service, state, context } = harness("subscriber");
  for (const kind of ["kyc", "mitc", "recommendation"] as const) {
    const own = row(tenantA, customerA, kind),
      other = row(tenantA, customerB, kind),
      foreign = row(tenantB, customerOtherRA, kind);
    state.rows.push(own, other, foreign);
    assert.deepEqual((await service.download(context, own.id)).bytes, bytes);
    const calls = state.providerCalls;
    await denied(service.download(context, other.id), "document_not_found");
    await denied(service.download(context, foreign.id), "document_not_found");
    assert.equal(
      state.providerCalls,
      calls,
      "denied reads must not contact Drive",
    );
  }
  state.rows.push(row(tenantA, null, "general"), row(null, null, "contract"));
  const result = await service.list(context);
  assert.equal(result.documents.length, 3);
  assert.ok(
    result.documents.every((document) => document.customerId === customerA),
  );
  assert.deepEqual(await service.customers(context), []);
  await denied(service.download(context, randomUUID()), "document_not_found");
  await denied(
    service.download(context, "not-a-document-id"),
    "document_not_found",
  );
  assert.equal(JSON.stringify(result).includes("drive_file_id"), false);
});

test("RA admins can list and download every own client's documents, including historical retained evidence", async () => {
  const { service, state, context } = harness("owner");
  for (const customer of [customerA, customerB])
    for (const kind of ["kyc", "mitc", "recommendation"] as const)
      state.rows.push(row(tenantA, customer, kind));
  state.rows.push(
    row(tenantA, null, "general"),
    row(tenantB, customerOtherRA, "recommendation"),
  );
  const listed = await service.list(context);
  assert.equal(listed.documents.length, 7);
  for (const document of listed.documents)
    assert.deepEqual(
      (await service.download(context, document.id)).bytes,
      bytes,
    );
  assert.equal((await service.customers(context)).length, 2);
  assert.equal(
    state.audits.length,
    7,
    "each released download must be audited",
  );
  await denied(
    service.download(context, state.rows.at(-1)!.id),
    "document_not_found",
  );
});

test("tenant changes cannot grant an RA access elsewhere, including when one user holds roles in two RAs", async () => {
  const { service, state, context } = harness("owner");
  state.rows.push(
    row(tenantA, customerA, "kyc"),
    row(tenantB, customerOtherRA, "kyc"),
  );
  const foreign = { ...context, tenantId: tenantB };
  await denied(service.list(foreign), "forbidden");
  await denied(service.download(foreign, state.rows[0].id), "forbidden");
  state.members.push({
    id: customerOtherRA,
    tenant: tenantB,
    user,
    role: "subscriber",
    status: "active",
  });
  assert.equal((await service.list(foreign)).documents.length, 1);
  assert.deepEqual(
    (await service.download(foreign, state.rows[1].id)).bytes,
    bytes,
  );
  await denied(
    service.download(foreign, state.rows[0].id),
    "document_not_found",
  );
  await denied(
    service.download(context, state.rows[1].id),
    "document_not_found",
  );
});

test("a platform owner has no implicit RA or client document access through platform or tenant endpoints", async () => {
  const { service, state, context } = harness("subscriber", true);
  state.members = [];
  state.rows.push(
    row(null, null, "contract"),
    row(null, null, "owner"),
    row(tenantA, customerA, "kyc"),
    row(tenantA, null, "general"),
  );
  const platform = { ...context, tenantId: null };
  assert.equal((await service.list(platform)).documents.length, 2);
  assert.deepEqual(
    (await service.download(platform, state.rows[0].id)).bytes,
    bytes,
  );
  await denied(
    service.download(platform, state.rows[2].id),
    "document_not_found",
  );
  await denied(service.list(context), "forbidden");
  await denied(service.download(context, state.rows[2].id), "forbidden");
});

test("a platform owner with an explicit subscriber membership receives only that subscriber's permissions", async () => {
  const { service, state, context } = harness("subscriber", true);
  state.rows.push(
    row(tenantA, customerA, "kyc"),
    row(tenantA, customerB, "kyc"),
    row(tenantA, customerA, "recommendation"),
  );
  assert.equal((await service.list(context)).documents.length, 2);
  await denied(
    service.download(context, state.rows[1].id),
    "document_not_found",
  );
  assert.deepEqual(
    (await service.download(context, state.rows[2].id)).bytes,
    bytes,
  );
});

test("pagination rejects another client's or RA's cursor without revealing metadata or affecting the visible page", async () => {
  const { service, state, context } = harness("subscriber");
  state.rows.push(
    row(tenantA, customerB, "kyc"),
    row(tenantB, customerOtherRA, "recommendation"),
  );
  for (let index = 0; index < 102; index++)
    state.rows.push(row(tenantA, customerA, "recommendation"));
  for (const id of [
    state.rows[0].id,
    state.rows[1].id,
    randomUUID(),
    "malformed",
  ])
    await denied(service.list(context, id), "invalid_cursor");
  const first = await service.list(context);
  assert.equal(first.documents.length, 100);
  assert.equal(first.nextCursor, first.documents.at(-1)?.id);
  const second = await service.list(context, first.nextCursor!);
  assert.equal(second.documents.length, 2);
  assert.equal(second.nextCursor, null);
});

test("policy rechecks row tenant/customer scope even if a repository accidentally returns excessive rows", async () => {
  for (const role of ["owner", "subscriber"]) {
    const { service, state, context } = harness(role);
    state.leakRows = true;
    state.rows.push(row(tenantA, customerA, "mitc"));
    for (let index = 0; index < 105; index++)
      state.rows.push(row(tenantB, customerA, "mitc"));
    if (role === "subscriber") state.rows.push(row(tenantA, customerB, "mitc"));
    const result = await service.list(context);
    assert.equal(result.documents.length, 1);
    assert.equal(
      result.nextCursor,
      null,
      "unauthorized row IDs cannot become cursors",
    );
    await denied(
      service.download(context, state.rows[1].id),
      "document_not_found",
    );
  }
});

test("revoked sessions/memberships, unverified users, suspended tenants and overrides stop all subsequent document access", async () => {
  for (const scenario of [
    "session",
    "currentSession",
    "verified",
    "membership",
    "tenant",
    "overrides",
  ]) {
    const { service, state, context } = harness("subscriber");
    const own = row(tenantA, customerA, "recommendation");
    state.rows.push(own);
    assert.deepEqual((await service.download(context, own.id)).bytes, bytes);
    const calls = state.providerCalls;
    if (
      scenario === "session" ||
      scenario === "currentSession" ||
      scenario === "verified"
    )
      state[scenario] = false;
    if (scenario === "membership") state.members[0].status = "revoked";
    if (scenario === "tenant") state.tenants[0].status = "suspended";
    if (scenario === "overrides") state.overrides.deny = ["website:edit"];
    const code = ["session", "currentSession", "verified"].includes(scenario)
      ? "unauthorized"
      : "forbidden";
    await denied(service.list(context), code);
    await denied(service.download(context, own.id), code);
    await denied(service.customers(context), code);
    assert.equal(state.providerCalls, calls);
  }
});

test("uploads derive customer ownership server-side and reject foreign staff-selected customer IDs before Drive access", async () => {
  const input = {
    kind: "kyc",
    name: "proof.pdf",
    mime: "application/pdf",
    bytes,
    customerId: customerB,
  };
  const customer = harness("subscriber");
  await customer.service.upload(customer.context, input);
  assert.equal(customer.state.rows[0].customer_id, customerA);
  await denied(
    customer.service.upload(customer.context, {
      ...input,
      kind: "recommendation",
    }),
    "forbidden",
  );
  const admin = harness("owner");
  await denied(
    admin.service.upload(admin.context, {
      ...input,
      customerId: customerOtherRA,
    }),
    "customer_not_found",
  );
  assert.equal(admin.state.providerCalls, 0);
  await admin.service.upload(admin.context, {
    ...input,
    kind: "recommendation",
  });
  assert.equal(admin.state.rows[0].customer_id, customerB);
});

test("invalid document scopes fail closed and a platform flag cannot promote tenant-local roles", () => {
  const actor: DocumentActor = {
    id: user,
    tenantId: tenantA,
    role: "owner",
    membershipId: customerA,
    platformOwner: true,
  };
  for (const target of [
    { tenantId: tenantA, kind: "kyc" as const, customerId: null },
    { tenantId: tenantA, kind: "general" as const, customerId: customerA },
    { tenantId: tenantA, kind: "contract" as const, customerId: null },
    { tenantId: null, kind: "recommendation" as const, customerId: customerA },
    {
      tenantId: tenantA,
      kind: "unknown" as DocumentKind,
      customerId: customerA,
    },
  ])
    assert.equal(documentAllowed(actor, target, false), false);
  const platform = { ...actor, tenantId: null, role: null, membershipId: null };
  assert.equal(
    documentAllowed(
      platform,
      { tenantId: null, kind: "owner", customerId: customerA },
      false,
    ),
    false,
  );
});

test("service list policy covers staff roles and rejects invalid upload kinds, targets and content", async () => {
  for (const role of ["analyst", "support", "unknown"]) {
    const { service, state, context } = harness(role);
    state.rows.push(
      row(tenantA, null, "general"),
      row(tenantA, customerA, "kyc"),
      row(tenantA, customerA, "recommendation"),
    );
    assert.equal(
      (await service.list(context)).documents.length,
      role === "unknown" ? 0 : 2,
    );
  }
  const { service, context } = harness();
  const input = {
    kind: "kyc",
    name: "proof.pdf",
    mime: "application/pdf",
    bytes,
  };
  await denied(
    service.upload(context, { ...input, kind: "unknown" }),
    "invalid_document_kind",
  );
  await denied(
    service.upload(context, { ...input, bytes: Buffer.from("spoof") }),
    "invalid_document",
  );
  await denied(service.upload(context, input), "invalid_document_target");
  await denied(
    service.upload(context, { ...input, customerId: "bad" }),
    "invalid_document_target",
  );
  await denied(
    service.upload(context, { ...input, kind: "owner" }),
    "invalid_document_target",
  );
  const platform = harness("owner", true);
  await denied(
    platform.service.upload({ ...platform.context, tenantId: null }, input),
    "invalid_document_target",
  );
  const member = harness("subscriber");
  await denied(
    member.service.list({ ...member.context, tenantId: null }),
    "forbidden",
  );
});

test("ineligible subscribers cannot list or download research but retain historical agreements and receipts", async () => {
  const { service, state, context } = harness("subscriber");
  state.eligible = false;
  const recommendation = row(tenantA, customerA, "recommendation"),
    agreement = row(tenantA, customerA, "mitc");
  state.rows.push(recommendation, agreement);
  await denied(
    service.download(context, recommendation.id),
    "research_eligibility_required",
  );
  assert.equal(state.providerCalls, 0);
  assert.deepEqual(
    (await service.list(context)).documents.map((d) => d.id),
    [agreement.id],
  );
  await denied(service.list(context, recommendation.id), "invalid_cursor");
  assert.deepEqual(
    (await service.download(context, agreement.id)).bytes,
    bytes,
  );
  state.leakRows = true;
  assert.deepEqual(
    (await service.list(context)).documents.map((d) => d.id),
    [agreement.id],
  );
});

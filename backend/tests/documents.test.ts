import { test } from "node:test";
import assert from "node:assert/strict";
import {
  documentAllowed,
  validateDocument,
  maxDocumentBytes,
  type DocumentActor,
} from "../src/documents/policy";
import {
  driveConfig,
  GoogleDriveStorage,
  type DriveConfig,
} from "../src/documents/drive";

const configuration: DriveConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  refreshToken: "test-refresh",
  rootId: "root-id",
  mainId: "main-id",
  account: "stocksbuddha@gmail.com",
};
const pdf = Buffer.from("%PDF-1.4\nTest document\n%%EOF");

test("document roles isolate identity documents, recommendation evidence and platform contracts", () => {
  const actor = (
    role: string | null,
    platformOwner = false,
  ): DocumentActor => ({
    id: "user",
    platformOwner,
    tenantId: platformOwner ? null : "tenant-a",
    role,
    membershipId: "customer-a",
  });
  for (const kind of ["kyc", "mitc"] as const) {
    for (const role of ["owner", "support", "subscriber"])
      assert.equal(
        documentAllowed(
          actor(role),
          { tenantId: "tenant-a", kind, customerId: "customer-a" },
          true,
        ),
        true,
      );
    assert.equal(
      documentAllowed(
        actor("analyst"),
        { tenantId: "tenant-a", kind, customerId: "customer-a" },
        false,
      ),
      false,
    );
    assert.equal(
      documentAllowed(
        actor("subscriber"),
        { tenantId: "tenant-a", kind, customerId: "customer-b" },
        false,
      ),
      false,
    );
    assert.equal(
      documentAllowed(
        actor(null, true),
        { tenantId: "tenant-a", kind, customerId: "customer-a" },
        false,
      ),
      false,
    );
  }
  assert.equal(
    documentAllowed(
      actor("analyst"),
      {
        tenantId: "tenant-a",
        kind: "recommendation",
        customerId: "customer-a",
      },
      true,
    ),
    true,
  );
  assert.equal(
    documentAllowed(
      actor("support"),
      {
        tenantId: "tenant-a",
        kind: "recommendation",
        customerId: "customer-a",
      },
      false,
    ),
    false,
  );
  assert.equal(
    documentAllowed(
      actor("subscriber"),
      {
        tenantId: "tenant-a",
        kind: "recommendation",
        customerId: "customer-a",
      },
      false,
    ),
    true,
  );
  assert.equal(
    documentAllowed(
      actor("subscriber"),
      {
        tenantId: "tenant-a",
        kind: "recommendation",
        customerId: "customer-a",
      },
      true,
    ),
    false,
  );
  for (const kind of ["contract", "owner"] as const) {
    assert.equal(
      documentAllowed(
        actor(null, true),
        { tenantId: null, kind, customerId: null },
        true,
      ),
      true,
    );
    for (const role of ["owner", "analyst", "support", "subscriber"])
      assert.equal(
        documentAllowed(
          actor(role),
          { tenantId: null, kind, customerId: null },
          false,
        ),
        false,
      );
  }
  assert.equal(
    documentAllowed(
      actor("support"),
      { tenantId: "tenant-a", kind: "general", customerId: null },
      true,
    ),
    false,
  );
  assert.equal(
    documentAllowed(
      actor("support"),
      { tenantId: "tenant-a", kind: "general", customerId: null },
      false,
    ),
    true,
  );
  assert.equal(
    documentAllowed(
      actor("subscriber"),
      { tenantId: "tenant-a", kind: "general", customerId: null },
      false,
    ),
    false,
  );
});

test("document validation rejects spoofed MIME types, invalid names and oversized bytes", () => {
  validateDocument("MITC-Signed.pdf", "application/pdf", pdf);
  validateDocument(
    "photo.jpeg",
    "image/jpeg",
    Buffer.from([255, 216, 255, 224]),
  );
  validateDocument(
    "photo.png",
    "image/png",
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
  );
  for (const [name, mime, bytes] of [
    ["fake.pdf", "application/pdf", Buffer.from("<script>bad</script>")],
    ["photo.jpg", "application/pdf", pdf],
    ["../proof.pdf", "application/pdf", pdf],
    ["proof\r\n.pdf", "application/pdf", pdf],
    ["proof.pdf", "text/html", pdf],
    ["empty.pdf", "application/pdf", Buffer.alloc(0)],
    [
      "big.pdf",
      "application/pdf",
      Buffer.concat([pdf, Buffer.alloc(maxDocumentBytes)]),
    ],
  ] as const)
    assert.throws(
      () => validateDocument(name, mime, bytes),
      /invalid_document/,
    );
});

test("Drive configuration remains disabled without credentials and rejects partial secrets", () => {
  assert.equal(driveConfig({ GOOGLE_DRIVE_ROOT_ID: "existing" }), null);
  assert.throws(
    () => driveConfig({ GOOGLE_DRIVE_CLIENT_ID: "client" }),
    /incomplete/,
  );
  const env = {
    GOOGLE_DRIVE_CLIENT_ID: "client",
    GOOGLE_DRIVE_CLIENT_SECRET: "secret",
    GOOGLE_DRIVE_REFRESH_TOKEN: "refresh",
    GOOGLE_DRIVE_ROOT_ID: "root-id",
    GOOGLE_DRIVE_MAIN_ID: "main-id",
  };
  assert.equal(driveConfig(env)?.account, "stocksbuddha@gmail.com");
  assert.throws(
    () => driveConfig({ ...env, GOOGLE_DRIVE_ROOT_ID: "a/b" }),
    /Invalid/,
  );
});

/** Simulate provider endpoints while checking that only expected HTTPS hosts receive credentials. */
function driveHarness() {
  const state = {
    email: configuration.account,
    shared: false,
    duplicates: false,
    refreshes: 0,
    folderCreates: 0,
    uploaded: Buffer.alloc(0),
    providerError: false,
    oversized: false,
  };
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.protocol, "https:");
    assert.equal(init?.redirect, "error");
    if (url.hostname === "oauth2.googleapis.com") {
      state.refreshes++;
      assert.match(String(init?.body), /grant_type=refresh_token/);
      return Response.json({ access_token: "access-token", expires_in: 3600 });
    }
    assert.equal(url.hostname, "www.googleapis.com");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer access-token",
    );
    if (state.providerError)
      return new Response("secret provider detail", { status: 403 });
    if (url.pathname.endsWith("/about"))
      return Response.json({ user: { emailAddress: state.email } });
    if (url.pathname === "/drive/v3/files" && init?.method !== "POST")
      return Response.json({
        files: state.duplicates ? [{ id: "a" }, { id: "b" }] : [],
      });
    if (url.pathname === "/drive/v3/files" && init?.method === "POST") {
      state.folderCreates++;
      return Response.json({ id: "new-folder" });
    }
    if (url.pathname === "/upload/drive/v3/files") {
      state.uploaded = Buffer.from(init?.body as Uint8Array);
      return Response.json({ id: "uploaded-file" });
    }
    if (url.searchParams.get("alt") === "media")
      return new Response(
        state.oversized ? Buffer.alloc(maxDocumentBytes + 1) : pdf,
      );
    const parent = url.pathname.endsWith("main-id")
      ? "root-id"
      : url.pathname.endsWith("new-folder")
        ? "root-id"
        : "parent-id";
    return Response.json({
      id: "folder",
      mimeType: "application/vnd.google-apps.folder",
      parents: [parent],
      permissions: [
        { type: "user", role: "owner", emailAddress: configuration.account },
        ...(state.shared ? [{ type: "anyone", role: "reader" }] : []),
      ],
    });
  };
  return { state, drive: new GoogleDriveStorage(configuration, request) };
}

test("Drive adapter verifies exact account/privacy and shares one token refresh across concurrent calls", async () => {
  const { drive, state } = driveHarness();
  await Promise.all([drive.verify(), drive.verify()]);
  assert.equal(state.refreshes, 1);
  state.email = "personal@example.test";
  await assert.rejects(drive.verify(), /drive_account_mismatch/);
  state.email = configuration.account;
  state.shared = true;
  await assert.rejects(drive.verify(), /drive_folder_not_private/);
  state.shared = false;
  state.providerError = true;
  await assert.rejects(
    drive.verify(),
    (error: Error) => error.message === "drive_request_failed",
  );
});

test("Drive adapter creates only unambiguous private folders and preserves raw upload/download bytes", async () => {
  const { drive, state } = driveHarness();
  assert.equal(await drive.folder("root-id", "customer-id"), "new-folder");
  assert.equal(state.folderCreates, 1);
  state.duplicates = true;
  await assert.rejects(
    drive.folder("root-id", "customer-id"),
    /drive_duplicate_folder/,
  );
  await assert.rejects(drive.folder("root-id", "bad'name"), /invalid_folder/);
  assert.equal(
    await drive.upload(
      "parent-id",
      "proof.pdf",
      "application/pdf",
      pdf,
      "document-id",
    ),
    "uploaded-file",
  );
  assert.ok(state.uploaded.includes(pdf));
  assert.match(state.uploaded.toString(), /stocksbuddhaDocumentId/);
  assert.match(state.uploaded.toString(), /document-id-proof.pdf/);
  assert.deepEqual(await drive.download("uploaded-file", "parent-id"), pdf);
  state.shared = true;
  await assert.rejects(
    drive.download("uploaded-file", "parent-id"),
    /drive_folder_not_private/,
  );
  state.shared = false;
  state.oversized = true;
  await assert.rejects(
    drive.download("uploaded-file", "parent-id"),
    /drive_oversized_download/,
  );
});

type StoredFolder = {
  id: string;
  name: string;
  parent: string;
  appProperties?: Record<string, string>;
  shared?: boolean;
};
const firstTenantId = "aba574d1-3eea-4547-8295-3bf8d22c6281";
const secondTenantId = "dab574d1-3eea-4547-8295-3bf8d22c6282";
/** Model Drive folder metadata so ownership, renames and ambiguity are exercised across repeated calls. */
function tenantFolderHarness(initial: StoredFolder[] = []) {
  const folders = structuredClone(initial);
  const queries: string[] = [];
  const writes: { method: string; body: Record<string, unknown> }[] = [];
  let paginated = false;
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "test-access", expires_in: 3600 });
    const method = init?.method ?? "GET";
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const query = url.searchParams.get("q")!;
      queries.push(query);
      const tenant = query.match(/value='([^']+)'/)?.[1];
      const legacy = query.match(/name='([^']+)'/)?.[1];
      const matched = folders.filter(
        (folder) =>
          folder.parent === configuration.rootId &&
          (tenant
            ? folder.appProperties?.stocksbuddhaTenantId === tenant
            : folder.name === legacy),
      );
      return Response.json({
        files: matched,
        ...(paginated ? { nextPageToken: "more" } : {}),
      });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const body = JSON.parse(String(init?.body));
      writes.push({ method, body });
      const created = {
        id: `created-${folders.length}`,
        name: body.name,
        parent: body.parents[0],
        appProperties: body.appProperties,
      };
      folders.push(created);
      return Response.json({ id: created.id });
    }
    const folder = folders.find((row) => url.pathname.endsWith(`/${row.id}`));
    assert.ok(folder, `unexpected Drive path ${url.pathname}`);
    if (method === "PATCH") {
      const body = JSON.parse(String(init?.body));
      writes.push({ method, body });
      Object.assign(folder, body);
      return Response.json({ id: folder.id });
    }
    return Response.json({
      ...folder,
      mimeType: "application/vnd.google-apps.folder",
      parents: [folder.parent],
      permissions: [
        { type: "user", role: "owner", emailAddress: configuration.account },
        ...(folder.shared ? [{ type: "anyone", role: "reader" }] : []),
      ],
    });
  };
  return {
    drive: new GoogleDriveStorage(configuration, request),
    folders,
    queries,
    writes,
    paginate: () => {
      paginated = true;
    },
  };
}

test("RA folders use readable names and immutable tenant metadata; repeated uploads reuse the same folder", async () => {
  const { drive, folders, writes } = tenantFolderHarness();
  const id = await drive.tenantFolder(firstTenantId, "Alpha Research");
  assert.equal(await drive.tenantFolder(firstTenantId, "Alpha Research"), id);
  assert.equal(folders.length, 1);
  assert.equal(folders[0].name, "Alpha Research");
  assert.equal(folders[0].appProperties?.stocksbuddhaTenantId, firstTenantId);
  assert.equal(writes.length, 1);
});

test("RA folder adoption and later display-name changes retain Drive identity and existing metadata", async () => {
  const { drive, folders, writes } = tenantFolderHarness([
    {
      id: "legacy-ra",
      name: firstTenantId,
      parent: configuration.rootId,
      appProperties: { retained: "yes" },
    },
  ]);
  assert.equal(
    await drive.tenantFolder(firstTenantId, "Alpha Research"),
    "legacy-ra",
  );
  assert.equal(folders[0].appProperties?.retained, "yes");
  assert.equal(
    await drive.tenantFolder(firstTenantId, "Renamed Research"),
    "legacy-ra",
  );
  assert.equal(folders.length, 1);
  assert.equal(folders[0].name, "Renamed Research");
  assert.equal(
    writes.every((write) => write.method === "PATCH"),
    true,
  );
});

test("identical RA names remain isolated, and unrelated readable folders are never adopted by name", async () => {
  const { drive, folders } = tenantFolderHarness([
    { id: "unrelated", name: "Same Research", parent: configuration.rootId },
  ]);
  const first = await drive.tenantFolder(firstTenantId, "Same Research");
  const second = await drive.tenantFolder(secondTenantId, "Same Research");
  assert.notEqual(first, second);
  assert.notEqual(first, "unrelated");
  assert.equal(await drive.tenantFolder(firstTenantId, "Same Research"), first);
  assert.equal(
    await drive.tenantFolder(secondTenantId, "Same Research"),
    second,
  );
  assert.equal(folders.length, 3);
  assert.equal(folders[0].appProperties, undefined);
});

test("RA names support spaces, Unicode, apostrophes and punctuation without entering Drive search expressions", async () => {
  const { drive, folders, queries } = tenantFolderHarness();
  const name = "O'Brien & सहयोग / Research";
  await drive.tenantFolder(firstTenantId, `  ${name}  `);
  assert.equal(folders[0].name, name);
  assert.equal(
    queries.some((query) => query.includes("O'Brien")),
    false,
  );
  assert.equal(
    queries.every((query) =>
      query.startsWith(`'${configuration.rootId}' in parents`),
    ),
    true,
  );
});

test("an RA named Main cannot take ownership of the platform Main folder or a folder outside the root", async () => {
  const { drive, folders } = tenantFolderHarness([
    { id: configuration.mainId, name: "Main", parent: configuration.rootId },
    { id: "other-root", name: firstTenantId, parent: "unrelated-root" },
  ]);
  const id = await drive.tenantFolder(firstTenantId, "Main");
  assert.notEqual(id, configuration.mainId);
  assert.notEqual(id, "other-root");
  assert.equal(folders[0].appProperties, undefined);
});

test("ambiguous, conflicting or shared RA folders fail before renaming or uploading", async () => {
  for (const tagged of [true, false]) {
    const { drive, writes } = tenantFolderHarness(
      ["a", "b"].map((id) => ({
        id,
        name: tagged ? "Alpha" : firstTenantId,
        parent: configuration.rootId,
        ...(tagged
          ? { appProperties: { stocksbuddhaTenantId: firstTenantId } }
          : {}),
      })),
    );
    await assert.rejects(
      drive.tenantFolder(firstTenantId, "Alpha Research"),
      /drive_duplicate_tenant_folder/,
    );
    assert.equal(writes.length, 0);
  }
  const conflict = tenantFolderHarness([
    {
      id: "other-ra",
      name: firstTenantId,
      parent: configuration.rootId,
      appProperties: { stocksbuddhaTenantId: secondTenantId },
    },
  ]);
  await assert.rejects(
    conflict.drive.tenantFolder(firstTenantId, "Alpha Research"),
    /drive_tenant_folder_conflict/,
  );
  assert.equal(conflict.writes.length, 0);
  const shared = tenantFolderHarness([
    {
      id: "shared-ra",
      name: firstTenantId,
      parent: configuration.rootId,
      shared: true,
    },
  ]);
  await assert.rejects(
    shared.drive.tenantFolder(firstTenantId, "Alpha Research"),
    /drive_folder_not_private/,
  );
  assert.equal(shared.writes.length, 0);
  const pages = tenantFolderHarness();
  pages.paginate();
  await assert.rejects(
    pages.drive.tenantFolder(firstTenantId, "Alpha"),
    /drive_duplicate_tenant_folder/,
  );
});

test("invalid RA identities and blank/control-character names are rejected before calling Google", async () => {
  const { drive, queries, writes } = tenantFolderHarness();
  for (const [id, name] of [
    ["not-a-uuid", "Alpha"],
    [firstTenantId, "  "],
    [firstTenantId, "Alpha\nResearch"],
    [firstTenantId, "a".repeat(161)],
  ])
    await assert.rejects(drive.tenantFolder(id, name), /invalid_tenant_folder/);
  assert.equal(queries.length, 0);
  assert.equal(writes.length, 0);
});

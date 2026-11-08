import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { createDatabase, databaseConfig } from "../../../database/config";
import { runMigrations } from "../../../database/runner";
import { loadManifest } from "../../../database/manifest";
import { seedDemo } from "../../../database/seeds/demo";
import { tenants } from "../../src/tenants/tenants";
import { DocumentService } from "../../src/documents/service";
import { GoogleDriveStorage } from "../../src/documents/drive";
import { createAuthentication } from "../../src/auth/config";
import { mountDocuments } from "../../src/documents/routes";
import { MariaDbWorkspaceStore } from "../../src/auth/workspaces";

const pdf = Buffer.from("%PDF-1.4\nIntegration proof\n%%EOF");
test(
  "MariaDB documents: tenant/role isolation, constraints, retained evidence, integrity, revocation and authenticated HTTP",
  { skip: process.env.RUN_DATABASE_TESTS !== "true" },
  async () => {
    const config = databaseConfig(process.env, "dev");
    const admin = createDatabase(config, 3, 0);
    await admin.initialize();
    const name = `sb_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE \`${name}\``);
    const db = createDatabase({ ...config, database: name }, 10, 0);
    await db.initialize();
    let authentication: ReturnType<typeof createAuthentication> | undefined;
    const objects = new Map<string, Buffer>();
    const folders: string[] = [];
    const tenantFolders: { id: string; name: string }[] = [];
    const uploadParents: string[] = [];
    const downloadParents: string[] = [];
    const fakeDrive = {
      config: { rootId: "root", mainId: "main" },
      verify: async () => {},
      tenantFolder: async (id: string, name: string) => {
        tenantFolders.push({ id, name });
        return `ra_${id}`;
      },
      folder: async (parent: string, child: string) => {
        folders.push(child);
        return `${parent}_${child}`;
      },
      upload: async (
        parent: string,
        _name: string,
        _mime: string,
        bytes: Buffer,
      ) => {
        const id = randomUUID();
        uploadParents.push(parent);
        objects.set(id, Buffer.from(bytes));
        return id;
      },
      download: async (id: string, parent: string) => {
        downloadParents.push(parent);
        return objects.get(id)!;
      },
    } as unknown as GoogleDriveStorage;
    const service = new DocumentService(db, fakeDrive);
    const tenantId = tenants[0].id,
      secondTenant = tenants[1].id;
    try {
      await runMigrations(db, await loadManifest(), true);
      await seedDemo(db, "dev");
      authentication = createAuthentication(
        { ...config, database: name },
        "test-documents-secret-at-least-32-characters",
        "http://localhost:3000",
      );
      const people = [];
      for (const role of [
        "platform",
        "owner",
        "analyst",
        "support",
        "subscriber",
        "other",
      ]) {
        const result = await authentication.auth.api.signUpEmail({
          body: {
            name: role,
            email: `${role}@documents.test`,
            password: "document-test-password",
          },
        });
        await db.query("UPDATE auth_users SET email_verified=1 WHERE id=?", [
          result.user.id,
        ]);
        const membershipId = randomUUID();
        if (role === "platform")
          await db.query(
            "UPDATE auth_users SET platform_role='owner' WHERE id=?",
            [result.user.id],
          );
        else
          await db.query(
            "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,profile_json,capabilities_json) VALUES (?,?,?,?,?,?)",
            [
              membershipId,
              tenantId,
              result.user.id,
              role === "other" ? "subscriber" : role,
              '{"schemaVersion":1}',
              '{"schemaVersion":1,"allow":[],"deny":[]}',
            ],
          );
        people.push({
          id: result.user.id,
          token: result.token!,
          tenantId: role === "platform" ? null : tenantId,
          membershipId,
        });
      }
      const [platform, owner, analyst, support, subscriber, other] = people;
      const input = {
        kind: "kyc",
        customerId: subscriber.membershipId,
        name: "PANCard.pdf",
        mime: "application/pdf",
        bytes: pdf,
      };
      const uploaded = await service.upload(subscriber, {
        ...input,
        customerId: other.membershipId,
      });
      const listed = await service.list(subscriber);
      assert.equal(
        listed.documents[0].customerId,
        subscriber.membershipId,
        "subscriber target must be server-derived",
      );
      assert.equal(JSON.stringify(listed).includes("drive_file_id"), false);
      assert.equal((await service.list(other)).documents.length, 0);
      assert.equal((await service.list(analyst)).documents.length, 0);
      assert.deepEqual((await service.download(owner, uploaded.id)).bytes, pdf);
      assert.deepEqual(
        (await service.download(support, uploaded.id)).bytes,
        pdf,
      );
      await assert.rejects(
        service.download(other, uploaded.id),
        /document_not_found/,
      );
      await assert.rejects(
        service.download(analyst, uploaded.id),
        /document_not_found/,
      );
      await assert.rejects(
        service.download({ ...owner, tenantId: secondTenant }, uploaded.id),
        /forbidden/,
      );
      await assert.rejects(
        service.download({ ...platform, tenantId }, uploaded.id),
        /forbidden/,
      );
      await assert.rejects(service.upload(analyst, input), /forbidden/);
      await assert.rejects(
        service.upload(owner, { ...input, customerId: randomUUID() }),
        /customer_not_found/,
      );
      const proof = await service.upload(analyst, {
        ...input,
        kind: "recommendation",
      });
      assert.deepEqual(
        (await service.download(subscriber, proof.id)).bytes,
        pdf,
      );
      await assert.rejects(
        service.upload(subscriber, { ...input, kind: "recommendation" }),
        /forbidden/,
      );
      await assert.rejects(
        service.download(support, proof.id),
        /document_not_found/,
      );
      const contract = await service.upload(platform, {
        ...input,
        kind: "contract",
      });
      assert.equal((await service.list(platform)).documents[0].id, contract.id);
      await assert.rejects(
        service.download(owner, contract.id),
        /document_not_found/,
      );
      assert.equal(tenantFolders[0].id, tenantId);
      assert.equal(tenantFolders[0].name, tenants[0].profile.name);
      assert.equal(
        uploadParents[0],
        `ra_${tenantId}_Customer_${subscriber.membershipId}`,
      );
      assert.equal(
        uploadParents[1],
        `ra_${tenantId}_Customer_${subscriber.membershipId}_ForYouByRA`,
      );
      assert.equal(uploadParents[2], "main");
      assert.ok(folders.includes("Customer"));
      assert.ok(folders.includes(subscriber.membershipId));
      assert.ok(folders.includes("ForYouByRA"));
      assert.equal(folders.includes("Customers"), false);
      assert.equal(folders.includes("ByRAForThisCustomer"), false);
      const mitc = await service.upload(subscriber, { ...input, kind: "mitc" });
      assert.equal(
        uploadParents.at(-1),
        `ra_${tenantId}_Customer_${subscriber.membershipId}`,
      );
      assert.deepEqual(
        (await service.download(subscriber, mitc.id)).bytes,
        pdf,
      );
      await service.upload(owner, { ...input, kind: "general" });
      assert.equal(uploadParents.at(-1), `ra_${tenantId}_General`);
      await db.query(
        "UPDATE tenants SET display_name='Renamed Research' WHERE id=?",
        [tenantId],
      );
      await service.upload(owner, { ...input, kind: "general" });
      assert.deepEqual(tenantFolders.at(-1), {
        id: tenantId,
        name: "Renamed Research",
      });
      assert.equal(uploadParents.at(-1), `ra_${tenantId}_General`);
      await service.upload(platform, { ...input, kind: "owner" });
      assert.equal(uploadParents.at(-1), "main");
      // Existing objects use their persisted parent, independent of the new upload layout.
      await db.query(
        "UPDATE documents SET drive_folder_id='legacy-customers-folder' WHERE id=?",
        [uploaded.id],
      );
      assert.deepEqual(
        (await service.download(subscriber, uploaded.id)).bytes,
        pdf,
      );
      assert.equal(downloadParents.at(-1), "legacy-customers-folder");
      await db.query(
        "UPDATE documents SET drive_folder_id='legacy-evidence-folder' WHERE id=?",
        [proof.id],
      );
      await service.download(subscriber, proof.id);
      assert.equal(downloadParents.at(-1), "legacy-evidence-folder");
      const otherFile = await service.upload(other, { ...input, kind: "mitc" });
      assert.equal(
        uploadParents.at(-1),
        `ra_${tenantId}_Customer_${other.membershipId}`,
      );
      assert.equal((await service.list(other)).documents.length, 1);
      const secondMembership = randomUUID();
      await db.query(
        "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,profile_json,capabilities_json) VALUES (?,?,?,'owner',?,?)",
        [
          secondMembership,
          secondTenant,
          owner.id,
          '{"schemaVersion":1}',
          '{"schemaVersion":1,"allow":[],"deny":[]}',
        ],
      );
      await db.query(
        "UPDATE tenants SET display_name='Renamed Research' WHERE id=?",
        [secondTenant],
      );
      const secondTenantFile = await service.upload(
        { ...owner, tenantId: secondTenant },
        { ...input, kind: "general" },
      );
      assert.deepEqual(tenantFolders.at(-1), {
        id: secondTenant,
        name: "Renamed Research",
      });
      assert.equal(uploadParents.at(-1), `ra_${secondTenant}_General`);
      await assert.rejects(
        service.download({ ...owner, tenantId: secondTenant }, uploaded.id),
        /document_not_found/,
      );
      for (const cursor of [otherFile.id, secondTenantFile.id, randomUUID()]) {
        await assert.rejects(
          service.list(subscriber, cursor),
          /invalid_cursor/,
        );
      }
      const ownPage = await service.list(subscriber, proof.id);
      assert.ok(
        ownPage.documents.every(
          (document) =>
            document.customerId === subscriber.membershipId &&
            document.id !== proof.id,
        ),
      );
      await db.query(
        "UPDATE tenant_memberships SET status='revoked',revoked_at=UTC_TIMESTAMP(3) WHERE id=?",
        [other.membershipId],
      );
      assert.deepEqual(
        (await service.download(owner, otherFile.id)).bytes,
        pdf,
        "RA retains access to former-client evidence",
      );
      const [{ drive_file_id: driveId }] = await db.query(
        "SELECT drive_file_id FROM documents WHERE id=?",
        [uploaded.id],
      );
      objects.set(driveId, Buffer.from("tampered"));
      await assert.rejects(
        service.download(subscriber, uploaded.id),
        /document_integrity_failed/,
      );
      objects.set(driveId, pdf);
      await db.query(
        "UPDATE tenant_memberships SET capabilities_json=? WHERE id=?",
        [
          '{"schemaVersion":1,"allow":[],"deny":["website:edit"]}',
          owner.membershipId,
        ],
      );
      await assert.rejects(service.list(owner), /forbidden/);
      await db.query(
        "UPDATE tenant_memberships SET capabilities_json=? WHERE id=?",
        ['{"schemaVersion":1,"allow":[],"deny":[]}', owner.membershipId],
      );
      const [{ count }] = await db.query(
        "SELECT COUNT(*) AS count FROM audit_events WHERE action IN ('document.uploaded','document.downloaded')",
      );
      assert.ok(Number(count) >= 6);
      await assert.rejects(
        db.query("DELETE FROM tenant_memberships WHERE id=?", [
          subscriber.membershipId,
        ]),
        /foreign key constraint/i,
      );
      assert.equal(
        (await new DocumentService(db, null).list(owner)).configured,
        false,
      );
      await assert.rejects(
        new DocumentService(db, null).upload(owner, input),
        /document_storage_unavailable/,
      );
      const router = express.Router();
      mountDocuments(router, {
        auth: authentication.auth,
        store: new MariaDbWorkspaceStore(db),
        service,
        origin: "http://localhost:3000",
        page: (res) => {
          res.send("documents-page");
        },
      });
      const app = express();
      app.use(router);
      const server = createServer(app);
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}`;
      const path = `/api/workspaces/${tenants[0].slug}/documents`;
      try {
        assert.equal((await fetch(`${base}${path}`)).status, 401);
        const login = await authentication.auth.handler(
          new Request("http://localhost:3000/api/auth/sign-in/email", {
            method: "POST",
            headers: {
              origin: "http://localhost:3000",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email: "subscriber@documents.test",
              password: "document-test-password",
            }),
          }),
        );
        assert.equal(login.status, 200);
        const cookie = login.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        assert.ok(cookie);
        const metadata = await fetch(`${base}${path}`, { headers: { cookie } });
        assert.equal(metadata.status, 200);
        assert.equal(
          ((await metadata.json()) as { documents: unknown[] }).documents
            .length,
          3,
        );
        assert.equal(
          (
            await fetch(`${base}${path}/${otherFile.id}/download`, {
              headers: { cookie },
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await fetch(`${base}${path}/${secondTenantFile.id}/download`, {
              headers: { cookie },
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await fetch(`${base}${path}?before=${otherFile.id}`, {
              headers: { cookie },
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await fetch(`${base}${path}?before=${secondTenantFile.id}`, {
              headers: { cookie },
            })
          ).status,
          400,
        );
        const forgedFilter = await fetch(
          `${base}${path}?customerId=${other.membershipId}`,
          { headers: { cookie, "X-Customer-Id": other.membershipId } },
        );
        const filtered = (await forgedFilter.json()) as {
          documents: { customerId: string }[];
        };
        assert.ok(
          filtered.documents.every(
            (document) => document.customerId === subscriber.membershipId,
          ),
        );
        assert.equal(
          (
            await fetch(`${base}${path}`, {
              method: "POST",
              headers: {
                cookie,
                origin: "https://attacker.test",
                "Content-Type": "application/pdf",
              },
              body: pdf,
            })
          ).status,
          403,
        );
        const headers = {
          cookie,
          origin: "http://localhost:3000",
          "Content-Type": "application/pdf",
          "X-Document-Kind": "mitc",
          "X-Document-Name": "MITC-Signed.pdf",
        };
        assert.equal(
          (
            await fetch(`${base}${path}`, {
              method: "POST",
              headers,
              body: pdf,
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await fetch(`${base}${path}`, {
              method: "POST",
              headers,
              body: "not-pdf",
            })
          ).status,
          400,
        );
        const download = await fetch(`${base}${path}/${uploaded.id}/download`, {
          headers: { cookie },
        });
        assert.equal(download.status, 200);
        assert.match(
          download.headers.get("Content-Disposition")!,
          /^attachment;/,
        );
        assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
        assert.equal(
          (await fetch(`${base}/api/documents`, { headers: { cookie } }))
            .status,
          403,
        );
        assert.equal(
          (
            await fetch(`${base}/ra/${tenants[0].slug}/account/documents`, {
              headers: { cookie },
            })
          ).status,
          200,
        );
        await db.query(
          "UPDATE tenant_memberships SET status='revoked',revoked_at=UTC_TIMESTAMP(3) WHERE id=?",
          [subscriber.membershipId],
        );
        assert.equal(
          (await fetch(`${base}${path}`, { headers: { cookie } })).status,
          404,
        );
        await assert.rejects(
          service.download(subscriber, uploaded.id),
          /forbidden/,
        );
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
      await db.query("DELETE FROM auth_sessions WHERE token=?", [owner.token]);
      await assert.rejects(service.list(owner), /unauthorized/);
    } finally {
      await authentication?.close();
      await db.destroy();
      await admin.query(`DROP DATABASE \`${name}\``);
      await admin.destroy();
    }
  },
);

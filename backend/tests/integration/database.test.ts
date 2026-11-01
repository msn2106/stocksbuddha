import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { migrationClasses } from "../../../database/catalog";
import { createPublicApp } from "../../src/app";
import { createAuthRoutes } from "../../src/auth/routes";
import {
  MariaDbWorkspaceStore,
  type Workspace,
} from "../../src/auth/workspaces";
import { createDatabase, databaseConfig } from "../../../database/config";
import { loadManifest } from "../../../database/manifest";
import { runMigrations } from "../../../database/runner";
import { seedDemo } from "../../../database/seeds/demo";
import { tenants } from "../../src/tenants/tenants";
import { websites } from "../../src/websites/seeds";
import {
  snapshotFromFixture,
  digest,
  canonicalJson,
} from "../../../database/snapshots";
import {
  MariaDbTenantRepository,
  MariaDbWebsiteRepository,
} from "../../src/database/repositories";
import { TenantOperations } from "../../src/database/operations";
import { createPublicSiteResolver } from "../../src/tenancy/resolve-public-site";
import { createAuthentication } from "../../src/auth/config";
import { withAuthTenant } from "../../src/auth/tenant-context";

test(
  "MariaDB: fresh migrations, constraints, auth, publishing, retries and recovery",
  { skip: process.env.RUN_DATABASE_TESTS !== "true" },
  async (context) => {
    const config = databaseConfig(process.env, "dev");
    const admin = createDatabase(config, 3, 0);
    await admin.initialize();
    const name = `sb_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(
      `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    const db = createDatabase({ ...config, database: name }, 10, 0);
    await db.initialize();
    const manifest = await loadManifest();
    try {
      await context.test(
        "fresh and repeated migrations have one success per migration and exactly ten tables",
        async () => {
          await runMigrations(db, manifest, true);
          await runMigrations(db, manifest, true);
          const [{ count }] = await db.query(
            "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=?",
            [name],
          );
          assert.equal(Number(count), 10);
          const [{ attempts }] = await db.query(
            "SELECT COUNT(*) AS attempts FROM migration_attempts",
          );
          assert.equal(Number(attempts), 10);
          assert.ok(
            (await runMigrations(db, manifest, false)).every(
              (row) => row.applied,
            ),
          );
        },
      );
      await context.test(
        "upgrading legacy users preserves unknown origins and the documented backfill is scoped and repeatable",
        async () => {
          const upgradeName = `${name}_upgrade`;
          await admin.query(`CREATE DATABASE \`${upgradeName}\``);
          const upgrade = createDatabase(
            { ...config, database: upgradeName },
            3,
            0,
          );
          await upgrade.initialize();
          const runner = upgrade.createQueryRunner();
          await runner.connect();
          try {
            for (const Class of migrationClasses.slice(0, -1))
              await new Class().up(runner);
            await seedDemo(upgrade, "dev");
            const legacyUser = randomUUID(),
              legacySession = randomUUID();
            await runner.query(
              "INSERT INTO auth_users(id,name,email) VALUES (?,'Legacy','legacy@example.test')",
              [legacyUser],
            );
            await runner.query(
              "INSERT INTO auth_sessions(id,user_id,token,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))",
              [legacySession, legacyUser, randomUUID()],
            );
            await new migrationClasses[migrationClasses.length - 1]().up(
              runner,
            );
            assert.equal(
              (
                await runner.query(
                  "SELECT signup_tenant_id FROM auth_users WHERE id=?",
                  [legacyUser],
                )
              )[0].signup_tenant_id,
              null,
            );
            assert.equal(
              (
                await runner.query(
                  "SELECT login_tenant_id FROM auth_sessions WHERE id=?",
                  [legacySession],
                )
              )[0].login_tenant_id,
              null,
            );
            assert.deepEqual(
              await runner.query(
                "SELECT id FROM audit_events WHERE entity_id IN (?,?)",
                [legacyUser, legacySession],
              ),
              [],
            );
            const source = await readFile(
              new URL(
                "../../../database/queries/backfill-auth-tenant-context.sql",
                import.meta.url,
              ),
              "utf8",
            );
            const signupBlock = source
              .split("-- 2.")[1]
              .split("-- 3.")[0]
              .replace(
                "replace-with-stocksbuddha-user-email",
                "legacy@example.test",
              );
            const sessionBlock = source
              .split("-- 4.")[1]
              .split("-- 5.")[0]
              .replace(
                "replace-with-a-session-id-from-the-query-above",
                legacySession,
              )
              .replace(
                "replace-with-the-session-owner-email",
                "legacy@example.test",
              );
            /** Execute the delivered SQL on one connection so variables and transactions retain their scope. */
            async function runBlock(block: string) {
              // Start after the first newline, which ends the section heading comment.
              const sql = block
                .slice(block.indexOf("\n") + 1)
                .replace(/^--.*$/gm, "");
              for (const statement of sql
                .split(/;\s*(?:\n|$)/)
                .filter((part) => part.trim()))
                await runner.query(statement);
            }
            await runBlock(signupBlock);
            await runBlock(signupBlock);
            await runBlock(signupBlock.replace("'stocksbuddha'", "'beta'"));
            assert.equal(
              (
                await runner.query(
                  "SELECT signup_tenant_id FROM auth_users WHERE id=?",
                  [legacyUser],
                )
              )[0].signup_tenant_id,
              tenants[0].id,
            );
            await runBlock(sessionBlock);
            await runBlock(sessionBlock);
            assert.equal(
              (
                await runner.query(
                  "SELECT login_tenant_id FROM auth_sessions WHERE id=?",
                  [legacySession],
                )
              )[0].login_tenant_id,
              tenants[0].id,
            );
            assert.equal(
              (
                await runner.query(
                  "SELECT id FROM audit_events WHERE entity_id IN (?,?)",
                  [legacyUser, legacySession],
                )
              ).length,
              2,
            );
            assert.equal(
              (
                await runner.query(
                  "SELECT email_verified FROM auth_users WHERE id=?",
                  [legacyUser],
                )
              )[0].email_verified,
              0,
            );
            assert.deepEqual(
              await runner.query(
                "SELECT id FROM tenant_memberships WHERE user_id=?",
                [legacyUser],
              ),
              [],
            );
          } finally {
            await runner.release();
            await upgrade.destroy();
            await admin.query(`DROP DATABASE \`${upgradeName}\``);
          }
        },
      );
      await context.test(
        "simultaneous runners serialize and failed DDL blocks automatic retry",
        async () => {
          await Promise.all([
            runMigrations(db, manifest, true),
            runMigrations(db, manifest, true),
          ]);
          const failureName = `${name}_failure`;
          await admin.query(`CREATE DATABASE \`${failureName}\``);
          const failed = createDatabase(
            { ...config, database: failureName },
            3,
            0,
          );
          await failed.initialize();
          try {
            await failed.query("CREATE TABLE tenants(id INT PRIMARY KEY)");
            await assert.rejects(
              runMigrations(failed, manifest, true),
              /partial DDL/,
            );
            const [attempt] = await failed.query(
              "SELECT status,error_code FROM migration_attempts",
            );
            assert.equal(attempt.status, "failed");
            assert.equal(attempt.error_code, "MIGRATION_FAILED");
            await assert.rejects(
              runMigrations(failed, manifest, true),
              /reconciliation/,
            );
          } finally {
            await failed.destroy();
            await admin.query(`DROP DATABASE \`${failureName}\``);
          }
        },
      );

      await context.test(
        "metadata drift, source changes and unfinished history block migration execution",
        async () => {
          await assert.rejects(
            db.query(
              "UPDATE migration_attempts SET status='reconciled',finished_at=UTC_TIMESTAMP(3) LIMIT 1",
            ),
          );
          const altered = { ...manifest, checksums: { ...manifest.checksums } };
          altered.checksums[Object.keys(altered.checksums)[0]] = "0".repeat(64);
          await assert.rejects(runMigrations(db, altered, true), /checksum/);
          await db.query(
            "UPDATE migration_attempts SET status='running',finished_at=NULL LIMIT 1",
          );
          await assert.rejects(
            runMigrations(db, manifest, true),
            /reconciliation/,
          );
          await db.query(
            "UPDATE migration_attempts SET status='succeeded',finished_at=UTC_TIMESTAMP(3) WHERE status='running'",
          );
          await db.query("ALTER TABLE migrations ADD drift INT NULL");
          await assert.rejects(
            runMigrations(db, manifest, true),
            /Metadata schema drift/,
          );
          await db.query("ALTER TABLE migrations DROP COLUMN drift");
        },
      );
      await context.test(
        "timestamp defaults remain UTC when the database session uses a different timezone",
        async () => {
          const runner = db.createQueryRunner();
          await runner.connect();
          try {
            await runner.query("SET SESSION time_zone='+05:30'");
            const id = randomUUID();
            await runner.query(
              "INSERT INTO tenants(id,slug,display_name,legal_name,monogram,settings_json) VALUES (?,'timezone-check','Timezone','Timezone','tz','{\"schemaVersion\":1}')",
              [id],
            );
            const [row] = await runner.query(
              "SELECT ABS(TIMESTAMPDIFF(SECOND,created_at,UTC_TIMESTAMP(3))) AS delta FROM tenants WHERE id=?",
              [id],
            );
            assert.ok(Number(row.delta) < 2);
            await runner.query("DELETE FROM tenants WHERE id=?", [id]);
          } finally {
            await runner.query("SET SESSION time_zone='+00:00'");
            await runner.release();
          }
        },
      );
      await context.test(
        "repeatable seeds preserve edits and an explicit unpublication",
        async () => {
          await seedDemo(db, "dev");
          await seedDemo(db, "dev");
          await assert.rejects(seedDemo(db, "prod"), /restricted/);
          await db.query(
            "UPDATE tenants SET display_name='Administrative edit',published_revision=NULL WHERE id=?",
            [tenants[1].id],
          );
          await seedDemo(db, "dev");
          const [row] = await db.query(
            "SELECT display_name,published_revision FROM tenants WHERE id=?",
            [tenants[1].id],
          );
          assert.equal(row.display_name, "Administrative edit");
          assert.equal(row.published_revision, null);
          assert.equal(
            await new MariaDbWebsiteRepository(db).findPublished(tenants[1].id),
            null,
          );
          await db.query("UPDATE tenants SET published_revision=1 WHERE id=?", [
            tenants[1].id,
          ]);
        },
      );
      const tenantId = tenants[0].id;
      const tenant = tenants[0];
      const snapshot = snapshotFromFixture(
        tenants[0],
        websites.find((row) => row.tenantId === tenantId)!,
      );
      const userId = randomUUID(),
        secondId = randomUUID(),
        memberId = randomUUID(),
        secondMember = randomUUID(),
        token = randomUUID(),
        secondToken = randomUUID();
      for (const [id, t] of [
        [userId, token],
        [secondId, secondToken],
      ]) {
        await db.query(
          "INSERT INTO auth_users(id,name,email,email_verified) VALUES (?,'Test',?,1)",
          [id, `${id}@example.test`],
        );
        await db.query(
          "INSERT INTO auth_sessions(id,user_id,token,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))",
          [randomUUID(), id, t],
        );
      }
      for (const [id, user] of [
        [memberId, userId],
        [secondMember, secondId],
      ])
        await db.query(
          "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,profile_json,capabilities_json) VALUES (?,?,?,'owner',?,?)",
          [
            id,
            tenantId,
            user,
            canonicalJson({ schemaVersion: 1 }),
            canonicalJson({ schemaVersion: 1, allow: [], deny: [] }),
          ],
        );
      const ops = new TenantOperations(db);
      /** Generate a new explicit operation context while retaining the authenticated actor. */
      const operation = (overrides = {}) => ({
        token,
        tenantId,
        key: randomUUID(),
        ...overrides,
      });
      await context.test(
        "composite FKs reject foreign owners, bases and publication pointers",
        async () => {
          await assert.rejects(
            db.query("UPDATE tenants SET published_revision=99 WHERE id=?", [
              tenantId,
            ]),
          );
          await assert.rejects(
            db.query(
              "INSERT INTO website_revisions(id,tenant_id,revision,base_publication_version,snapshot_json,snapshot_sha256,created_by) VALUES (?,?,99,0,?,?,?)",
              [
                randomUUID(),
                tenants[1].id,
                canonicalJson(snapshot),
                digest(snapshot),
                memberId,
              ],
            ),
          );
          await assert.rejects(
            db.query("UPDATE tenants SET settings_json='[]' WHERE id=?", [
              tenantId,
            ]),
          );
        },
      );
      await context.test(
        "public adapters expose frozen identity, selected locale and fail on corrupted/unknown versions",
        async () => {
          const resolve = createPublicSiteResolver(
            new MariaDbTenantRepository(db),
            new MariaDbWebsiteRepository(db),
          );
          const page = await resolve("/ra/alpha", "hi");
          assert.equal(page.tenant?.profile.name, tenants[1].profile.name);
          assert.equal(page.locale, "hi");
          assert.equal((await resolve("/ra/nonexistent")).tenant, null);
          const [stored] = await db.query(
            "SELECT snapshot_json,snapshot_sha256 FROM website_revisions WHERE tenant_id=? AND revision=1",
            [tenants[2].id],
          );
          const changed = JSON.parse(stored.snapshot_json);
          changed.schemaVersion = 99;
          await db.query(
            "UPDATE website_revisions SET snapshot_json=?,snapshot_sha256=? WHERE tenant_id=? AND revision=1",
            [canonicalJson(changed), digest(changed), tenants[2].id],
          );
          await assert.rejects(
            new MariaDbWebsiteRepository(db).findPublished(tenants[2].id),
          );
          await db.query(
            "UPDATE website_revisions SET snapshot_json=?,snapshot_sha256=? WHERE tenant_id=? AND revision=1",
            [stored.snapshot_json, "0".repeat(64), tenants[2].id],
          );
          await assert.rejects(
            new MariaDbWebsiteRepository(db).findPublished(tenants[2].id),
            /integrity/,
          );
          await db.query(
            "UPDATE website_revisions SET snapshot_sha256=? WHERE tenant_id=? AND revision=1",
            [stored.snapshot_sha256, tenants[2].id],
          );
        },
      );
      await context.test(
        "unfinished translations save, complete publication validates and retries do not duplicate",
        async () => {
          const partial = structuredClone(snapshot);
          partial.content.hi = {};
          const draft = await ops.createDraft(operation(), partial);
          await assert.rejects(ops.publish(operation(), draft.id!, 1));
          await ops.saveDraft(operation(), draft.id!, 1, snapshot);
          const key = operation();
          const result = await ops.publish(key, draft.id!, 2);
          assert.deepEqual(await ops.publish(key, draft.id!, 2), result);
          await assert.rejects(
            ops.publish(key, draft.id!, 99),
            /idempotency_conflict/,
          );
          await assert.rejects(
            ops.saveDraft(operation(), draft.id!, 3, snapshot),
            /stale_draft/,
          );
        },
      );
      await context.test(
        "stale base requires explicit rebase; unpublish never reveals historical content",
        async () => {
          const a = await ops.createDraft(operation(), snapshot),
            b = await ops.createDraft(operation(), snapshot);
          await ops.publish(operation(), b.id!, 1);
          await assert.rejects(
            ops.publish(operation(), a.id!, 1),
            /stale_publication/,
          );
          await ops.saveDraft(operation(), a.id!, 1, snapshot, true);
          await ops.publish(operation(), a.id!, 2);
          const pending = await ops.createDraft(operation(), snapshot);
          const key = operation();
          await ops.unpublish(key);
          await ops.unpublish(key);
          assert.equal(
            await new MariaDbWebsiteRepository(db).findPublished(tenantId),
            null,
          );
          await assert.rejects(
            ops.publish(operation(), pending.id!, 1),
            /stale_publication/,
          );
          await ops.saveDraft(operation(), pending.id!, 1, snapshot, true);
          await ops.publish(operation(), pending.id!, 2);
        },
      );
      await context.test(
        "authoritative session/membership checks deny revoked actors and protect the last owner",
        async () => {
          await ops.changeMembership(
            operation(),
            secondMember,
            1,
            "owner",
            false,
          );
          await assert.rejects(
            ops.createDraft(operation({ token: secondToken }), snapshot),
            /forbidden/,
          );
          await assert.rejects(
            ops.enroll(operation({ token: secondToken })),
            /enrollment_unavailable/,
          );
          await assert.rejects(
            ops.changeMembership(operation(), memberId, 1, "subscriber", true),
            /last_owner/,
          );
          await ops.changeMembership(
            operation(),
            secondMember,
            2,
            "owner",
            true,
          );
          await assert.rejects(
            ops.createDraft(operation({ token: randomUUID() }), snapshot),
            /unauthorized/,
          );
          const draft = await ops.createDraft(
            operation({ token: secondToken }),
            snapshot,
          );
          await db.query("DELETE FROM auth_sessions WHERE token=?", [
            secondToken,
          ]);
          await assert.rejects(
            ops.publish(operation({ token: secondToken }), draft.id!, 1),
            /unauthorized/,
          );
        },
      );
      await context.test(
        "staff enrollment preserves role and first-owner provisioning is atomic and retryable",
        async () => {
          const joined = await ops.enroll(operation());
          assert.equal(joined.membershipId, memberId);
          await db.query(
            "UPDATE auth_users SET platform_role='owner' WHERE id=?",
            [userId],
          );
          const id = randomUUID();
          const input = {
            ...tenants[0],
            id,
            slug: `provision-${id.slice(0, 8)}`,
            synthetic: false,
          };
          const key = operation({ tenantId: id });
          const result = await ops.provision(key, input, secondId, snapshot);
          assert.deepEqual(
            await ops.provision(key, input, secondId, snapshot),
            result,
          );
          const [{ count }] = await db.query(
            "SELECT COUNT(*) AS count FROM tenant_memberships WHERE tenant_id=? AND role='owner' AND status='active'",
            [id],
          );
          assert.equal(Number(count), 1);
          const failId = randomUUID();
          await db.query(
            "CREATE TRIGGER fail_activation BEFORE UPDATE ON tenants FOR EACH ROW BEGIN IF NEW.slug='fail-provision' AND NEW.status='active' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected failure'; END IF; END",
          );
          await assert.rejects(
            ops.provision(
              operation({ tenantId: failId }),
              { ...input, id: failId, slug: "fail-provision" },
              secondId,
              snapshot,
            ),
          );
          const [missing] = await db.query(
            "SELECT COUNT(*) AS count FROM tenants WHERE id=?",
            [failId],
          );
          assert.equal(Number(missing.count), 0);
          await db.query("DROP TRIGGER fail_activation");
        },
      );
      await context.test(
        "concurrent retries converge and revocation serializes with publication",
        async () => {
          const createKey = operation();
          const [one, two] = await Promise.all([
            ops.createDraft(createKey, snapshot),
            ops.createDraft(createKey, snapshot),
          ]);
          assert.deepEqual(one, two);
          const [a, b] = await Promise.all([
            ops.createDraft(operation(), snapshot),
            ops.createDraft(operation(), snapshot),
          ]);
          assert.notEqual(a.revision, b.revision);
          const publishKey = operation();
          const [published, retried] = await Promise.all([
            ops.publish(publishKey, a.id!, 1),
            ops.publish(publishKey, a.id!, 1),
          ]);
          assert.deepEqual(published, retried);
          const activeToken = randomUUID();
          await db.query(
            "INSERT INTO auth_sessions(id,user_id,token,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))",
            [randomUUID(), secondId, activeToken],
          );
          const draft = await ops.createDraft(
            operation({ token: activeToken }),
            snapshot,
          );
          const [member] = await db.query(
            "SELECT lock_version FROM tenant_memberships WHERE id=?",
            [secondMember],
          );
          const [revocation, publish] = await Promise.allSettled([
            ops.changeMembership(
              operation(),
              secondMember,
              member.lock_version,
              "owner",
              false,
            ),
            ops.publish(operation({ token: activeToken }), draft.id!, 1),
          ]);
          assert.equal(revocation.status, "fulfilled");
          if (publish.status === "rejected")
            assert.match(String(publish.reason), /forbidden/);
          await assert.rejects(
            ops.createDraft(operation({ token: activeToken }), snapshot),
            /forbidden/,
          );
        },
      );
      await context.test(
        "pinned Better Auth core can create, normalize, log in and revoke against the reviewed schema",
        async () => {
          const identity = createAuthentication(
            { ...config, database: name },
            "a-local-validation-secret-with-at-least-32-chars",
            "http://localhost:3000",
          );
          try {
            const result = await identity.auth.api.signUpEmail({
              body: {
                name: "Auth Example",
                email: "Auth.Example@Example.test",
                password: "validation-password-123",
              },
            });
            assert.equal(result.user.email, "auth.example@example.test");
            assert.ok(result.token);
            await assert.rejects(
              identity.auth.api.signUpEmail({
                body: {
                  name: "Duplicate",
                  email: "auth.example@example.test",
                  password: "validation-password-123",
                },
              }),
            );
            const session = await identity.auth.api.signInEmail({
              body: {
                email: "auth.example@example.test",
                password: "validation-password-123",
              },
            });
            assert.ok(session.token);
            const [count] = await db.query(
              "SELECT COUNT(*) AS count FROM tenant_memberships WHERE user_id=?",
              [result.user.id],
            );
            assert.equal(Number(count.count), 0);
            // Exercise signed cookies through the mounted HTTP adapter and actual database.
            const server = createServer(
              createPublicApp({
                authentication: createAuthRoutes({
                  auth: identity.auth,
                  store: new MariaDbWorkspaceStore(db),
                  operations: ops,
                  baseURL: "http://localhost:3000",
                }),
                resolvePage: createPublicSiteResolver(
                  new MariaDbTenantRepository(db),
                  new MariaDbWebsiteRepository(db),
                ),
                renderPage: async () => ({
                  template: "",
                  lang: "en",
                  html: "",
                  head: "",
                  data: "",
                }),
                onError: () => {},
              }),
            );
            await new Promise<void>((resolve) =>
              server.listen(0, "127.0.0.1", resolve),
            );
            try {
              const address = server.address();
              assert.ok(address && typeof address !== "string");
              const base = `http://127.0.0.1:${address.port}`;
              const origin = "http://localhost:3000";
              assert.equal(
                (await fetch(`${base}/workspace`, { redirect: "manual" }))
                  .status,
                303,
              );
              assert.equal((await fetch(`${base}/api/workspaces`)).status, 401);
              const login = await fetch(`${base}/api/auth/sign-in/email`, {
                method: "POST",
                headers: { origin, "content-type": "application/json" },
                body: JSON.stringify({
                  email: "auth.example@example.test",
                  password: "validation-password-123",
                }),
              });
              assert.equal(login.status, 200);
              const setCookies = login.headers.getSetCookie();
              assert.ok(
                setCookies.some(
                  (cookie) =>
                    /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie),
                ),
              );
              assert.ok(setCookies.every((cookie) => !/Domain=/i.test(cookie)));
              const cookie = setCookies
                .map((value) => value.split(";")[0])
                .join("; ");
              const headers = {
                cookie,
                origin,
                "idempotency-key": randomUUID(),
              };
              assert.equal(
                (
                  await fetch(`${base}/api/session`, {
                    headers: { cookie: cookie + "tampered" },
                  })
                ).status,
                401,
              );
              const workspacePath = `${base}/api/workspaces/${tenant.slug}`;
              assert.equal(
                (await fetch(workspacePath, { headers })).status,
                404,
              );
              assert.equal(
                (
                  await fetch(`${workspacePath}/membership`, {
                    method: "POST",
                    headers,
                  })
                ).status,
                403,
              );
              await db.query(
                "UPDATE auth_users SET email_verified=1 WHERE id=?",
                [result.user.id],
              );
              assert.equal(
                (
                  await fetch(`${workspacePath}/membership`, {
                    method: "POST",
                    headers,
                  })
                ).status,
                200,
              );
              const workspace = (await (
                await fetch(workspacePath, { headers })
              ).json()) as Pick<Workspace, "membership" | "capabilities">;
              assert.equal(workspace.membership.role, "subscriber");
              assert.deepEqual(workspace.capabilities, []);
              assert.equal(
                (await fetch(`${workspacePath}/members`, { headers })).status,
                403,
              );
              assert.equal(
                (await fetch(`${base}/api/workspaces/beta`, { headers }))
                  .status,
                404,
              );
              await db.query(
                "UPDATE tenant_memberships SET role='owner' WHERE tenant_id=? AND user_id=?",
                [tenant.id, result.user.id],
              );
              assert.equal(
                (await fetch(`${workspacePath}/members`, { headers })).status,
                200,
              );
              const patch = {
                ...headers,
                "content-type": "application/json",
                "idempotency-key": randomUUID(),
              };
              const changed = await fetch(
                `${workspacePath}/members/${workspace.membership.id}`,
                {
                  method: "PATCH",
                  headers: patch,
                  body: JSON.stringify({
                    role: "support",
                    active: true,
                    version: 1,
                  }),
                },
              );
              assert.equal(changed.status, 200);
              assert.equal(
                (await fetch(`${workspacePath}/members`, { headers })).status,
                403,
              );
              await db.query(
                "UPDATE tenants SET status='suspended' WHERE id=?",
                [tenant.id],
              );
              assert.equal(
                (await fetch(workspacePath, { headers })).status,
                404,
              );
              await db.query("UPDATE tenants SET status='active' WHERE id=?", [
                tenant.id,
              ]);
              await db.query(
                "UPDATE tenant_memberships SET status='revoked',revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND user_id=?",
                [tenant.id, result.user.id],
              );
              assert.equal(
                (await fetch(workspacePath, { headers })).status,
                404,
              );
              const signout = await fetch(`${base}/api/auth/sign-out`, {
                method: "POST",
                headers,
              });
              assert.equal(signout.status, 200);
              assert.equal(
                (await fetch(`${base}/api/session`, { headers })).status,
                401,
              );
              const formLogin = await fetch(`${base}/ra/${tenant.slug}/login`, {
                method: "POST",
                redirect: "manual",
                headers: {
                  origin,
                  "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                  email: "auth.example@example.test",
                  password: "validation-password-123",
                }),
              });
              assert.equal(formLogin.status, 303);
              const expiredCookie = formLogin.headers
                .getSetCookie()
                .map((value) => value.split(";")[0])
                .join("; ");
              await db.query(
                "UPDATE auth_sessions SET created_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 HOUR),expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR) WHERE user_id=?",
                [result.user.id],
              );
              assert.equal(
                (
                  await fetch(`${base}/api/session`, {
                    headers: { cookie: expiredCookie },
                  })
                ).status,
                401,
              );
              assert.equal(
                (
                  await fetch(`${base}/api/session`, {
                    headers: { cookie: cookie + "tampered" },
                  })
                ).status,
                401,
              );
            } finally {
              server.closeAllConnections();
              await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
              );
            }

            await db.query("DELETE FROM auth_sessions WHERE user_id=?", [
              result.user.id,
            ]);
            await assert.rejects(
              ops.enroll(operation({ token: session.token! })),
              /unauthorized/,
            );
          } finally {
            await identity.close();
          }
        },
      );
      await context.test(
        "signup origins, cross-RA logins and durable audit history stay separate from memberships",
        async () => {
          const identity = createAuthentication(
            { ...config, database: name },
            "a-local-validation-secret-with-at-least-32-chars",
            "http://localhost:3000",
          );
          try {
            await assert.rejects(
              withAuthTenant(tenants[0].id, () =>
                identity.auth.api.signUpEmail({
                  body: {
                    name: "Forged",
                    email: "context@example.test",
                    password: "context-password-123",
                    signupTenantId: tenants[2].id,
                  } as never,
                }),
              ),
              /not allowed/,
            );
            const signedUp = await withAuthTenant(tenants[0].id, () =>
              identity.auth.api.signUpEmail({
                body: {
                  name: "Context User",
                  email: "context@example.test",
                  password: "context-password-123",
                } as never,
              }),
            );
            const [user] = await db.query(
              "SELECT signup_tenant_id FROM auth_users WHERE id=?",
              [signedUp.user.id],
            );
            assert.equal(user.signup_tenant_id, tenants[0].id);
            assert.equal("signupTenantId" in signedUp.user, false);
            const [firstSession] = await db.query(
              "SELECT id,login_tenant_id FROM auth_sessions WHERE token=?",
              [signedUp.token],
            );
            assert.equal(firstSession.login_tenant_id, tenants[0].id);
            const betaLogin = await withAuthTenant(tenants[2].id, () =>
              identity.auth.api.signInEmail({
                body: {
                  email: "context@example.test",
                  password: "context-password-123",
                  loginTenantId: tenants[0].id,
                } as never,
              }),
            );
            const [secondSession] = await db.query(
              "SELECT id,login_tenant_id FROM auth_sessions WHERE token=?",
              [betaLogin.token],
            );
            assert.equal(secondSession.login_tenant_id, tenants[2].id);
            const [unchanged] = await db.query(
              "SELECT signup_tenant_id FROM auth_users WHERE id=?",
              [signedUp.user.id],
            );
            assert.equal(unchanged.signup_tenant_id, tenants[0].id);
            assert.deepEqual(
              await db.query(
                "SELECT id FROM tenant_memberships WHERE user_id=?",
                [signedUp.user.id],
              ),
              [],
            );
            const audit = await db.query(
              "SELECT action,tenant_id,entity_id FROM audit_events WHERE actor_user_id=? AND action IN ('auth.signup','auth.login')",
              [signedUp.user.id],
            );
            assert.equal(audit.length, 3);
            assert.ok(
              audit.some(
                (row: {
                  action: string;
                  tenant_id: string;
                  entity_id: string;
                }) =>
                  row.action === "auth.login" &&
                  row.tenant_id === tenants[2].id &&
                  row.entity_id === secondSession.id,
              ),
            );
            const global = await identity.auth.api.signInEmail({
              body: {
                email: "context@example.test",
                password: "context-password-123",
              },
            });
            const [globalSession] = await db.query(
              "SELECT login_tenant_id FROM auth_sessions WHERE token=?",
              [global.token],
            );
            assert.equal(globalSession.login_tenant_id, null);
            const [platformEvent] = await db.query(
              "SELECT scope,tenant_id FROM audit_events WHERE actor_user_id=? AND scope='platform'",
              [signedUp.user.id],
            );
            assert.equal(platformEvent.tenant_id, null);
            await assert.rejects(
              withAuthTenant(tenants[2].id, () =>
                identity.auth.api.signInEmail({
                  body: {
                    email: "context@example.test",
                    password: "wrong-password-123",
                  },
                }),
              ),
            );
            assert.equal(
              (
                await db.query(
                  "SELECT id FROM audit_events WHERE actor_user_id=?",
                  [signedUp.user.id],
                )
              ).length,
              4,
            );
            await db.query("DELETE FROM auth_sessions WHERE user_id=?", [
              signedUp.user.id,
            ]);
            assert.equal(
              (
                await db.query(
                  "SELECT id FROM audit_events WHERE actor_user_id=?",
                  [signedUp.user.id],
                )
              ).length,
              4,
            );
            // A trigger failure must roll back the session insertion, not permit unaudited logins.
            await db.query(
              "CREATE TRIGGER reject_auth_test BEFORE INSERT ON audit_events FOR EACH ROW BEGIN IF NEW.action='auth.login' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Injected auth audit failure'; END IF; END",
            );
            try {
              await assert.rejects(
                withAuthTenant(tenants[0].id, () =>
                  identity.auth.api.signInEmail({
                    body: {
                      email: "context@example.test",
                      password: "context-password-123",
                    },
                  }),
                ),
              );
              assert.deepEqual(
                await db.query("SELECT id FROM auth_sessions WHERE user_id=?", [
                  signedUp.user.id,
                ]),
                [],
              );
            } finally {
              await db.query("DROP TRIGGER reject_auth_test");
            }
            await assert.rejects(
              db.query("UPDATE auth_users SET signup_tenant_id=? WHERE id=?", [
                randomUUID(),
                signedUp.user.id,
              ]),
            );
          } finally {
            await identity.close();
          }
        },
      );
    } finally {
      await db.destroy();
      await admin.query(`DROP DATABASE \`${name}\``);
      await admin.destroy();
    }
  },
);

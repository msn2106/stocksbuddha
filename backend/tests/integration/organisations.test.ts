import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, databaseConfig } from "../../../database/config";
import { runMigrations } from "../../../database/runner";
import { loadManifest } from "../../../database/manifest";
import { seedDemo } from "../../../database/seeds/demo";
import { OrganisationService } from "../../src/organisations/service";
import { createAuthentication } from "../../src/auth/config";
import { tenants } from "../../src/tenants/tenants";

test(
  "MariaDB organisation invitations: real constraints, activation, roles, expiry, concurrency and cross-tenant isolation",
  { skip: process.env.RUN_DATABASE_TESTS !== "true" },
  async () => {
    const config = databaseConfig(process.env, "dev"),
      admin = createDatabase(config, 3, 0);
    await admin.initialize();
    const name = `sb_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE \`${name}\``);
    const db = createDatabase({ ...config, database: name }, 10, 0);
    await db.initialize();
    let identity: ReturnType<typeof createAuthentication> | undefined;
    try {
      await runMigrations(db, await loadManifest(), true);
      await seedDemo(db, "dev");
      identity = createAuthentication(
        { ...config, database: name },
        "test-organisation-secret-at-least-32-characters",
        "http://localhost:3000",
      );

      const service = new OrganisationService(db),
        password = "test-password-for-organisation";
      const accounts = [];
      for (const email of [
        "platform@example.test",
        "admin@example.test",
        "analyst@example.test",
        "stranger@example.test",
      ]) {
        const result = await identity.auth.api.signUpEmail({
          body: { name: email.split("@")[0], email, password },
        });
        await db.query("UPDATE auth_users SET email_verified=1 WHERE id=?", [
          result.user.id,
        ]);
        accounts.push(result);
      }
      const [platform, raAdmin, analyst, stranger] = accounts;
      await db.query("UPDATE auth_users SET platform_role='owner' WHERE id=?", [
        platform.user.id,
      ]);
      const organisation = await service.create(platform.token!, {
        slug: "new-org",
        name: "New Organisation",
        legalName: "New Legal Name",
        monogram: "no",
      });
      assert.equal(organisation.status, "draft");
      const invitation = await service.invite(
        platform.token!,
        organisation.id,
        raAdmin.user.email,
        "owner",
      );
      const [stored] = await db.query(
        "SELECT token_hash FROM organisation_invitations WHERE id=?",
        [invitation.id],
      );
      assert.notEqual(stored.token_hash, invitation.token);
      assert.equal(
        (await service.preview("new-org", invitation.token))?.email,
        raAdmin.user.email,
      );
      assert.equal(await service.preview("beta", invitation.token), null);
      await assert.rejects(
        service.accept(stranger.token!, organisation.id, invitation.token),
        /invitation_unavailable/,
      );
      await db.query("UPDATE auth_users SET email_verified=0 WHERE id=?", [
        raAdmin.user.id,
      ]);
      await assert.rejects(
        service.accept(raAdmin.token!, organisation.id, invitation.token),
        /invitation_unavailable/,
      );
      await db.query("UPDATE auth_users SET email_verified=1 WHERE id=?", [
        raAdmin.user.id,
      ]);
      assert.equal(
        (
          await service.accept(
            raAdmin.token!,
            organisation.id,
            invitation.token,
          )
        ).role,
        "owner",
      );
      assert.equal(
        (
          await db.query("SELECT status FROM tenants WHERE id=?", [
            organisation.id,
          ])
        )[0].status,
        "active",
      );
      await assert.rejects(
        service.accept(raAdmin.token!, organisation.id, invitation.token),
        /invitation_unavailable/,
      );
      await assert.rejects(
        service.invite(
          raAdmin.token!,
          organisation.id,
          analyst.user.email,
          "owner",
        ),
        /forbidden/,
      );
      await assert.rejects(
        service.invite(
          raAdmin.token!,
          tenants[2].id,
          analyst.user.email,
          "analyst",
        ),
        /forbidden/,
      );
      const grant = await service.invite(
        raAdmin.token!,
        organisation.id,
        analyst.user.email,
        "analyst",
      );
      const attempts = await Promise.allSettled([
        service.accept(analyst.token!, organisation.id, grant.token),
        service.accept(analyst.token!, organisation.id, grant.token),
      ]);
      assert.equal(
        attempts.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        Number(
          (
            await db.query(
              "SELECT COUNT(*) AS total FROM tenant_memberships WHERE tenant_id=? AND user_id=?",
              [organisation.id, analyst.user.id],
            )
          )[0].total,
        ),
        1,
      );
      await assert.rejects(
        service.invite(
          analyst.token!,
          organisation.id,
          stranger.user.email,
          "support",
        ),
        /forbidden/,
      );
      const old = await service.invite(
        raAdmin.token!,
        organisation.id,
        stranger.user.email,
        "support",
      );
      const fresh = await service.invite(
        raAdmin.token!,
        organisation.id,
        stranger.user.email,
        "analyst",
      );
      assert.equal(await service.preview("new-org", old.token), null);
      await db.query(
        "UPDATE organisation_invitations SET created_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 HOUR),expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR) WHERE id=?",
        [fresh.id],
      );
      await assert.rejects(
        service.accept(stranger.token!, organisation.id, fresh.token),
        /invitation_unavailable/,
      );
      const revoke = await service.invite(
        raAdmin.token!,
        organisation.id,
        analyst.user.email,
        "support",
      );
      await db.query(
        "UPDATE tenant_memberships SET status='revoked',revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND user_id=?",
        [organisation.id, analyst.user.id],
      );
      await assert.rejects(
        service.accept(analyst.token!, organisation.id, revoke.token),
        /membership_revoked/,
      );
      const stale = await service.invite(
        raAdmin.token!,
        organisation.id,
        stranger.user.email,
        "support",
      );
      await db.query(
        "UPDATE tenant_memberships SET status='revoked',revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND user_id=?",
        [organisation.id, raAdmin.user.id],
      );
      await assert.rejects(
        service.accept(stranger.token!, organisation.id, stale.token),
        /invitation_unavailable/,
      );
      assert.ok(
        (
          await db.query(
            "SELECT id FROM audit_events WHERE action='organisation.invitation_accepted'",
          )
        ).length >= 2,
      );
    } finally {
      await identity?.close();
      await db.destroy();
      await admin.query(`DROP DATABASE \`${name}\``);
      await admin.destroy();
    }
  },
);

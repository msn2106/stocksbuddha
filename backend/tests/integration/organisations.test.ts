import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, databaseConfig } from "../../../database/config";
import { runMigrations } from "../../../database/runner";
import { loadManifest } from "../../../database/manifest";
import { seedDemo } from "../../../database/seeds/demo";
import { TenantOperations } from "../../src/database/operations";
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
        "subscriber@example.test",
        "race@example.test",
      ]) {
        const result = await identity.auth.api.signUpEmail({
          body: { name: email.split("@")[0], email, password },
        });
        await db.query("UPDATE auth_users SET email_verified=1 WHERE id=?", [
          result.user.id,
        ]);
        accounts.push(result);
      }
      const [platform, raAdmin, analyst, stranger, subscriber, race] = accounts;
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
        "Test Person",
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
          "Test Person",
        ),
        /forbidden/,
      );
      await assert.rejects(
        service.invite(
          raAdmin.token!,
          tenants[2].id,
          analyst.user.email,
          "analyst",
          "Test Person",
        ),
        /forbidden/,
      );
      const grant = await service.invite(
        raAdmin.token!,
        organisation.id,
        analyst.user.email,
        "analyst",
        "Test Person",
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
          "Test Person",
        ),
        /forbidden/,
      );
      const old = await service.invite(
        raAdmin.token!,
        organisation.id,
        stranger.user.email,
        "support",
        "Test Person",
      );
      const fresh = await service.invite(
        raAdmin.token!,
        organisation.id,
        stranger.user.email,
        "analyst",
        "Test Person",
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
      await db.query(
        "UPDATE organisation_invitations SET full_name=NULL WHERE id=?",
        [fresh.id],
      );
      await assert.rejects(
        service.resend(raAdmin.token!, organisation.id, fresh.id),
        /invalid_name/,
      );
      const expiredReplacement = await service.resend(
        raAdmin.token!,
        organisation.id,
        fresh.id,
        "Legacy Recipient",
      );
      assert.equal(expiredReplacement.fullName, "Legacy Recipient");
      assert.equal(
        (await service.preview("new-org", expiredReplacement.token))?.email,
        stranger.user.email,
      );
      await service.revokeInvitation(
        raAdmin.token!,
        organisation.id,
        expiredReplacement.id,
      );
      const revoke = await service.invite(
        raAdmin.token!,
        organisation.id,
        analyst.user.email,
        "analyst",
        "Test Person",
      );
      await db.query(
        "UPDATE tenant_memberships SET status='revoked',revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND user_id=?",
        [organisation.id, analyst.user.id],
      );
      await assert.rejects(
        service.accept(analyst.token!, organisation.id, revoke.token),
        /membership_revoked/,
      );
      const pending = await service.invite(
        raAdmin.token!,
        organisation.id,
        stranger.user.email,
        "support",
        "Stored Recipient",
      );
      await assert.rejects(
        service.resend(platform.token!, organisation.id, pending.id),
        /forbidden/,
      );
      await assert.rejects(
        service.resend(raAdmin.token!, tenants[2].id, pending.id),
        /forbidden/,
      );
      const retries = await Promise.allSettled([
        service.resend(raAdmin.token!, organisation.id, pending.id),
        service.resend(raAdmin.token!, organisation.id, pending.id),
      ]);
      const successful = retries.filter(
        (result) => result.status === "fulfilled",
      );
      assert.equal(successful.length, 1);
      const replacement = successful[0].value;
      assert.equal(replacement.fullName, "Stored Recipient");
      assert.equal(await service.preview("new-org", pending.token), null);
      await service.accept(stranger.token!, organisation.id, replacement.token);
      const roster = await service.members(raAdmin.token!, organisation.id);
      const other = roster.find(
        (member) => member.email === stranger.user.email,
      )!;
      const self = roster.find(
        (member) => member.email === raAdmin.user.email,
      )!;
      assert.equal(self.canRevoke, false);
      await assert.rejects(
        service.revokeMember(raAdmin.token!, organisation.id, self.id),
        /membership_unavailable/,
      );
      await assert.rejects(
        service.revokeMember(platform.token!, organisation.id, other.id),
        /forbidden/,
      );
      await assert.rejects(
        service.revokeMember(raAdmin.token!, tenants[2].id, other.id),
        /membership_unavailable/,
      );
      const outstanding = await service.invite(
        raAdmin.token!,
        organisation.id,
        stranger.user.email,
        "support",
        "Stored Recipient",
      );
      await service.revokeInvitation(
        raAdmin.token!,
        organisation.id,
        outstanding.id,
      );
      assert.equal(await service.preview("new-org", outstanding.token), null);
      const outstanding2 = await service.invite(
        raAdmin.token!,
        organisation.id,
        stranger.user.email,
        "support",
        "Stored Recipient",
      );
      await service.revokeMember(raAdmin.token!, organisation.id, other.id);
      assert.equal(
        (await service.members(raAdmin.token!, organisation.id)).find(
          (member) => member.id === other.id,
        )?.status,
        "revoked",
      );
      assert.equal(await service.preview("new-org", outstanding2.token), null);
      await assert.rejects(
        service.accept(stranger.token!, organisation.id, outstanding2.token),
        /invitation_unavailable/,
      );
      // Invitation-only account creation is verified, single-use and compatible with the pinned auth core.
      const newInvite = await service.invite(
        raAdmin.token!,
        organisation.id,
        "new-invited@example.test",
        "support",
        "New Invitee",
      );
      const attemptsToRegister = await Promise.allSettled([
        service.register(
          organisation.id,
          newInvite.token,
          "New Invitee",
          password,
          "register-race",
        ),
        service.register(
          organisation.id,
          newInvite.token,
          "New Invitee",
          password,
          "register-race",
        ),
      ]);
      assert.equal(
        attemptsToRegister.filter((result) => result.status === "fulfilled")
          .length,
        1,
      );
      const [created] = await db.query(
        "SELECT id,email_verified,platform_role,signup_tenant_id FROM auth_users WHERE email=?",
        ["new-invited@example.test"],
      );
      assert.equal(Number(created.email_verified), 1);
      assert.equal(created.platform_role, null);
      assert.equal(created.signup_tenant_id, organisation.id);
      const [createdMembership] = await db.query(
        "SELECT role FROM tenant_memberships WHERE user_id=? AND tenant_id=?",
        [created.id, organisation.id],
      );
      assert.equal(createdMembership.role, "support");
      const login = await identity.auth.api.signInEmail({
        body: { email: "new-invited@example.test", password },
      });
      assert.equal(login.user.id, created.id);
      assert.equal(await service.preview("new-org", newInvite.token), null);
      const existingInvite = await service.invite(
        platform.token!,
        organisation.id,
        raAdmin.user.email,
        "owner",
        "Existing Admin",
      );
      const [priorCredential] = await db.query(
        "SELECT password FROM auth_accounts WHERE user_id=? AND provider_id='credential'",
        [raAdmin.user.id],
      );
      await assert.rejects(
        service.register(
          organisation.id,
          existingInvite.token,
          "Replace",
          "Replacement-password",
          "existing-protection",
        ),
        /account_exists/,
      );
      const [afterCredential] = await db.query(
        "SELECT password FROM auth_accounts WHERE user_id=? AND provider_id='credential'",
        [raAdmin.user.id],
      );
      assert.equal(afterCredential.password, priorCredential.password);
      for (const reason of ["expired", "revoked", "tenant"]) {
        const email = `blocked-${reason}@example.test`;
        const blocked = await service.invite(
          raAdmin.token!,
          organisation.id,
          email,
          "analyst",
          "Blocked",
        );
        if (reason === "expired")
          await db.query(
            "UPDATE organisation_invitations SET created_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 HOUR),expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR) WHERE id=?",
            [blocked.id],
          );
        if (reason === "revoked")
          await service.revokeInvitation(
            raAdmin.token!,
            organisation.id,
            blocked.id,
          );
        await assert.rejects(
          service.register(
            reason === "tenant" ? tenants[2].id : organisation.id,
            blocked.token,
            "Blocked",
            password,
            `blocked-${reason}`,
          ),
          /invitation_unavailable/,
        );
        assert.equal(
          (await db.query("SELECT id FROM auth_users WHERE email=?", [email]))
            .length,
          0,
        );
      }
      const rollbackInvite = await service.invite(
        raAdmin.token!,
        organisation.id,
        "rollback@example.test",
        "analyst",
        "Rollback",
      );
      await db.query(
        "CREATE TRIGGER reject_test_invite_account BEFORE INSERT ON auth_accounts FOR EACH ROW BEGIN IF EXISTS (SELECT 1 FROM auth_users WHERE id=NEW.user_id AND email='rollback@example.test') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test rollback'; END IF; END",
      );
      await assert.rejects(
        service.register(
          organisation.id,
          rollbackInvite.token,
          "Rollback",
          password,
          "rollback",
        ),
      );
      assert.equal(
        (
          await db.query(
            "SELECT id FROM auth_users WHERE email='rollback@example.test'",
          )
        ).length,
        0,
      );
      assert.ok(await service.preview("new-org", rollbackInvite.token));
      await db.query("DROP TRIGGER reject_test_invite_account");
      await service.register(
        organisation.id,
        rollbackInvite.token,
        "Rollback",
        password,
        "rollback",
      );
      const ops = new TenantOperations(db);
      const legacyInvite = await service.invite(
        raAdmin.token!,
        organisation.id,
        subscriber.user.email,
        "analyst",
        "Subscriber",
      );
      await ops.enroll({
        token: subscriber.token!,
        tenantId: organisation.id,
        key: randomUUID(),
      });
      const [beforeInvites] = await db.query(
        "SELECT COUNT(*) AS total FROM organisation_invitations WHERE tenant_id=? AND email=?",
        [organisation.id, subscriber.user.email],
      );
      for (const role of ["owner", "analyst", "support"])
        await assert.rejects(
          service.invite(
            role === "owner" ? platform.token! : raAdmin.token!,
            organisation.id,
            subscriber.user.email,
            role,
            "Subscriber",
          ),
          /subscriber_conflict/,
        );
      await assert.rejects(
        service.resend(raAdmin.token!, organisation.id, legacyInvite.id),
        /subscriber_conflict/,
      );
      await assert.rejects(
        service.accept(subscriber.token!, organisation.id, legacyInvite.token),
        /subscriber_conflict/,
      );
      const [afterInvites] = await db.query(
        "SELECT COUNT(*) AS total FROM organisation_invitations WHERE tenant_id=? AND email=?",
        [organisation.id, subscriber.user.email],
      );
      assert.equal(Number(afterInvites.total), Number(beforeInvites.total));
      assert.ok(await service.preview("new-org", legacyInvite.token));
      // The restriction is per RA: the same identity may have a different role elsewhere.
      const otherInvite = await service.invite(
        platform.token!,
        tenants[2].id,
        subscriber.user.email,
        "support",
        "Subscriber elsewhere",
      );
      await service.accept(subscriber.token!, tenants[2].id, otherInvite.token);
      const [firstRole] = await db.query(
        "SELECT role FROM tenant_memberships WHERE tenant_id=? AND user_id=?",
        [organisation.id, subscriber.user.id],
      );
      assert.equal(firstRole.role, "subscriber");
      const raceInvite = await service.invite(
        raAdmin.token!,
        organisation.id,
        race.user.email,
        "analyst",
        "Race",
      );
      const races = await Promise.allSettled([
        ops.enroll({
          token: race.token!,
          tenantId: organisation.id,
          key: randomUUID(),
        }),
        service.accept(race.token!, organisation.id, raceInvite.token),
      ]);
      assert.equal(
        races.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const [raceRole] = await db.query(
        "SELECT role FROM tenant_memberships WHERE tenant_id=? AND user_id=?",
        [organisation.id, race.user.id],
      );
      assert.ok(["subscriber", "analyst"].includes(raceRole.role));
      await assert.rejects(
        ops.enroll({
          token: raAdmin.token!,
          tenantId: organisation.id,
          key: randomUUID(),
        }),
        /staff_only/,
      );
      const stale = await service.invite(
        raAdmin.token!,
        organisation.id,
        login.user.email,
        "support",
        "Test Person",
      );
      await db.query(
        "UPDATE tenant_memberships SET status='revoked',revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND user_id=?",
        [organisation.id, raAdmin.user.id],
      );
      await assert.rejects(
        service.accept(login.token!, organisation.id, stale.token),
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

import "reflect-metadata";
import express from "express";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createDatabase, databaseConfig } from "../../database/config";
import { runMigrations } from "../../database/runner";
import { loadManifest } from "../../database/manifest";
import { seedDemo } from "../../database/seeds/demo";
import {
  createAuthentication,
  authOptions,
} from "../../backend/src/auth/config";
import { createAuthRoutes } from "../../backend/src/auth/routes";
import { createPublicApp } from "../../backend/src/app";
import { MariaDbWorkspaceStore } from "../../backend/src/auth/workspaces";
import {
  MariaDbTenantRepository,
  MariaDbWebsiteRepository,
} from "../../backend/src/database/repositories";
import { createPublicSiteResolver } from "../../backend/src/tenancy/resolve-public-site";
import { TenantOperations } from "../../backend/src/database/operations";
import { OrganisationService } from "../../backend/src/organisations/service";
import type { AuthEmail } from "../../backend/src/auth/email";

// This test-only entry creates disposable fixtures and captures email; it is never bundled into the application.
if (process.env.DB_ENV !== "dev" || !process.env.DB_ROOT_PASSWORD)
  throw new Error(
    "Local dev admin credentials required for disposable browser fixtures",
  );
const config = databaseConfig({
  ...process.env,
  DB_USER: "root",
  DB_PASSWORD: process.env.DB_ROOT_PASSWORD,
});
const admin = createDatabase(config, 3, 0);
await admin.initialize();
const name = `sb_test_${randomUUID().replaceAll("-", "")}`;
await admin.query(`CREATE DATABASE \`${name}\``);
const db = createDatabase({ ...config, database: name }, 10, 0);
await db.initialize();
await runMigrations(db, await loadManifest(), true);
await seedDemo(db, "dev");
const messages: AuthEmail[] = [];
const mailer = async (message: AuthEmail) => {
  messages.push(message);
};
const origin = "http://127.0.0.1:3111";
const { betterAuth } = await import(
  new URL(
    "../../backend/node_modules/better-auth/dist/index.mjs",
    import.meta.url,
  ).href
);
// Rate-limit behavior has dedicated tests; disable it in this multi-account UI fixture to avoid cross-scenario buckets.
const factory = ((options: ReturnType<typeof authOptions>) =>
  betterAuth({ ...options, rateLimit: { enabled: false } })) as NonNullable<
  Parameters<typeof createAuthentication>[3]
>;
const identity = createAuthentication(
  { ...config, database: name },
  "playwright-test-secret-with-at-least-32-characters",
  origin,
  factory,
  { mailer },
);
for (const email of [
  "owner@example.test",
  "admin@example.test",
  "analyst@example.test",
  "analyst-policy@example.test",
  "support-policy@example.test",
  "investor@example.test",
  "logout@example.test",
]) {
  const result = await identity.auth.api.signUpEmail({
    body: {
      name: email.split("@")[0] + " User",
      email,
      password: "test-password-123",
    },
  });
  await db.query("UPDATE auth_users SET email_verified=1 WHERE id=?", [
    result.user.id,
  ]);
  if (email.startsWith("owner@"))
    await db.query("UPDATE auth_users SET platform_role='owner' WHERE id=?", [
      result.user.id,
    ]);
}
// Keep working branding distinct from the published snapshot for public-page regressions.
await db.query(
  "UPDATE tenants SET display_name='UNPUBLISHED PRIVATE BETA',legal_name='PRIVATE LEGAL BETA',registration_number='PRIVATE-REG' WHERE slug='beta'",
);
await db.query(
  "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,status,profile_json,capabilities_json) SELECT ?,t.id,u.id,'subscriber','active','{\"schemaVersion\":1}','{}' FROM tenants t CROSS JOIN auth_users u WHERE t.slug='beta' AND u.email='logout@example.test'",
  [randomUUID()],
);
messages.length = 0;
const service = new OrganisationService(db),
  store = new MariaDbWorkspaceStore(db);
const app = createPublicApp({
  authentication: createAuthRoutes({
    auth: identity.auth,
    store,
    organisations: service,
    mailer,
    emailEnabled: true,
    operations: new TenantOperations(db),
    websiteOperations: new TenantOperations(db),
    baseURL: origin,
  }),
  resolvePage: createPublicSiteResolver(
    new MariaDbTenantRepository(db),
    new MariaDbWebsiteRepository(db),
  ),
  assets: express
    .Router()
    .get("/__test/mail", (_req, res) => res.json(messages))
    .post("/__test/suspend-beta", async (req, res) => {
      if (req.headers.origin !== origin) return res.sendStatus(403);
      await db.query("UPDATE tenants SET status='suspended' WHERE slug='beta'");
      return res.sendStatus(204);
    })
    .use("/assets", express.static("frontend/dist/client/assets")),
  renderPage: async (data) => {
    const renderer = await import(
      new URL("../../frontend/dist/server/entry-server.js", import.meta.url)
        .href
    );
    return {
      template: await readFile("frontend/dist/client/index.html", "utf8"),
      ...renderer.render(data),
    };
  },
  onError: (error) => console.error(error),
});
const server = app.listen(3111, "127.0.0.1", () =>
  console.log("Organisation browser fixtures ready"),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await identity.close();
  await db.destroy();
  await admin.query(`DROP DATABASE \`${name}\``);
  await admin.destroy();
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);

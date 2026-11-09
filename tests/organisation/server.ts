import { IntegrationSettingsService } from "../../backend/src/integrations/service";
import { RecoveryEmailLimiter } from "../../backend/src/auth/recovery-limits";
import { SmsService } from "../../backend/src/sms/service";
import type { SmsMessage } from "../../backend/src/sms/horizon";
import { OnboardingService } from "../../backend/src/onboarding/service";
import { DocumentService } from "../../backend/src/documents/service";
import type { GoogleDriveStorage } from "../../backend/src/documents/drive";
import type { PaymentGateway } from "../../backend/src/onboarding/cashfree";
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
import type { ApplicationEmail } from "../../backend/src/auth/email";

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
const messages: ApplicationEmail[] = [];
const mailer = async (message: ApplicationEmail) => {
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
const recoveryEmails = new RecoveryEmailLimiter(db);
const identity = createAuthentication(
  { ...config, database: name },
  "playwright-test-secret-with-at-least-32-characters",
  origin,
  factory,
  { mailer, reserveRecoveryEmail: recoveryEmails.reserve.bind(recoveryEmails) },
);
for (const email of [
  "settings-admin@example.test",
  "onboarding-admin@example.test",
  "onboarding-investor@example.test",
  "onboarding-other@example.test",
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
for (const [email, role] of [
  ["onboarding-admin@example.test", "owner"],
  ["onboarding-investor@example.test", "subscriber"],
  ["onboarding-other@example.test", "subscriber"],
]) {
  await db.query(
    "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,status,profile_json,capabilities_json) SELECT ?,t.id,u.id,?,'active','{\"schemaVersion\":1}','{}' FROM tenants t CROSS JOIN auth_users u WHERE t.slug='stocksbuddha' AND u.email=?",
    [randomUUID(), role, email],
  );
}
await db.query("UPDATE tenants SET status='active' WHERE slug='alpha'");
await db.query(
  "INSERT INTO tenant_memberships(id,tenant_id,user_id,role,status,profile_json,capabilities_json) SELECT ?,t.id,u.id,'owner','active','{\"schemaVersion\":1}','{}' FROM tenants t CROSS JOIN auth_users u WHERE t.slug='alpha' AND u.email='settings-admin@example.test'",
  [randomUUID()],
);
const objects = new Map<string, Buffer>();
const storage = {
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
    objects.set(id, Buffer.from(bytes));
    return id;
  },
  download: async (id: string) => objects.get(id)!,
} as unknown as GoogleDriveStorage;
const documents = new DocumentService(db, storage);
const payments = new Set<string>();
const gateway: PaymentGateway = {
  mode: "sandbox",
  create: async (order) => `fixture-${order.id}`,
  paid: async (id) => (payments.has(id) ? `payment-${id}` : null),
  closed: async () => false,
  verify: (_raw, _timestamp, signature) => signature === "test-only-signature",
};
const integrations = new IntegrationSettingsService(db, {
  ONBOARDING_DATA_KEY: "a".repeat(64),
  DB_ENV: "dev",
  NODE_ENV: "test",
});
const onboarding = new OnboardingService(db, {
  env: {
    AUTH_SECRET: "test-onboarding-secret-at-least-32-characters",
    AUTH_BASE_URL: origin,
    DB_ENV: "dev",
    ONBOARDING_DEV_SKIP: "true",
  },
  documents,
  mailer,
  gateways: new Map([["stocksbuddha", gateway]]),
  resolveGateway: (slug, manager) =>
    integrations.gateway(
      slug,
      slug === "stocksbuddha" ? gateway : undefined,
      manager,
    ),
});
const smsMessages: SmsMessage[] = [];
const sms = new SmsService(
  db,
  {
    ONBOARDING_DATA_KEY: "a".repeat(64),
    SMS_MODE: "trial",
    SMS_RECOVERY_SETTINGS_JSON: JSON.stringify({
      username: "platform",
      apiKey: "platform-secret",
      senderId: "HORIZN",
      entityId: "110100000000001",
      encoding: "txt",
      template: {
        id: "110100000000003",
        text: "Your recovery code is {{otp}}. Valid for {{expiryMinutes}} minutes.",
      },
    }),
  },
  async (message) => {
    smsMessages.push(message);
    return { messageId: "123456", balance: "100" };
  },
  undefined,
  async (email) => {
    await mailer({ to: email, kind: "security", url: `${origin}/login` });
  },
);
messages.length = 0;
const service = new OrganisationService(db),
  store = new MariaDbWorkspaceStore(db);
const app = createPublicApp({
  authentication: createAuthRoutes({
    sms,
    integrations,
    onboarding,
    documents,
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
    .post("/__test/settle", express.json(), async (req, res) => {
      if (req.headers.origin !== origin || typeof req.body?.id !== "string")
        return res.sendStatus(403);
      payments.add(req.body.id);
      await onboarding.reconcile("stocksbuddha", req.body.id);
      await onboarding.deliverOne();
      return res.sendStatus(204);
    })
    .get("/__test/sms", (_req, res) =>
      res.json(
        smsMessages.map((message) => ({
          mobile: message.mobile,
          message: message.message,
        })),
      ),
    )
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

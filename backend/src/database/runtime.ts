import { createDatabase, databaseConfig } from "../../../database/config";
import {
  MariaDbTenantRepository,
  MariaDbWebsiteRepository,
} from "./repositories";
import { createPublicSiteResolver } from "../tenancy/resolve-public-site";
import { SeedTenantRepository } from "../tenants/tenants";
import { SeedWebsiteRepository } from "../websites/repository";
import { migrationClasses } from "../../../database/catalog";
import { createAuthentication } from "../auth/config";
import { createAuthRoutes } from "../auth/routes";
import { MariaDbWorkspaceStore } from "../auth/workspaces";
import { TenantOperations } from "./operations";
import type { PublicAppDependencies } from "../app";
import { authMailer } from "../auth/email";
import { OrganisationService } from "../organisations/service";
import { trustedProxies } from "../auth/client-ip";

export type Persistence = {
  resolvePage: PublicAppDependencies["resolvePage"];
  authentication?: PublicAppDependencies["authentication"];
  close: () => Promise<void>;
  ready: () => Promise<boolean>;
};

/** Select an explicit repository mode; database failures never fall back to seed fixtures. */
export async function createPersistence(
  env: NodeJS.ProcessEnv,
  databaseFactory = createDatabase,
  authenticationFactory = createAuthentication,
): Promise<Persistence> {
  const mode =
    env.DATABASE_MODE ??
    (env.NODE_ENV === "production" ? "mariadb" : "fixtures");
  if (mode === "fixtures") {
    if (env.NODE_ENV === "production" && env.ALLOW_PUBLIC_PREVIEW !== "true")
      throw new Error(
        "Production fixtures require explicit public-preview opt-in",
      );
    return {
      resolvePage: createPublicSiteResolver(
        new SeedTenantRepository(),
        new SeedWebsiteRepository(),
      ),
      authentication: undefined,
      /** Fixture previews own no database resources. */
      close: async () => {},
      /** Fixture previews have no external persistence dependency. */
      ready: async () => true,
    };
  }
  if (mode !== "mariadb")
    throw new Error("DATABASE_MODE must be fixtures or mariadb");
  trustedProxies(env.AUTH_TRUSTED_PROXIES);
  const db = databaseFactory(databaseConfig(env));
  await db.initialize();
  try {
    await db.query("SELECT id FROM tenants LIMIT 1");
    const applied: { name: string }[] = await db.query(
      "SELECT name FROM migrations ORDER BY id",
    );
    const incomplete: unknown[] = await db.query(
      "SELECT id FROM migration_attempts WHERE status NOT IN ('succeeded','reconciled') LIMIT 1",
    );
    if (
      incomplete.length ||
      applied.length !== migrationClasses.length ||
      migrationClasses.some(
        (Class) => !applied.some((row) => row.name === new Class().name),
      )
    )
      throw new Error("Migration history is incomplete");
  } catch {
    await db.destroy();
    throw new Error(
      "Database schema is not ready; run the explicit migration command",
    );
  }
  let authentication: ReturnType<typeof createAuthentication>;
  let mailer: ReturnType<typeof authMailer>;
  try {
    if (!env.AUTH_SECRET || !env.AUTH_BASE_URL)
      throw new Error(
        "AUTH_SECRET and AUTH_BASE_URL are required in MariaDB mode",
      );
    if (
      env.NODE_ENV === "production" &&
      !env.AUTH_BASE_URL.startsWith("https://")
    )
      throw new Error(
        "Production authentication requires an HTTPS AUTH_BASE_URL",
      );
    mailer = authMailer(env);
    authentication = authenticationFactory(
      databaseConfig(env),
      env.AUTH_SECRET,
      env.AUTH_BASE_URL,
      undefined,
      { mailer, sharedRateLimit: true },
    );
  } catch (error) {
    await db.destroy();
    throw error;
  }
  return {
    authentication: createAuthRoutes({
      auth: authentication.auth,
      store: new MariaDbWorkspaceStore(db),
      operations: new TenantOperations(db),
      baseURL: env.AUTH_BASE_URL!,
      trustedProxyAddresses: env.AUTH_TRUSTED_PROXIES,
      emailEnabled: Boolean(mailer),
      mailer,
      organisations: new OrganisationService(db),
    }),
    resolvePage: createPublicSiteResolver(
      new MariaDbTenantRepository(db),
      new MariaDbWebsiteRepository(db),
    ),
    /** Release the runtime-owned TypeORM pool during application shutdown. */
    close: async () => {
      await Promise.all([authentication.close(), db.destroy()]);
    },
    /** Probe the live database without changing schema or exposing connection details. */
    ready: async () => {
      await db.query("SELECT 1");
      return true;
    },
  };
}

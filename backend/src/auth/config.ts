import { randomUUID } from "node:crypto";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { createPool } from "mysql2/promise";
import type { DatabaseConfig } from "../../../database/config";
import { currentAuthTenant } from "./tenant-context";
import { databaseRateLimiter } from "./rate-limit";
import type { AuthMailer } from "./email";

export type AuthServices = { mailer?: AuthMailer; sharedRateLimit?: boolean };

/** Define the pinned core auth mapping; username/OTP transports remain separate feature gates. */
export function authOptions(
  database: ReturnType<typeof createPool>,
  secret: string,
  baseURL: string,
  services: AuthServices = {},
): BetterAuthOptions {
  if (secret.length < 32)
    throw new Error(
      "Authentication secret must contain at least 32 characters",
    );
  const origin = new URL(baseURL).origin;
  if (baseURL !== origin || !/^https?:$/.test(new URL(baseURL).protocol))
    throw new Error("AUTH_BASE_URL must be an HTTP(S) origin without a path");
  return {
    database,
    secret,
    baseURL,
    trustedOrigins: [origin],
    rateLimit: {
      enabled: true,
      storage: "memory",
      window: 60,
      max: 100,
      ...(services.sharedRateLimit
        ? { customStorage: databaseRateLimiter(database) }
        : {}),
    },
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      ...(services.mailer
        ? {
            requireEmailVerification: true,
            autoSignIn: false,
            /** Deliver a tenant-scoped password-reset link through the configured mail service. */
            sendResetPassword: async ({ user, url }) =>
              services.mailer!({ to: user.email, url, kind: "reset" }),
          }
        : {}),
    },
    ...(services.mailer
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendOnSignIn: true,
            autoSignInAfterVerification: false,
            expiresIn: 3600,
            /** Deliver an account-verification link without creating an authenticated session. */
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: { email: string };
              url: string;
            }) => services.mailer!({ to: user.email, url, kind: "verify" }),
          },
        }
      : {}),
    databaseHooks: {
      user: {
        create: {
          /** Persist the first signup origin from trusted request context, ignoring client-supplied provenance. */
          before: async (user) => ({
            data: { ...user, signupTenantId: currentAuthTenant() },
          }),
        },
      },
      session: {
        create: {
          /** Record this session's login origin without changing global identity or tenant membership. */
          before: async (session) => ({
            data: { ...session, loginTenantId: currentAuthTenant() },
          }),
        },
      },
    },
    advanced: {
      useSecureCookies: origin.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      // Express supplies the socket address; forwarded headers have no authority.
      ipAddress: { ipAddressHeaders: ["x-auth-client-ip"] },
      database: {
        /** Generate the UUID string representation shared by all authentication tables. */
        generateId: () => randomUUID(),
      },
    },
    user: {
      modelName: "auth_users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        signupTenantId: {
          type: "string",
          fieldName: "signup_tenant_id",
          required: false,
          input: false,
          returned: false,
        },
        platform_role: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
      },
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    session: {
      modelName: "auth_sessions",
      additionalFields: {
        loginTenantId: {
          type: "string",
          fieldName: "login_tenant_id",
          required: false,
          input: false,
          returned: false,
        },
      },
      expiresIn: 60 * 60 * 24 * 7,
      // Absolute expiry avoids extending DB sessions without renewing the browser cookie.
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "auth_verifications",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
  };
}

/** Create an explicitly owned auth pool and framework instance for the HTTP authentication boundary. */
export function createAuthentication(
  config: DatabaseConfig,
  secret: string,
  baseURL: string,
  factory = betterAuth,
  services: AuthServices = {},
) {
  const pool = createPool({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    ssl: config.ssl,
    timezone: "Z",
    connectionLimit: 5,
    queueLimit: 20,
    waitForConnections: false,
    connectTimeout: 3000,
  });
  const auth = factory(authOptions(pool, secret, baseURL, services));
  return {
    auth,
    /** Close only the pool owned by this authentication instance. */
    close: () => pool.end(),
  };
}

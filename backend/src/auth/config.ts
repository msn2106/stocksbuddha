import { randomUUID } from "node:crypto";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { createPool } from "mysql2/promise";
import type { DatabaseConfig } from "../../../database/config";

/** Define the pinned core auth mapping; username/OTP transports remain separate feature gates. */
export function authOptions(
  database: ReturnType<typeof createPool>,
  secret: string,
  baseURL: string,
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
    rateLimit: { enabled: true, storage: "memory", window: 60, max: 100 },
    emailAndPassword: { enabled: true },
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
  const auth = factory(authOptions(pool, secret, baseURL));
  return {
    auth,
    /** Close only the pool owned by this authentication instance. */
    close: () => pool.end(),
  };
}

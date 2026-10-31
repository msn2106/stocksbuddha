import { DataSource } from "typeorm";

export type DatabaseConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl?: { rejectUnauthorized: true; ca?: string };
};

/** Validate an explicit environment target without exposing connection credentials in errors. */
export function databaseConfig(
  env: NodeJS.ProcessEnv,
  target = env.DB_ENV,
): DatabaseConfig {
  if (target !== "dev" && target !== "prod")
    throw new Error("DB_ENV must be dev or prod");
  const database = env.DB_NAME ?? `stocksbuddha_${target}`;
  if (!new RegExp(`^(?:[a-zA-Z0-9]+_)?stocksbuddha_${target}$`).test(database))
    throw new Error(
      "Database name does not match the explicit environment target",
    );
  if (!env.DB_USER || !env.DB_PASSWORD)
    throw new Error("DB_USER and DB_PASSWORD are required");
  const port = Number(env.DB_PORT ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid DB_PORT");
  if (env.DB_TLS !== undefined && !["true", "false"].includes(env.DB_TLS))
    throw new Error("DB_TLS must be true or false");
  if (target === "prod" && env.DB_TLS !== "true")
    throw new Error("Production requires verified database TLS");
  return {
    host: env.DB_HOST ?? "127.0.0.1",
    port,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database,
    ...(env.DB_TLS === "true"
      ? {
          ssl: {
            rejectUnauthorized: true as const,
            ...(env.DB_TLS_CA ? { ca: env.DB_TLS_CA } : {}),
          },
        }
      : {}),
  };
}

/** Create a bounded, non-synchronizing MariaDB connection pool; never migrate during application startup. */
export function createDatabase(
  config: DatabaseConfig,
  poolSize = 5,
  queryTimeout = 5000,
) {
  return new DataSource({
    type: "mariadb",
    ...config,
    timezone: "Z",
    charset: "utf8mb4",
    synchronize: false,
    maxQueryExecutionTime: queryTimeout || undefined,
    enableQueryTimeout: Boolean(queryTimeout),
    migrationsRun: false,
    migrationsTableName: "migrations",
    logging: false,
    poolSize,
    connectTimeout: 3000,
    supportBigNumbers: true,
    bigNumberStrings: true,
    extra: {
      connectionLimit: poolSize,
      queueLimit: 20,
      waitForConnections: false,
      multipleStatements: false,
      dateStrings: true,
    },
  });
}

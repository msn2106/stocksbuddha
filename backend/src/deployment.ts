/**
 * Resolve business-environment policy without weakening optimized-runtime protections.
 * Omitted APP_ENV preserves the existing NODE_ENV policy; explicit environments
 * must agree with the database target before any development permissions apply.
 */
export function isProductionDeployment(env: NodeJS.ProcessEnv): boolean {
  if (env.APP_ENV === undefined) return env.NODE_ENV === "production";
  if (env.APP_ENV !== "dev" && env.APP_ENV !== "production")
    throw new Error("APP_ENV must be dev or production");
  const production = env.APP_ENV === "production";
  if (env.DB_ENV !== (production ? "prod" : "dev"))
    throw new Error("APP_ENV must match DB_ENV");
  if (production && env.NODE_ENV !== "production")
    throw new Error("APP_ENV=production requires NODE_ENV=production");
  return production;
}

import type { EntityManager } from "typeorm";
import { devEnabled } from "./domain";

/** Check current KYC and paid research dates using the caller's authorization transaction. */
export async function researchEligible(
  manager: Pick<EntityManager, "query">,
  tenantId: string,
  membershipId: string,
  env: NodeJS.ProcessEnv,
  now: Date,
): Promise<boolean> {
  const [kyc] = await manager.query(
    "SELECT status FROM investor_kyc WHERE tenant_id=? AND membership_id=?",
    [tenantId, membershipId],
  );
  if (!(
    kyc?.status === "verified" ||
    (devEnabled(env) && kyc?.status === "skipped_dev")
  ))
    return false;
  const rows = await manager.query(
    "SELECT dev FROM subscription_orders WHERE tenant_id=? AND membership_id=? AND status='paid' AND starts_at<=? AND ends_at>? AND agreement_id IS NOT NULL",
    [tenantId, membershipId, now, now],
  );
  return rows.some(
    (row: { dev: number }) => env.NODE_ENV !== "production" || !row.dev,
  );
}

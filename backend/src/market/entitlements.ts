import { isProductionDeployment } from "../deployment";
import type { EntityManager } from "typeorm";
import type { ResearchOffering } from "@ra/contracts";
import { researchEligible } from "../onboarding/eligibility";
/** Freeze offering rights at quote time; later plan edits cannot alter purchased rights. */
export async function freezeResearchOfferings(
  m: Pick<EntityManager, "query">,
  tenantId: string,
  planId: string,
  orderId: string,
) {
  await m.query(
    "INSERT INTO research_order_offerings(tenant_id,order_id,offering) SELECT tenant_id,?,offering FROM research_plan_offerings WHERE tenant_id=? AND plan_id=?",
    [orderId, tenantId, planId],
  );
}
/** Compose paid/KYC eligibility with immutable offering grants; callers still authorize session and resource audience. */
export async function offeringEligible(
  m: Pick<EntityManager, "query">,
  tenantId: string,
  membershipId: string,
  offering: ResearchOffering,
  env: NodeJS.ProcessEnv,
  now: Date,
): Promise<boolean> {
  if (!(await researchEligible(m, tenantId, membershipId, env, now)))
    return false;
  const rows: { dev: number }[] = await m.query(
    "SELECT o.dev FROM subscription_orders o JOIN research_order_offerings g ON g.order_id=o.id AND g.tenant_id=o.tenant_id WHERE o.tenant_id=? AND o.membership_id=? AND g.offering=? AND o.status='paid' AND o.starts_at<=? AND o.ends_at>? AND o.agreement_id IS NOT NULL",
    [tenantId, membershipId, offering, now, now],
  );
  return rows.some((r) => !isProductionDeployment(env) || !r.dev);
}

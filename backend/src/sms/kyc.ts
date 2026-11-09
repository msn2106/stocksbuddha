import type { EntityManager } from "typeorm";
import { requireValue } from "../onboarding/domain";
import { indianMobile } from "./policy";

/** Require proof of the exact current KYC number; an old timestamp or browser flag cannot authorize checkout. */
export async function requireVerifiedMobile(
  manager: Pick<EntityManager, "query">,
  tenantId: string,
  membershipId: string,
  phone: string,
) {
  const [member] = await manager.query(
    "SELECT mobile,mobile_verified_at FROM tenant_memberships WHERE tenant_id=? AND id=?",
    [tenantId, membershipId],
  );
  let same: boolean;
  try {
    same =
      !!member?.mobile_verified_at &&
      indianMobile(member.mobile) === indianMobile(phone);
  } catch {
    same = false;
  }
  requireValue(same, "mobile_verification_required", 409);
}

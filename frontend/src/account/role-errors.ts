import type { AccountView } from "@ra/contracts";
import type { UiMessageKey } from "../locales/messages";

/** Keep role-conflict guidance identical on signup, invitation and administrator screens. */
export function roleErrorMessage(
  error: AccountView["error"],
): UiMessageKey | undefined {
  switch (error) {
    case "staff_only":
      return "org.staffOnly";
    case "subscriber_only":
      return "org.subscriberOnly";
    case "subscriber_conflict":
      return "org.subscriberConflict";
    case "staff_role_conflict":
      return "org.staffRoleConflict";
    case "membership_revoked":
      return "org.membershipRevoked";
    default:
      return undefined;
  }
}

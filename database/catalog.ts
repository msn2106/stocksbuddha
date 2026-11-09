import { DocumentStorageLeases1794182400000 } from "./migrations/1794182400000-DocumentStorageLeases";
import { InvestorOnboarding1794096000000 } from "./migrations/1794096000000-InvestorOnboarding";
import { CreateDocuments1794009600000 } from "./migrations/1794009600000-Documents";
import { CreateTenants1793491200000 } from "./migrations/1793491200000-Tenants";
import { CreateAuthUsers1793491200001 } from "./migrations/1793491200001-AuthUsers";
import { CreateAuthAccounts1793491200002 } from "./migrations/1793491200002-AuthAccounts";
import { CreateAuthSessions1793491200003 } from "./migrations/1793491200003-AuthSessions";
import { CreateAuthVerifications1793491200004 } from "./migrations/1793491200004-AuthVerifications";
import { CreateMemberships1793491200005 } from "./migrations/1793491200005-Memberships";
import { CreateWebsites1793491200006 } from "./migrations/1793491200006-Websites";
import { CreateAudit1793491200007 } from "./migrations/1793491200007-Audit";
import { AddPublication1793491200008 } from "./migrations/1793491200008-Publication";
import { AddAuthTenantContext1793491200009 } from "./migrations/1793491200009-AuthTenantContext";
import { CreateAuthRateLimits1793491200010 } from "./migrations/1793491200010-AuthRateLimits";

import { CreateOrganisationInvitations1793491200011 } from "./migrations/1793491200011-OrganisationInvitations";

import { AddInvitationNames1793491200012 } from "./migrations/1793491200012-InvitationNames";

/** Ordered immutable migrations shared by development and compiled release runners. */
export const migrationClasses = [
  CreateTenants1793491200000,
  CreateAuthUsers1793491200001,
  CreateAuthAccounts1793491200002,
  CreateAuthSessions1793491200003,
  CreateAuthVerifications1793491200004,
  CreateMemberships1793491200005,
  CreateWebsites1793491200006,
  CreateAudit1793491200007,
  AddPublication1793491200008,
  AddAuthTenantContext1793491200009,
  CreateAuthRateLimits1793491200010,
  CreateOrganisationInvitations1793491200011,
  AddInvitationNames1793491200012,
  CreateDocuments1794009600000,
  InvestorOnboarding1794096000000,
  DocumentStorageLeases1794182400000,
];

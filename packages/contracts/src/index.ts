import type { Locale } from "./locales";
import type { Tenant } from "./tenancy";
import type { PublicWebsite } from "./website";
export { supportedLocales, resolveLocale, type Locale } from "./locales";
export {
  reservedSlugs,
  slugSchema,
  tenantSchema,
  type Tenant,
} from "./tenancy";
export {
  websiteRevisionSchema,
  sectionIds,
  requiredSections,
  type WebsiteRevision,
  type PublicWebsite,
  type WebsiteSection,
} from "./website";
export {
  websiteContentKeys,
  editableWebsiteContentKeys,
  optionalWebsiteContentKeys,
  type WebsiteContent,
  type WebsiteContentKey,
} from "./content";

export type PageData = {
  tenant: Tenant | null;
  website: PublicWebsite | null;
  page: "landing" | "not-found" | "account" | "platform";
  /** Explicit production opt-in applies only to the platform homepage. */
  indexable?: boolean;
  platformAccessError?: boolean;
  locale: Locale;
  preview?: boolean;
  account?: AccountView;
};
export type AccountView = {
  mode:
    | "login"
    | "signup"
    | "workspace"
    | "workspaces"
    | "unavailable"
    | "verify-email"
    | "forgot-password"
    | "reset-password"
    | "join"
    | "invitation";
  audience?: "investor" | "organisation" | "platform";
  area?: "investor" | "organisation" | "platform";
  section?:
    | "overview"
    | "organisations"
    | "team"
    | "website"
    | "documents"
    | "plans"
    | "users"
    | "onboarding";
  onboardingEnabled?: boolean;
  customerId?: string;
  profile?: { name: string; email: string; emailVerified: boolean };
  organisations?: {
    id: string;
    slug: string;
    name: string;
    status: string;
    administrators: number;
  }[];
  invitations?: {
    id: string;
    email: string;
    role: string;
    full_name?: string | null;
    delivery_status: string;
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
  }[];
  members?: {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    canRevoke: boolean;
  }[];
  autoAcceptInvitation?: boolean;
  invitationIdentity?: "different" | "unverified";
  invitedEmail?: string;
  invitedRole?: string;
  signedIn?: boolean;
  notice?: "sent" | "reset" | "invited" | "revoked";
  error?:
    | "credentials"
    | "service"
    | "access"
    | "invitation"
    | "throttled"
    | "account_exists"
    | "staff_only"
    | "subscriber_only"
    | "subscriber_conflict"
    | "staff_role_conflict"
    | "membership_revoked";
  email?: string;
  name?: string;
  role?: string;
  capabilities?: readonly string[];
  workspaces?: { slug: string; name: string; role: string }[];
};
/**
 * Serialize the resolved page projection for embedding in an application/json script.
 * Less-than signs and Unicode line separators are escaped so tenant text cannot
 * terminate the script element. This does not validate data or escape HTML attributes.
 * @param data - Resolved page data; public callers exclude private records and account callers include only the current authorized view.
 * @returns JSON text that can be read back with JSON.parse without losing content.
 */
export function serializePage(data: PageData): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export {
  websiteSnapshotSchema,
  publicProfileSchema,
  type Snapshot,
  type WebsiteEditorState,
} from "./editor";

export type {
  Plan,
  Coupon,
  KycProfile,
  KycView,
  AgreementSettings,
  OrderView,
  OnboardingView,
} from "./onboarding";

export { sampleResearchAgreement } from "./agreement-sample";
export { logoSchema, type BrandLogos } from "./branding";
export type { LetterheadSettings, LetterheadMargins } from "./letterhead";

export type { SignatureMark, SignatureBox } from "./signature";

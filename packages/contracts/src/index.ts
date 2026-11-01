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
  type WebsiteContent,
  type WebsiteContentKey,
} from "./content";

export type PageData = {
  tenant: Tenant | null;
  website: PublicWebsite | null;
  page: "landing" | "not-found" | "account";
  locale: Locale;
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
    | "join";
  notice?: "sent" | "reset";
  error?: "credentials" | "service";
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

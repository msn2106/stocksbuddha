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
  page: "landing" | "not-found";
  locale: Locale;
};
/**
 * Serialize the public page projection for embedding in an application/json script.
 * Less-than signs and Unicode line separators are escaped so tenant text cannot
 * terminate the script element. This does not validate data or escape HTML attributes.
 * @param data - Public page data; callers must exclude private or other-tenant records.
 * @returns JSON text that can be read back with JSON.parse without losing content.
 */
export function serializePage(data: PageData): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

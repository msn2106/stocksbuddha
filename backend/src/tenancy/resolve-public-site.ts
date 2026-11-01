import {
  slugSchema,
  supportedLocales,
  type Locale,
  type PageData,
} from "@ra/contracts";
import type { TenantRepository, WebsiteRepository } from "./repository";
import { monitorTenant } from "../monitoring";

/**
 * Build the language-preference cookie name for an immutable tenant identity.
 * @param tenantId - Server-resolved tenant ID; this does not set cookie path or security attributes.
 * @returns A name that keeps tenant language preferences independent.
 */
export function languageCookieName(tenantId: string) {
  return `ra-language-${tenantId}`;
}
/**
 * Create a request-scoped resolver for active tenants and their published website content.
 * The returned function accepts a public pathname, optional language query value and
 * raw Cookie header. An explicit query value takes precedence over that tenant's
 * cookie; unsupported or disabled values use the website's default language.
 * Only the selected language is exposed. Invalid routes, inactive tenants and
 * inconsistent/unpublished adapter results resolve to a not-found page.
 * @param tenants - Tenant adapter used for exact slug lookup.
 * @param websites - Website adapter queried with the resolved immutable tenant ID.
 * @returns An async page resolver; adapter rejections propagate to the caller.
 */
export function createPublicSiteResolver(
  tenants: TenantRepository,
  websites: WebsiteRepository,
) {
  return async (
    pathname: string,
    requestedLocale?: unknown,
    cookies = "",
  ): Promise<PageData> => {
    const fallback = supportedLocales.includes(requestedLocale as Locale)
      ? (requestedLocale as Locale)
      : "en";
    const missing: PageData = {
      tenant: null,
      website: null,
      page: "not-found",
      locale: fallback,
    };
    const match = /^\/ra\/([^/]+)\/?$/.exec(pathname);
    if (!match || !slugSchema.safeParse(match[1]).success) return missing;
    const tenant = await tenants.findBySlug(match[1]);
    if (!tenant || tenant.slug !== match[1] || tenant.status !== "active")
      return missing;
    monitorTenant(tenant.id);
    const website = await websites.findPublished(tenant.id);
    // Check adapter output too: a bad query must fail closed rather than leak a
    // different organization's website or an unpublished revision.
    if (
      !website ||
      website.tenantId !== tenant.id ||
      website.status !== "published" ||
      !website.publishedAt
    )
      return missing;
    const cookie = cookies
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${languageCookieName(tenant.id)}=`))
      ?.split("=")[1];
    const requested = requestedLocale ?? cookie;
    const locale = website.languages.enabled.includes(requested as Locale)
      ? (requested as Locale)
      : website.languages.default;
    const content = website.content[locale];
    if (!content) return missing;
    return {
      tenant: website.publicProfile
        ? {
            ...tenant,
            profile: {
              name: website.publicProfile.name,
              legalName: website.publicProfile.legalName,
              registration: website.publicProfile.registration,
              monogram: website.publicProfile.monogram,
            },
          }
        : tenant,
      website: {
        tenantId: website.tenantId,
        revision: website.revision,
        publishedAt: website.publishedAt,
        branding: website.branding,
        languages: website.languages,
        layout: website.layout,
        content,
      },
      page: "landing",
      locale,
    };
  };
}

import { createContext, useContext, type ReactNode } from "react";
import type { BrandLogos, Locale, PublicWebsite, Tenant } from "@ra/contracts";
import { translator } from "./locales/messages";

const LanguageContext = createContext({
  locale: "en" as Locale,
  enabledLocales: ["en", "hi"] as readonly Locale[],
  tenantId: null as string | null,
  tenantPath: "/" as string,
  t: translator("en"),
  logos: {} as BrandLogos,
});
/**
 * Provide the selected locale, tenant paths, enabled languages and scoped translator.
 * @param props - Resolved locale, optional tenant/website projection and child content.
 * Missing tenant data uses root navigation and both platform languages for error pages.
 * @returns A context provider; content is never fetched or borrowed from another tenant.
 */
export function LanguageProvider({
  locale,
  tenant,
  website,
  children,
}: {
  locale: Locale;
  tenant: Tenant | null;
  website: PublicWebsite | null;
  children: ReactNode;
}) {
  return (
    <LanguageContext.Provider
      value={{
        locale,
        enabledLocales: website?.languages.enabled ?? ["en", "hi"],
        tenantId: tenant?.id ?? null,
        tenantPath: tenant ? `/ra/${tenant.slug}` : "/",
        t: translator(locale, website?.content),
        logos: website?.branding ?? {},
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}
/**
 * Read the nearest page language context, or its English/root defaults without a provider.
 * @returns The locale, tenant navigation details, enabled locales and scoped translator.
 */
export const useLanguage = () => useContext(LanguageContext);

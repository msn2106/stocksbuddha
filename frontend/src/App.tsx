import type { PageData } from "@ra/contracts";
import { LanguageProvider } from "./i18n";
import { PublicWebsite } from "./websites/PublicWebsite";

/**
 * Bind a server-resolved page to its language context and public website renderer.
 * @param props - Page data shared by server rendering and client hydration.
 * @returns The public page, including its not-found state when no tenant is resolved.
 */
export function App({ data }: { data: PageData }) {
  return (
    <LanguageProvider
      locale={data.locale}
      tenant={data.tenant}
      website={data.website}
    >
      <PublicWebsite data={data} />
    </LanguageProvider>
  );
}

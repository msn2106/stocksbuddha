import type { PageData } from "@ra/contracts";
import { LanguageProvider } from "./i18n";
import { PublicWebsite } from "./websites/PublicWebsite";
import { PlatformWebsite } from "./platform/PlatformWebsite";
import { AccountPage } from "./account/AccountPage";

/**
 * Bind a server-resolved public or account page to its language context and renderer.
 * @param props - Page data shared by server rendering and client hydration.
 * @returns The public website, account form or authorized workspace view for this request.
 */
export function App({ data }: { data: PageData }) {
  return (
    <LanguageProvider
      locale={data.locale}
      tenant={data.tenant}
      website={data.website}
    >
      {data.page === "platform" ? (
        <PlatformWebsite data={data} />
      ) : data.page === "account" ? (
        <AccountPage data={data} />
      ) : (
        <PublicWebsite data={data} />
      )}
    </LanguageProvider>
  );
}

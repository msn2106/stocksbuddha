import { renderToString } from "react-dom/server";
import { App } from "./App";
import { serializePage, type PageData } from "@ra/contracts";
import { translator } from "./locales/messages";

/**
 * Escape text for HTML metadata text nodes and quoted attribute values.
 * @param value - Plain text; this helper is not a JavaScript, URL or CSS encoder.
 * @returns Text with ampersands, angle brackets and quotes replaced by HTML entities.
 */
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
/**
 * Render one resolved page and its metadata/bootstrap fragments for the HTML template.
 * @param data - Validated tenant, selected-language website projection and page state.
 * @returns Language, React HTML, escaped metadata and script-safe hydration JSON.
 * @throws {Error} If required translation content is missing or React rendering fails.
 */
export function render(data: PageData) {
  const t = translator(data.locale, data.website?.content);
  const title = data.account
    ? `${t(`auth.${data.account.mode}.title`)} | ${data.tenant?.profile.name ?? t("auth.platform")}`
    : data.tenant
      ? `${data.tenant.profile.name} | ${t("metadata.research")}`
      : t("metadata.notFoundTitle");
  const description = data.account
    ? t("auth.story.body", {
        tenant: data.tenant?.profile.name ?? t("auth.platform"),
      })
    : data.tenant
      ? data.website!.content["site.description"]
      : t("metadata.notFoundDescription");
  return {
    lang: data.locale,
    html: renderToString(<App data={data} />),
    head: `<title>${escape(title)}</title><meta name="description" content="${escape(description)}"/><meta name="robots" content="noindex,nofollow"/><meta name="theme-color" content="${data.website?.branding.accent ?? "#244b3b"}"/><meta property="og:title" content="${escape(title)}"/><meta property="og:description" content="${escape(description)}"/><meta property="og:type" content="website"/>`,
    data: `<script id="page-data" type="application/json">${serializePage(data)}</script>`,
  };
}

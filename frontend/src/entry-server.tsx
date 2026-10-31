import { renderToString } from "react-dom/server";
import { App } from "./App";
import { serializePage, type PageData } from "@ra/contracts";
import { translator, tenantContent } from "./locales/messages";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export function render(data: PageData) {
  const t = translator(data.locale ?? "en");
  const title = data.tenant
    ? `${data.tenant.profile.name} | ${t("metadata.research")}`
    : t("metadata.notFoundTitle");
  const description = data.tenant
    ? tenantContent(data.tenant, t).description
    : t("metadata.notFoundDescription");
  return {
    lang: data.locale ?? "en",
    html: renderToString(<App data={data} />),
    head: `<title>${escape(title)}</title><meta name="description" content="${escape(description)}"/><meta name="robots" content="noindex,nofollow"/><meta name="theme-color" content="${data.tenant?.published.accent ?? "#244b3b"}"/><meta property="og:title" content="${escape(title)}"/><meta property="og:description" content="${escape(description)}"/><meta property="og:type" content="website"/>`,
    data: `<script id="page-data" type="application/json">${serializePage(data)}</script>`,
  };
}

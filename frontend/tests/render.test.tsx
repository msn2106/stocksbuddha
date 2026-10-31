import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "../src/entry-server";
import { useLanguage } from "../src/i18n";
import { makePage } from "../../packages/contracts/tests/fixtures";

test("SSR escapes metadata and hydration data while retaining selected tenant content and locale", () => {
  const data = makePage("hi");
  data.tenant!.profile.name = `A & <B> "quoted" 'name'`;
  data.website!.content["site.description"] = `Description </script> & "text"`;
  data.website!.content["site.hero"] = "</script><script>alert(1)</script>";
  const result = render(data);
  assert.equal(result.lang, "hi");
  assert.match(
    result.head,
    /A &amp; &lt;B&gt; &quot;quoted&quot; &#39;name&#39;/,
  );
  assert.match(
    result.head,
    /Description &lt;\/script&gt; &amp; &quot;text&quot;/,
  );
  assert.ok(result.html.includes("&lt;script&gt;"));
  const json = result.data
    .replace(/^<script[^>]*>/, "")
    .replace(/<\/script>$/, "");
  assert.deepEqual(JSON.parse(json), data);
  assert.equal(json.includes("</script>"), false);
});

test("SSR renders unavailable pages without a website, and language hooks have explicit defaults", () => {
  const result = render({
    tenant: null,
    website: null,
    page: "not-found",
    locale: "en",
  });
  assert.match(result.head, /noindex,nofollow/);
  assert.match(result.html, /Visit Stocks Buddha/);
  function Defaults() {
    const { locale, tenantId, tenantPath, enabledLocales } = useLanguage();
    return (
      <span>
        {JSON.stringify({ locale, tenantId, tenantPath, enabledLocales })}
      </span>
    );
  }
  assert.match(renderToStaticMarkup(<Defaults />), /&quot;tenantId&quot;:null/);
});

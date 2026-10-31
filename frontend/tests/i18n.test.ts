import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogues, translator, localeOptions } from "../src/locales/messages";
import { supportedLocales, resolveLocale } from "@ra/contracts/locales";
import type { WebsiteContent } from "@ra/contracts";
const placeholders = (text: string) =>
  [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

test("shared UI catalogues have parallel stable keys and placeholders", () => {
  for (const locale of supportedLocales) {
    assert.deepEqual(
      Object.keys(catalogues[locale]).sort(),
      Object.keys(catalogues.en).sort(),
    );
    for (const key of Object.keys(
      catalogues.en,
    ) as (keyof typeof catalogues.en)[]) {
      assert.match(key, /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/);
      assert.ok(catalogues[locale][key].trim());
      assert.deepEqual(
        placeholders(catalogues[locale][key]),
        placeholders(catalogues.en[key]),
      );
    }
    assert.equal(
      Object.keys(catalogues[locale]).some(
        (key) => key.startsWith("tenants.") || key.startsWith("about."),
      ),
      false,
    );
  }
});
test("UI wording changes independently of translations", () => {
  const original = catalogues.en["nav.subscribe"];
  try {
    catalogues.en["nav.subscribe"] = "Join the research";
    assert.equal(translator("en")("nav.subscribe"), "Join the research");
    assert.equal(translator("hi")("nav.subscribe"), "सदस्यता लें");
  } finally {
    catalogues.en["nav.subscribe"] = original;
  }
});
test("each render uses its supplied tenant content, with literal values and interpolation", () => {
  const alpha = { "site.hero": "Alpha {name}" } as WebsiteContent;
  const beta = { "site.hero": "Beta {name}" } as WebsiteContent;
  const a = translator("hi", alpha),
    b = translator("hi", beta);
  const name = "Example {name} $& <company>";
  assert.equal(a("site.hero", { name }), `Alpha ${name}`);
  assert.equal(b("site.hero", { name }), `Beta ${name}`);
  assert.equal(a("site.hero", { name }), `Alpha ${name}`);
  assert.throws(() => a("site.hero"), /Missing placeholder/);
  assert.equal(
    translator("hi", { "site.hero": "nav.subscribe" } as WebsiteContent)(
      "site.hero",
    ),
    "nav.subscribe",
  );
});
test("tenant content cannot override shared controls or fall back to another site", () => {
  const content = {
    "nav.subscribe": "Forged control",
  } as unknown as WebsiteContent;
  assert.equal(translator("en", content)("nav.subscribe"), "Subscribe");
  assert.throws(() => translator("en")("site.hero"), /missing website content/);
  assert.throws(() => {
    // @ts-expect-error English sentences are not keys.
    translator("en")("Subscribe");
  }, /Unknown translation key/);
});
test("only registered platform languages have switcher labels", () => {
  assert.deepEqual(supportedLocales, ["en", "hi"]);
  assert.deepEqual(
    localeOptions.map((v) => v.code),
    supportedLocales,
  );
  for (const option of localeOptions)
    assert.ok(translator("en")(option.labelKey));
  for (const value of ["kn", "gu", "mr", ["hi"], undefined])
    assert.equal(resolveLocale(value), "en");
});

test("server-rendered language controls show only a tenant's enabled languages", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { LanguageProvider } = await import("../src/i18n");
  const { AccessibilityControls } =
    await import("../src/components/AccessibilityControls");
  const { websiteContentKeys } = await import("@ra/contracts");
  const tenant = {
    id: "a1b87125-42b7-4d6d-8715-78721c436a82",
    slug: "example",
    status: "active" as const,
    synthetic: true,
    profile: {
      name: "Example",
      legalName: "Example",
      registration: null,
      monogram: "ex",
    },
  };
  const website = {
    tenantId: tenant.id,
    revision: 1,
    publishedAt: "2026-10-31T00:00:00.000Z",
    branding: {
      accent: "#244b3b",
      surface: "#e8eee5",
      font: "classic" as const,
    },
    languages: { default: "hi" as const, enabled: ["hi" as const] },
    layout: { template: "classic" as const, sections: [] },
    content: Object.fromEntries(
      websiteContentKeys.map((key) => [key, key]),
    ) as WebsiteContent,
  };
  const html = renderToStaticMarkup(
    createElement(LanguageProvider, {
      locale: "hi",
      tenant,
      website,
      children: createElement(AccessibilityControls),
    }),
  );
  assert.ok(html.includes('href="?lang=hi"'));
  assert.equal(html.includes('href="?lang=en"'), false);
});

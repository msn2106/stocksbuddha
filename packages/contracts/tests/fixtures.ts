import {
  tenantSchema,
  websiteRevisionSchema,
  websiteContentKeys,
  type PageData,
} from "../src/index";

/** Construct a schema-valid tenant fixture without importing application adapters or production seed content. */
export function makeTenant() {
  return tenantSchema.parse({
    id: "a1b87125-42b7-4d6d-8715-78721c436a82",
    slug: "example",
    status: "active",
    synthetic: true,
    profile: {
      name: "Example Research",
      legalName: "Example Organization",
      registration: null,
      monogram: "ex",
    },
  });
}

/** Construct a complete bilingual published revision with independent content dictionaries. */
export function makeWebsite() {
  const content = Object.fromEntries(
    websiteContentKeys.map((key) => [key, `Example ${key}`]),
  );
  return websiteRevisionSchema.parse({
    tenantId: makeTenant().id,
    revision: 1,
    status: "published",
    publishedAt: "2026-10-31T00:00:00.000Z",
    branding: { accent: "#244b3b", surface: "#e8eee5", font: "classic" },
    languages: { default: "en", enabled: ["en", "hi"] },
    layout: {
      template: "classic",
      sections: [
        "hero",
        "principles",
        "research",
        "approach",
        "about",
        "expectations",
        "plans",
        "faq",
        "investor",
      ],
    },
    content: { en: { ...content }, hi: { ...content } },
  });
}

/** Create the selected-language projection used by component, renderer and HTTP boundary tests. */
export function makePage(locale: "en" | "hi" = "en"): PageData {
  const { status, content, publishedAt, ...website } = makeWebsite();
  void status;
  return {
    tenant: makeTenant(),
    page: "landing",
    locale,
    website: {
      ...website,
      publishedAt: publishedAt!,
      content: content[locale]!,
    },
  };
}

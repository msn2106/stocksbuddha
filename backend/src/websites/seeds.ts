import {
  websiteRevisionSchema,
  sectionIds,
  type WebsiteRevision,
} from "@ra/contracts";
import stocksEn from "./seeds/stocksbuddha/en.json";
import stocksHi from "./seeds/stocksbuddha/hi.json";
import alphaEn from "./seeds/alpha/en.json";
import alphaHi from "./seeds/alpha/hi.json";
import betaEn from "./seeds/beta/en.json";
import betaHi from "./seeds/beta/hi.json";

export const websites: readonly WebsiteRevision[] = [
  {
    tenantId: "a1b87125-42b7-4d6d-8715-78721c436a82",
    revision: 1,
    status: "published",
    publishedAt: "2026-10-31T00:00:00.000Z",
    branding: { accent: "#244b3b", surface: "#e8eee5", font: "classic" },
    languages: { default: "en", enabled: ["en", "hi"] },
    layout: { template: "classic", sections: [...sectionIds] },
    content: { en: stocksEn, hi: stocksHi },
  },
  {
    tenantId: "aba574d1-3eea-4547-8295-3bf8d22c6281",
    revision: 1,
    status: "published",
    publishedAt: "2026-10-31T00:00:00.000Z",
    branding: { accent: "#244b3b", surface: "#e8eee5", font: "classic" },
    languages: { default: "en", enabled: ["en", "hi"] },
    layout: { template: "classic", sections: [...sectionIds] },
    content: { en: alphaEn, hi: alphaHi },
  },
  {
    tenantId: "dab574d1-3eea-4547-8295-3bf8d22c6282",
    revision: 1,
    status: "published",
    publishedAt: "2026-10-31T00:00:00.000Z",
    branding: { accent: "#334c73", surface: "#e7edf5", font: "sans" },
    languages: { default: "en", enabled: ["en", "hi"] },
    layout: {
      template: "editorial",
      sections: [
        "hero",
        "about",
        "research",
        "approach",
        "expectations",
        "plans",
        "faq",
        "investor",
      ],
    },
    content: { en: betaEn, hi: betaHi },
  },
].map((site) => websiteRevisionSchema.parse(site));

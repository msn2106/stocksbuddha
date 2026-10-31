import { z } from "zod";
import { supportedLocales } from "./locales";
import { websiteContentKeys } from "./content";

const localeSchema = z.enum(supportedLocales);
const contentSchema = z.record(
  z.enum(websiteContentKeys),
  z.string().trim().min(1).max(3000),
);
export const sectionIds = [
  "hero",
  "principles",
  "research",
  "approach",
  "about",
  "expectations",
  "plans",
  "faq",
  "investor",
] as const;
export type WebsiteSection = (typeof sectionIds)[number];
export const requiredSections: readonly WebsiteSection[] = [
  "hero",
  "research",
  "approach",
  "about",
  "expectations",
  "plans",
  "investor",
];
export const websiteRevisionSchema = z
  .object({
    tenantId: z.string().uuid(),
    revision: z.number().int().positive(),
    status: z.enum(["draft", "published"]),
    publishedAt: z.string().datetime().nullable(),
    branding: z
      .object({
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        surface: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        font: z.enum(["classic", "sans"]),
      })
      .strict(),
    languages: z
      .object({
        default: localeSchema,
        enabled: z
          .array(localeSchema)
          .min(1)
          .refine((v) => new Set(v).size === v.length, "Duplicate languages"),
      })
      .strict(),
    layout: z
      .object({
        template: z.enum(["classic", "editorial"]),
        sections: z
          .array(z.enum(sectionIds))
          .min(1)
          .refine((v) => new Set(v).size === v.length, "Duplicate sections")
          .refine(
            (v) => requiredSections.every((s) => v.includes(s)),
            "Required sections missing",
          )
          .refine((v) => v[0] === "hero", "Hero must be first"),
      })
      .strict(),
    content: z
      .object({ en: contentSchema.optional(), hi: contentSchema.optional() })
      .strict(),
  })
  .strict()
  .superRefine((site, ctx) => {
    if (!site.languages.enabled.includes(site.languages.default))
      ctx.addIssue({
        code: "custom",
        message: "Default language must be enabled",
      });
    for (const language of supportedLocales) {
      if (
        site.languages.enabled.includes(language) !==
        Boolean(site.content[language])
      )
        ctx.addIssue({
          code: "custom",
          message: `Enabled languages must have complete content: ${language}`,
        });
    }
    if (site.status === "published" && !site.publishedAt)
      ctx.addIssue({
        code: "custom",
        message: "Published revisions require a publication date",
      });
    /**
     * Build an order-independent signature of unique named interpolation placeholders.
     * @param value - A translated field whose placeholder names must match its default-language value.
     * @returns Sorted names joined by commas; repeated occurrences do not change the signature.
     */
    const placeholders = (value: string) =>
      [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))]
        .sort()
        .join(",");
    for (const key of websiteContentKeys) {
      const base = site.content[site.languages.default]?.[key];
      for (const locale of site.languages.enabled) {
        const value = site.content[locale]?.[key];
        if (base && value && placeholders(base) !== placeholders(value))
          ctx.addIssue({
            code: "custom",
            message: `Translation placeholders differ: ${locale}:${key}`,
          });
      }
    }
  });
export type WebsiteRevision = z.infer<typeof websiteRevisionSchema>;
// Public rendering receives exactly one published revision and one language.
export type PublicWebsite = Pick<
  WebsiteRevision,
  "tenantId" | "revision" | "branding" | "languages" | "layout"
> & {
  publishedAt: string;
  content: import("./content").WebsiteContent;
};

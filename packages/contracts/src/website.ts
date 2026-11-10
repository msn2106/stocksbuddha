import { z } from "zod";
import { logoSchema } from "./branding";
import { supportedLocales } from "./locales";
import {
  websiteContentKeys,
  editableWebsiteContentKeys,
  type WebsiteContent,
} from "./content";

const localeSchema = z.enum(supportedLocales);
const contentSchema = z
  .partialRecord(
    z.enum(editableWebsiteContentKeys),
    z.string().trim().min(1).max(3000),
  )
  .superRefine((content, ctx) => {
    for (const key of websiteContentKeys)
      if (!content[key])
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Required content",
        });
  })
  .transform((content) => content as WebsiteContent);
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
        logoLight: logoSchema.nullable().optional(),
        logoDark: logoSchema.nullable().optional(),
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
        footer: z.enum(["columns", "compact"]).optional(),
        navigation: z
          .array(
            z
              .object({
                section: z.enum(sectionIds),
                label: z
                  .object({
                    en: z.string().trim().min(1).max(60),
                    hi: z.string().trim().min(1).max(60),
                  })
                  .strict(),
              })
              .strict(),
          )
          .max(9)
          .refine(
            (v) => new Set(v.map((n) => n.section)).size === v.length,
            "Duplicate navigation items",
          )
          .optional(),
        sectionStyles: z
          .partialRecord(
            z.enum(sectionIds),
            z.enum(["default", "stacked", "reversed"]),
          )
          .optional(),
        images: z
          .partialRecord(
            z.enum(sectionIds),
            z
              .object({
                src: z
                  .url()
                  .max(2048)
                  .refine((value) => {
                    const url = new URL(value);
                    return (
                      url.protocol === "https:" &&
                      !url.username &&
                      !url.password
                    );
                  }, "Use an HTTPS image URL"),
                alt: z
                  .object({
                    en: z.string().trim().min(1).max(200),
                    hi: z.string().trim().min(1).max(200),
                  })
                  .strict(),
              })
              .strict(),
          )
          .optional(),
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
    for (const item of site.layout.navigation ?? []) {
      if (!site.layout.sections.includes(item.section))
        ctx.addIssue({
          code: "custom",
          message: "Navigation must link to an enabled section",
        });
    }
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
    for (const key of editableWebsiteContentKeys) {
      for (const locale of site.languages.enabled) {
        const value = site.content[locale]?.[key];
        if (
          value &&
          [...value.matchAll(/\{(\w+)\}/g)].some(
            (match) =>
              match[1] !== "name" ||
              !["about.belief", "about.analystIntroduction"].includes(key),
          )
        )
          ctx.addIssue({
            code: "custom",
            path: ["content", locale, key],
            message: "Unsupported placeholder",
          });
      }
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
  contact?: { email?: string | null; phone?: string | null };
  content: import("./content").WebsiteContent;
};

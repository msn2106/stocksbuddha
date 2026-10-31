import { z } from "zod";
import type { Locale } from "./locales";
export { supportedLocales, resolveLocale, type Locale } from "./locales";

export const reservedSlugs = new Set([
  "admin",
  "api",
  "auth",
  "login",
  "settings",
  "www",
]);
export const slugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,47}$/)
  .refine((slug) => !reservedSlugs.has(slug));

// Fixed content only: React escapes strings, and no tenant HTML is executed.
export const tenantSchema = z.object({
  id: z.string().uuid(),
  slug: slugSchema,
  status: z.enum(["draft", "active", "suspended", "closed"]),
  synthetic: z.boolean(),
  profile: z.object({
    name: z.string().min(2).max(80),
    legalName: z.string().min(2).max(100),
    registration: z.string().max(40).nullable(),
    monogram: z.string().min(1).max(3),
    description: z.string().min(10).max(300),
  }),
  published: z.object({
    revision: z.number().int().positive(),
    publishedAt: z.string().datetime(),
    hero: z.string().min(10).max(120),
    introduction: z.string().min(10).max(350),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    surface: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
});
export type Tenant = z.infer<typeof tenantSchema>;

export type PageData = {
  tenant: Tenant | null;
  page: "landing" | "not-found";
  locale?: Locale;
};

export function serializePage(data: PageData): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

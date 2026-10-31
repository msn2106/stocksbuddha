import { z } from "zod";

export const reservedSlugs = new Set([
  "admin",
  "api",
  "auth",
  "login",
  "settings",
  "www",
  "platform",
  "dev",
]);
export const slugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,47}$/)
  .refine((slug) => !reservedSlugs.has(slug));
export const tenantSchema = z
  .object({
    id: z.string().uuid(),
    slug: slugSchema,
    status: z.enum(["draft", "active", "suspended", "closed"]),
    synthetic: z.boolean(),
    profile: z
      .object({
        name: z.string().min(2).max(80),
        legalName: z.string().min(2).max(100),
        registration: z.string().max(40).nullable(),
        monogram: z.string().min(1).max(3),
      })
      .strict(),
  })
  .strict();
export type Tenant = z.infer<typeof tenantSchema>;

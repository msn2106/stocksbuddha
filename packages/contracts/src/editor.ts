import { z } from "zod";
import { tenantSchema } from "./tenancy";
import { websiteRevisionSchema } from "./website";
import { editableWebsiteContentKeys } from "./content";

export const publicProfileSchema = tenantSchema.shape.profile
  .extend({
    contactEmail: z.string().email().max(254).nullable().optional(),
    contactPhone: z
      .string()
      .regex(/^\+[1-9]\d{1,14}$/)
      .nullable()
      .optional(),
  })
  .strict();
export const websiteSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    publicProfile: publicProfileSchema.partial(),
    branding: websiteRevisionSchema.shape.branding.partial(),
    languages: websiteRevisionSchema.shape.languages,
    layout: websiteRevisionSchema.shape.layout.partial(),
    content: z
      .object({
        en: z
          .partialRecord(
            z.enum(editableWebsiteContentKeys),
            z.string().max(3000),
          )
          .optional(),
        hi: z
          .partialRecord(
            z.enum(editableWebsiteContentKeys),
            z.string().max(3000),
          )
          .optional(),
      })
      .strict(),
  })
  .strict();
export type Snapshot = z.infer<typeof websiteSnapshotSchema>;

export type WebsiteEditorState = {
  id: string | null;
  revision: number;
  version: number;
  snapshot: Snapshot;
};

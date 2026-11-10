import { z } from "zod";

/** Normalized raster logos travel with their immutable website revision, never as remote URLs. */
export const logoSchema = z
  .string()
  .max(131094)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
export type BrandLogos = {
  logoLight?: string | null;
  logoDark?: string | null;
};

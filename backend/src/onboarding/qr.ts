import { z } from "zod";
import { requireValue } from "./domain";
import { validateDocument } from "../documents/policy";

export const qrSettingsSchema = z
  .object({
    version: z.number().int().min(0),
    enabled: z.boolean(),
    payee: z.string().trim().min(2).max(160),
    upiId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{2,128}@[A-Za-z0-9.-]{2,64}$/),
    instructions: z.string().trim().max(1000),
    image: z.string().max(1500000).optional(),
    removeImage: z.boolean().optional(),
  })
  .strict();
export type QrSettings = {
  enabled: boolean;
  payee: string;
  upiId: string;
  instructions: string;
  image: string;
};
export const qrSubmissionSchema = z
  .object({
    orderId: z.string().uuid(),
    reference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{6,40}$/)
      .transform((value) => value.toUpperCase()),
    paidAt: z.string().datetime(),
    proof: z.string().max(2900000),
  })
  .strict();
export const qrReviewSchema = z
  .object({
    orderId: z.string().uuid(),
    version: z.number().int().min(1),
    approve: z.boolean(),
    reason: z.string().trim().min(5).max(1000),
    fundsChecked: z.literal(true),
  })
  .strict();

/** Bound raster-only QR images and attachment-only payment evidence before encrypting bytes. */
export function qrFile(value: string, proof = false) {
  const match =
    /^data:(image\/png|image\/jpeg|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  requireValue(
    match && (proof || match[1] !== "application/pdf"),
    "invalid_payment_file",
    422,
  );
  const bytes = Buffer.from(match[2], "base64");
  requireValue(
    bytes.length <= (proof ? 2 : 1) * 1024 * 1024 &&
      bytes.toString("base64") === match[2],
    "invalid_payment_file",
    422,
  );
  const mime = match[1],
    extension =
      mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "pdf";
  try {
    validateDocument(`payment.${extension}`, mime, bytes);
  } catch {
    requireValue(false, "invalid_payment_file", 422);
  }
  return { bytes, mime, name: `payment.${extension}` };
}

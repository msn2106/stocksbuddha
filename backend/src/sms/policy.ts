import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Stable failures never contain phone numbers, credentials, messages or provider responses. */
export class SmsError extends Error {
  /** Carry a safe HTTP status and optional retry delay. */
  constructor(
    readonly code: string,
    readonly status = 400,
    readonly retryAfter?: number,
  ) {
    super(code);
  }
}
/** Restrict this vendor integration to Indian mobiles; never silently truncate foreign numbers. */
export function indianMobile(input: unknown): string {
  if (typeof input !== "string") throw new SmsError("invalid_mobile");
  const value = input.replace(/[\s()-]/g, "");
  const local = value.replace(/^(?:\+91|91)(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(local)) throw new SmsError("invalid_mobile");
  return `+91${local}`;
}
const template = z
  .object({
    id: z.string().regex(/^\d{10,25}$/),
    text: z
      .string()
      .min(10)
      .max(441)
      .refine(
        (value) =>
          value.includes("{{otp}}") &&
          !/\{\{(?!otp\}\}|expiryMinutes\}\})/.test(value),
        "Use only {{otp}} and {{expiryMinutes}} placeholders",
      ),
  })
  .strict();
const templateEntry = z
  .object({
    key: z.string().regex(/^[a-z0-9-]{1,64}$/),
    name: z.string().trim().min(1).max(80),
    id: z
      .string()
      .max(25)
      .refine((value) => !value || /^\d{10,25}$/.test(value)),
    text: z.string().max(441),
  })
  .strict();
export type SmsTemplateEntry = z.infer<typeof templateEntry>;
export const smsSettingsSchema = z
  .object({
    version: z.number().int().min(0),
    enabled: z.boolean(),
    username: z.string().regex(/^[A-Za-z0-9_.@-]{1,100}$/),
    apiKey: z.string().min(8).max(256).optional(),
    senderId: z.string().regex(/^[A-Za-z]{1,6}$/),
    entityId: z.string().regex(/^\d{10,25}$/),
    encoding: z.enum(["txt", "uni"]),
    verification: template,
    templates: z.array(templateEntry).min(2).max(100).optional(),
  })
  .strict();
export const recoverySettingsSchema = smsSettingsSchema
  .omit({ version: true, enabled: true, verification: true, templates: true })
  .extend({ apiKey: z.string().min(8).max(256), template })
  .strict();
export type RecoverySettings = z.infer<typeof recoverySettingsSchema>;
export type SmsSettings = z.infer<typeof smsSettingsSchema>;

/** Preserve legacy verification settings while exposing two initial entries and any additional RA templates. */
export function smsTemplates(
  config?: Pick<SmsSettings, "verification" | "templates">,
): SmsTemplateEntry[] {
  return (
    config?.templates ?? [
      {
        key: "login",
        name: "Login",
        id: config?.verification.id ?? "",
        text: config?.verification.text ?? "",
      },
      {
        key: "password-reset",
        name: "Reset/Forgot Password",
        id: "",
        text: "",
      },
    ]
  );
}
/** Render a registered template using server-owned bounded substitutions only. */
export function renderOtp(templateText: string, code: string): string {
  return templateText
    .replaceAll("{{otp}}", code)
    .replaceAll("{{expiryMinutes}}", "5");
}
/** Use a keyed digest so short OTPs and phone numbers cannot be enumerated from a database dump. */
export function digest(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}
/** Compare fixed-length digests without data-dependent comparison. */
export function matches(left: string, right: string): boolean {
  return (
    left.length === right.length &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import Handlebars from "handlebars";
import PDFDocument from "pdfkit";
import type {
  KycProfile,
  Plan,
  Coupon,
  AgreementSettings,
} from "@ra/contracts";

/** Expose stable errors without leaking personal data or provider responses. */
export class OnboardingError extends Error {
  /** Assign the safe code and appropriate HTTP status. */
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
/** Reject invalid state before mutating business or financial records. */
export function requireValue(
  condition: unknown,
  code: string,
  status = 400,
): asserts condition {
  if (!condition) throw new OnboardingError(code, status);
}
/** Accept bounded plain text; controls are unsuitable in legal and identity records. */
export function text(value: unknown, max: number, min = 1): string {
  requireValue(typeof value === "string", "invalid_fields");
  const result = value.trim();
  requireValue(
    result.length >= min &&
      result.length <= max &&
      !Array.from(result).some((character) => {
        const code = character.charCodeAt(0);
        return (
          (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
          code === 127
        );
      }),
    "invalid_fields",
  );
  return result;
}
/** Validate integer paise/counts without floating-point financial arithmetic. */
export function integer(value: unknown, min: number, max: number): number {
  requireValue(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= min &&
      value <= max,
    "invalid_fields",
  );
  return value;
}
/** Validate canonical UUIDs before using an object identity. */
export function uuid(value: unknown): string {
  requireValue(
    typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        value,
      ),
    "invalid_id",
  );
  return value;
}
/** Normalize a phone number while distinguishing collection from verification. */
export function phone(value: unknown): string {
  const result = text(value, 16).replace(/[\s()-]/g, "");
  requireValue(/^\+?[1-9][0-9]{9,14}$/.test(result), "invalid_phone");
  return result;
}
/** Restrict the initial product to adult individual PAN holders; other client categories need separate workflows. */
export function kycProfile(
  input: Record<string, unknown>,
  now = new Date(),
): KycProfile {
  const pan = text(input.pan, 10).toUpperCase();
  requireValue(/^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$/.test(pan), "invalid_pan");
  const dob = text(input.dob, 10);
  const date = new Date(`${dob}T00:00:00Z`);
  requireValue(
    /^\d{4}-\d{2}-\d{2}$/.test(dob) &&
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === dob,
    "invalid_dob",
  );
  const adult = new Date(now);
  adult.setUTCFullYear(adult.getUTCFullYear() - 18);
  requireValue(
    date <= adult && date.getUTCFullYear() >= 1900,
    "adult_individuals_only",
  );
  const familyPan = input.familyPan
    ? text(input.familyPan, 10).toUpperCase()
    : pan;
  requireValue(
    /^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$/.test(familyPan),
    "invalid_family_pan",
  );
  requireValue(input.declaration === true, "declaration_required");
  return {
    fullName: text(input.fullName, 160),
    phone: phone(input.phone),
    pan,
    dob,
    documentId: uuid(input.documentId),
    familyPan,
    declaration: true,
  };
}
/** Validate immutable plan revisions with a maximum one-year advance service period. */
export function planInput(
  input: Record<string, unknown>,
): Omit<Plan, "id" | "version"> {
  requireValue(typeof input.active === "boolean", "invalid_fields");
  return {
    name: text(input.name, 120),
    description: text(input.description, 4000),
    days: integer(input.days, 1, 365),
    price: integer(input.price, 100, 100_000_000),
    taxBps: integer(input.taxBps, 0, 3000),
    active: input.active,
  };
}
/** Parse a UTC date without accepting malformed or ambiguous local times. */
export function timestamp(value: unknown): string {
  const result = text(value, 30);
  requireValue(
    /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{3})?)?Z$/.test(result) &&
      Number.isFinite(Date.parse(result)),
    "invalid_date",
  );
  return new Date(result).toISOString();
}
/** Validate bounded tenant-local coupons; percentages use integer percentage points. */
export function couponInput(
  input: Record<string, unknown>,
): Omit<Coupon, "id" | "version"> {
  const code = text(input.code, 32).toUpperCase();
  requireValue(/^[A-Z0-9_-]{3,32}$/.test(code), "invalid_coupon");
  requireValue(
    input.type === "percent" || input.type === "fixed",
    "invalid_coupon",
  );
  requireValue(typeof input.active === "boolean", "invalid_fields");
  const startsAt = timestamp(input.startsAt),
    endsAt = timestamp(input.endsAt);
  requireValue(endsAt > startsAt, "invalid_date");
  return {
    code,
    type: input.type,
    value: integer(
      input.value,
      1,
      input.type === "percent" ? 100 : 100_000_000,
    ),
    planId: input.planId ? uuid(input.planId) : null,
    startsAt,
    endsAt,
    limit: integer(input.limit, 1, 1_000_000),
    perUser: integer(input.perUser, 1, 1000),
    active: input.active,
  };
}
/** Require reviewed RA-owned terms; placeholders are data-only, never executable helpers or HTML. */
export function settingsInput(
  input: Record<string, unknown>,
): Omit<AgreementSettings, "version"> {
  const terms = text(input.terms, 30000, 500);
  requireValue(
    !/[<>]/.test(terms) && !/{{[{#!/>^&]/.test(terms),
    "invalid_terms",
  );
  const allowed = new Set([
    "clientName",
    "clientEmail",
    "clientPan",
    "clientDob",
    "clientPhone",
    "raName",
    "registration",
    "planName",
    "offering",
    "days",
    "subtotal",
    "discount",
    "tax",
    "total",
    "date",
    "orderId",
    "contact",
    "address",
  ]);
  for (const match of terms.matchAll(/{{(.*?)}}/g))
    requireValue(allowed.has(match[1].trim()), "invalid_terms");
  requireValue(typeof input.reviewed === "boolean", "invalid_fields");
  const gstin = text(input.gstin ?? "", 15, 0).toUpperCase();
  requireValue(
    !gstin || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin),
    "invalid_gstin",
  );
  return {
    terms,
    contact: text(input.contact, 254),
    address: text(input.address, 1000),
    gstin,
    annualLimit: integer(input.annualLimit, 100, 15_100_000),
    reviewed: input.reviewed,
  };
}
/** Calculate a frozen quote in integer paise, with tax rounded once on discounted fees. */
export function priceQuote(
  plan: Pick<Plan, "price" | "taxBps">,
  coupon?: Pick<Coupon, "type" | "value">,
) {
  const subtotal = plan.price;
  const discount = coupon
    ? Math.min(
        subtotal,
        coupon.type === "percent"
          ? Math.floor((subtotal * coupon.value) / 100)
          : coupon.value,
      )
    : 0;
  const tax = Math.round(((subtotal - discount) * plan.taxBps) / 10000);
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}
/** Format stored integer paise for human-readable agreements and receipts. */
export function money(paise: number): string {
  return `INR ${(paise / 100).toFixed(2)}`;
}
/** Hash exact UTF-8 agreement bytes or PDF bytes for evidentiary integrity. */
export function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
/** Derive purpose-separated keyed hashes for PAN lookup and short-lived signing codes. */
export function keyed(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}
/** Compare fixed-length signatures without leaking a matching prefix. */
export function equal(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** Encrypt sensitive identity and agreement snapshots with a random authenticated nonce. */
export function seal(secret: string, value: unknown): string {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      createHash("sha256").update(`onboarding:${secret}`).digest(),
      iv,
    );
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), bytes]
    .map((part) => part.toString("base64url"))
    .join(".");
}
/** Authenticate encrypted snapshots before parsing; corruption fails closed. */
export function unseal<T>(secret: string, value: string): T {
  const [iv, tag, bytes] = value
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  const cipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(`onboarding:${secret}`).digest(),
    iv,
  );
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(bytes), cipher.final()]).toString("utf8"),
  ) as T;
}
/** Compile a fixed server-owned legal envelope around RA-reviewed plain-text terms. */
export function agreement(
  terms: string,
  values: Record<string, string>,
): string {
  const envelope =
    "RESEARCH SERVICES AGREEMENT AND MITC\nAgreement: {{orderId}}\nRA: {{raName}} | SEBI: {{registration}}\nContact: {{contact}}\nAddress: {{address}}\nClient: {{clientName}} | {{clientEmail}} | PAN: {{clientPan}}\nDOB: {{clientDob}} | Phone: {{clientPhone}}\nPlan: {{planName}} | Duration: {{days}} days from confirmed payment\nServices: {{offering}}\nFees: {{subtotal}}\nDiscount: {{discount}}\nTax: {{tax}}\nTotal payable: {{total}}\nGenerated: {{date}}\n\n";
  // Output is plain text in React and PDFKit, not interpreted as HTML.
  return Handlebars.compile(envelope + terms, { strict: true, noEscape: true })(
    values,
  );
}
/** Render selectable-text A4 evidence without fetching external resources or executing markup. */
export async function pdf(textContent: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(10).text(textContent, { lineGap: 4 });
    doc.end();
  });
}
/** Development bypasses require both explicit opt-in and an explicitly development database. */
export function devEnabled(env: NodeJS.ProcessEnv): boolean {
  return (
    env.NODE_ENV !== "production" &&
    env.DB_ENV === "dev" &&
    env.ONBOARDING_DEV_SKIP === "true"
  );
}

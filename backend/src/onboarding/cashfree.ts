import { createHmac } from "node:crypto";
import { equal, requireValue, OnboardingError } from "./domain";

export type PaymentOrder = {
  id: string;
  total: number;
  customerId: string;
  name: string;
  email: string;
  phone: string;
  returnUrl: string;
  notifyUrl: string;
  expiresAt: string;
};
export interface PaymentGateway {
  mode: "sandbox" | "production";
  create(order: PaymentOrder): Promise<string>;
  paid(id: string, total: number): Promise<string | null>;
  closed?(id: string): Promise<boolean>;
  verify(raw: Buffer, timestamp: string, signature: string): boolean;
}
type Merchant = {
  clientId: string;
  clientSecret: string;
  mode: "sandbox" | "production";
};
/** Validate server-only tenant merchant settings; never route one RA's revenue through another RA's credentials. */
export function merchants(
  env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
): Map<string, PaymentGateway> {
  const result = new Map<string, PaymentGateway>();
  if (!env.CASHFREE_MERCHANTS_JSON) return result;
  const configuration = JSON.parse(env.CASHFREE_MERCHANTS_JSON) as Record<
    string,
    Merchant
  >;
  requireValue(
    configuration &&
      typeof configuration === "object" &&
      !Array.isArray(configuration),
    "invalid_cashfree_configuration",
  );
  for (const [slug, merchant] of Object.entries(configuration)) {
    requireValue(
      /^[a-z][a-z0-9-]{1,47}$/.test(slug) &&
        merchant &&
        typeof merchant.clientId === "string" &&
        merchant.clientId.length > 0 &&
        typeof merchant.clientSecret === "string" &&
        merchant.clientSecret.length > 0 &&
        ["sandbox", "production"].includes(merchant.mode),
      "invalid_cashfree_configuration",
    );
    requireValue(
      env.NODE_ENV !== "production" || merchant.mode === "production",
      "sandbox_forbidden_in_production",
    );
    requireValue(
      merchant.mode !== "production" ||
        (env.DB_ENV === "prod" &&
          env.NODE_ENV === "production" &&
          env.ONBOARDING_PRODUCTION_APPROVED === "true"),
      "production_payments_not_approved",
    );
    result.set(slug, new CashfreeGateway(merchant, request));
  }
  return result;
}
/** Use Cashfree hosted checkout, authenticated reconciliation and raw-body webhook signatures. */
export class CashfreeGateway implements PaymentGateway {
  readonly mode: Merchant["mode"];
  /** Keep credentials server-side and permit controlled HTTP adapters in tests. */
  constructor(
    private readonly merchant: Merchant,
    private readonly request: typeof fetch = fetch,
  ) {
    this.mode = merchant.mode;
  }
  /** Bound provider calls and redact all provider/network errors. */
  private async call(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ): Promise<Record<string, unknown> | Record<string, unknown>[]> {
    try {
      const response = await this.request(
        `${this.mode === "production" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com"}/pg${path}`,
        {
          method,
          signal: AbortSignal.timeout(10000),
          headers: {
            "content-type": "application/json",
            "x-api-version": "2025-01-01",
            "x-client-id": this.merchant.clientId,
            "x-client-secret": this.merchant.clientSecret,
            ...(key ? { "x-idempotency-key": key } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      requireValue(response.ok, "payment_provider_unavailable", 502);
      return (await response.json()) as
        Record<string, unknown> | Record<string, unknown>[];
    } catch {
      throw new OnboardingError("payment_provider_unavailable", 502);
    }
  }
  /** Reuse the application order UUID as both the Cashfree order ID and retry identity. */
  async create(order: PaymentOrder): Promise<string> {
    const body = {
      order_id: order.id,
      order_amount: order.total / 100,
      order_currency: "INR",
      order_expiry_time: order.expiresAt,
      customer_details: {
        customer_id: order.customerId,
        customer_name: order.name,
        customer_email: order.email,
        customer_phone: order.phone.replace(/^\+91/, ""),
      },
      order_meta: { return_url: order.returnUrl, notify_url: order.notifyUrl },
    };
    const result = (await this.call(
      "/orders",
      "POST",
      body,
      order.id,
    )) as Record<string, unknown>;
    requireValue(
      typeof result.payment_session_id === "string" &&
        result.payment_session_id.length > 0 &&
        result.order_id === order.id &&
        result.order_currency === "INR" &&
        Math.round(Number(result.order_amount) * 100) === order.total,
      "invalid_payment_order",
      502,
    );
    return result.payment_session_id;
  }
  /** Trust authenticated provider state, exact amount/currency and a successful payment, never a browser redirect. */
  async paid(id: string, total: number): Promise<string | null> {
    const order = (await this.call(
      `/orders/${encodeURIComponent(id)}`,
    )) as Record<string, unknown>;
    requireValue(
      order.order_id === id &&
        order.order_currency === "INR" &&
        Math.round(Number(order.order_amount) * 100) === total,
      "payment_amount_mismatch",
      409,
    );
    if (order.order_status !== "PAID") return null;
    const payments = await this.call(
      `/orders/${encodeURIComponent(id)}/payments`,
    );
    requireValue(Array.isArray(payments), "invalid_payment_order", 502);
    const payment = payments.find(
      (entry) =>
        entry.payment_status === "SUCCESS" &&
        entry.payment_currency === "INR" &&
        Math.round(Number(entry.payment_amount) * 100) === total,
    );
    requireValue(
      payment &&
        (typeof payment.cf_payment_id === "string" ||
          typeof payment.cf_payment_id === "number"),
      "invalid_payment_order",
      502,
    );
    return String(payment.cf_payment_id);
  }
  /** Release abandoned local checkouts only after the gateway confirms a terminal unpaid order. */
  async closed(id: string): Promise<boolean> {
    const order = (await this.call(
      `/orders/${encodeURIComponent(id)}`,
    )) as Record<string, unknown>;
    requireValue(order.order_id === id, "invalid_payment_order", 502);
    return ["EXPIRED", "TERMINATED"].includes(String(order.order_status));
  }
  /** Verify Cashfree's base64 HMAC over the timestamp followed by the unchanged request bytes. */
  verify(raw: Buffer, timestamp: string, signature: string): boolean {
    if (!/^\d{10,13}$/.test(timestamp) || !signature) return false;
    const expected = createHmac("sha256", this.merchant.clientSecret)
      .update(timestamp)
      .update(raw)
      .digest("base64");
    return equal(expected, signature);
  }
}

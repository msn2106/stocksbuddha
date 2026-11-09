import { sampleResearchAgreement } from "@ra/contracts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as domain from "../src/onboarding/domain";
import { CashfreeGateway, merchants } from "../src/onboarding/cashfree";
import { createHmac } from "node:crypto";

const profile = {
  fullName: "Example Investor",
  phone: "+919876543210",
  pan: "ABCPD1234E",
  dob: "1990-02-15",
  documentId: randomUUID(),
  familyPan: "",
  declaration: true,
};
const plan = {
  name: "Research monthly",
  description: "Research reports and updates",
  days: 30,
  price: 10000,
  taxBps: 1800,
  active: true,
};
const terms =
  "Reviewed research services terms and MITC. ".repeat(20) +
  " Client {{clientName}} pays {{total}}.";
const settings = {
  terms,
  contact: "ra@example.test",
  address: "Example RA address",
  gstin: "",
  annualLimit: 15100000,
  reviewed: true,
};
test("KYC validates adult individual PAN, real dates, declarations and exact evidence IDs", () => {
  assert.equal(domain.kycProfile(profile).familyPan, profile.pan);
  assert.equal(
    domain.kycProfile({ ...profile, familyPan: "ZYXPQ4321A" }).familyPan,
    "ZYXPQ4321A",
  );
  for (const input of [
    { pan: "ABCXD1234E" },
    { pan: "bad" },
    { dob: "1990-02-30" },
    { dob: "bad" },
    { dob: "2020-01-01" },
    { dob: "1899-01-01" },
    { documentId: "bad" },
    { declaration: false },
    { phone: "123" },
    { familyPan: "bad" },
    { fullName: "" },
  ])
    assert.throws(() => domain.kycProfile({ ...profile, ...input }));
  assert.equal(domain.phone("+91 (98765)43210"), "+919876543210");
  for (const value of [null, "\u0001", " ", "toolong"])
    assert.throws(() => domain.text(value, 3));
  assert.throws(() => domain.integer("1", 1, 5));
  assert.throws(() => domain.integer(1.5, 1, 5));
  assert.throws(() => domain.integer(6, 1, 5));
  assert.equal(domain.integer(2, 1, 5), 2);
  assert.equal(domain.uuid(profile.documentId), profile.documentId);
});
test("plans and coupons bound advance periods, discounts, dates and scope", () => {
  assert.deepEqual(domain.planInput(plan), plan);
  for (const input of [
    { days: 366 },
    { price: -1 },
    { taxBps: 3001 },
    { active: "yes" },
  ])
    assert.throws(() => domain.planInput({ ...plan, ...input }));
  const coupon = {
    code: "welcome",
    type: "percent",
    value: 10,
    planId: null,
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2027-01-01T00:00:00Z",
    limit: 100,
    perUser: 1,
    active: true,
  };
  assert.equal(domain.couponInput(coupon).code, "WELCOME");
  assert.throws(() => domain.couponInput({ ...coupon, code: "Diwali Offer" }), {
    message: "invalid_coupon",
  });
  for (const code of ["DIWALI10", "DIWALI-OFFER", "DIWALI_OFFER"])
    assert.equal(domain.couponInput({ ...coupon, code }).code, code);

  assert.equal(
    domain.couponInput({
      ...coupon,
      type: "fixed",
      value: 500,
      planId: profile.documentId,
    }).value,
    500,
  );
  for (const input of [
    { code: "a" },
    { type: "other" },
    { value: 101 },
    { active: "yes" },
    { startsAt: "bad" },
    { endsAt: "2025-01-01T00:00:00Z" },
    { limit: 0 },
    { perUser: 0 },
  ])
    assert.throws(() => domain.couponInput({ ...coupon, ...input }));
  assert.deepEqual(domain.priceQuote(plan), {
    subtotal: 10000,
    discount: 0,
    tax: 1800,
    total: 11800,
  });
  assert.deepEqual(domain.priceQuote(plan, { type: "percent", value: 10 }), {
    subtotal: 10000,
    discount: 1000,
    tax: 1620,
    total: 10620,
  });
  assert.deepEqual(domain.priceQuote(plan, { type: "fixed", value: 15000 }), {
    subtotal: 10000,
    discount: 10000,
    tax: 0,
    total: 0,
  });
  assert.equal(domain.money(10620), "INR 106.20");
});
test("reviewed legal templates accept only known data placeholders and validated billing facts", async () => {
  assert.equal(domain.settingsInput(settings).reviewed, true);
  assert.equal(
    domain.settingsInput({
      ...settings,
      terms: sampleResearchAgreement,
      reviewed: false,
    }).terms,
    sampleResearchAgreement,
  );

  assert.equal(
    domain.settingsInput({ ...settings, gstin: "27ABCDE1234F1Z5" }).gstin,
    "27ABCDE1234F1Z5",
  );
  for (const input of [
    { terms: "short" },
    { terms: terms + "<script>" },
    { terms: terms + "{{#if value}}" },
    { terms: terms + "{{unknown}}" },
    { gstin: "bad" },
    { reviewed: "true" },
    { annualLimit: 15100001 },
  ])
    assert.throws(() => domain.settingsInput({ ...settings, ...input }));
  const keys = [
    "orderId",
    "raName",
    "registration",
    "contact",
    "address",
    "clientName",
    "clientEmail",
    "clientPan",
    "clientDob",
    "clientPhone",
    "planName",
    "offering",
    "days",
    "subtotal",
    "discount",
    "tax",
    "total",
    "date",
  ];
  const values = Object.fromEntries(
    keys.map((key) => [key, key === "clientName" ? "A & B <example>" : key]),
  );
  const agreement = domain.agreement(terms, values);
  const sample = domain.agreement(sampleResearchAgreement, values);
  assert.ok(sample.includes("RA REVIEW NOTE"));
  assert.ok(!sample.includes("{{"));
  assert.ok(sample.includes("A & B <example>"));

  assert.ok(agreement.includes("A & B <example>"));
  assert.ok(agreement.includes("Total payable: total"));
  const bytes = await domain.pdf(agreement);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
});
test("sensitive snapshots use authenticated encryption and purpose-separated keyed hashes", () => {
  const encrypted = domain.seal("secret", profile);
  assert.ok(!encrypted.includes(profile.pan));
  assert.notEqual(encrypted, domain.seal("secret", profile));
  assert.deepEqual(domain.unseal("secret", encrypted), profile);
  assert.throws(() => domain.unseal("other", encrypted));
  assert.throws(() => domain.unseal("secret", encrypted.slice(0, -5)));
  assert.equal(domain.hash("value"), domain.hash(Buffer.from("value")));
  assert.notEqual(
    domain.keyed("secret", "pan:value"),
    domain.keyed("secret", "otp:value"),
  );
  assert.ok(domain.equal("same", "same"));
  assert.ok(!domain.equal("same", "diff"));
  assert.ok(!domain.equal("a", "long"));
  assert.ok(domain.devEnabled({ DB_ENV: "dev", ONBOARDING_DEV_SKIP: "true" }));
  for (const env of [
    {},
    { DB_ENV: "prod", ONBOARDING_DEV_SKIP: "true" },
    { NODE_ENV: "production", DB_ENV: "dev", ONBOARDING_DEV_SKIP: "true" },
  ])
    assert.ok(!domain.devEnabled(env));
  assert.equal(new domain.OnboardingError("test").status, 400);
  assert.throws(() => domain.requireValue(false, "test", 403), { status: 403 });
});
test("Cashfree configuration isolates merchants and refuses live credentials in dev or unapproved production", () => {
  assert.equal(merchants({}).size, 0);
  const config = { clientId: "id", clientSecret: "secret", mode: "sandbox" };
  const env = { CASHFREE_MERCHANTS_JSON: JSON.stringify({ alpha: config }) };
  assert.equal(merchants(env).get("alpha")?.mode, "sandbox");
  for (const change of [
    { NODE_ENV: "production" },
    { CASHFREE_MERCHANTS_JSON: "[]" },
    { CASHFREE_MERCHANTS_JSON: JSON.stringify({ "Bad slug": config }) },
    {
      CASHFREE_MERCHANTS_JSON: JSON.stringify({
        alpha: { ...config, clientSecret: "" },
      }),
    },
    {
      CASHFREE_MERCHANTS_JSON: JSON.stringify({
        alpha: { ...config, mode: "production" },
      }),
    },
  ])
    assert.throws(() => merchants({ ...env, ...change }));
  assert.equal(
    merchants({
      NODE_ENV: "production",
      DB_ENV: "prod",
      ONBOARDING_PRODUCTION_APPROVED: "true",
      CASHFREE_MERCHANTS_JSON: JSON.stringify({
        alpha: { ...config, mode: "production" },
      }),
    }).get("alpha")?.mode,
    "production",
  );
});
test("Cashfree verifies raw HMAC and reconciles exact successful INR payments with bounded redacted HTTP", async () => {
  const id = randomUUID(),
    raw = Buffer.from('{"type":"test"}'),
    timestamp = "1794096000000";
  const merchant = {
    clientId: "id",
    clientSecret: "private-secret",
    mode: "sandbox" as const,
  };
  let response: unknown = {
    order_id: id,
    order_amount: 106.2,
    order_currency: "INR",
    payment_session_id: "session",
    order_status: "ACTIVE",
  };
  const calls: { url: string; init?: RequestInit }[] = [];
  const gateway = new CashfreeGateway(merchant, async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(
      String(url).endsWith("/payments")
        ? [
            {
              payment_status: "SUCCESS",
              payment_currency: "INR",
              payment_amount: 106.2,
              cf_payment_id: "payment-1",
            },
          ]
        : response,
    );
  });
  assert.equal(
    await gateway.create({
      id,
      total: 10620,
      customerId: "customer",
      name: "Example",
      email: "example@test.test",
      phone: "+919876543210",
      returnUrl: "https://app.test/return",
      notifyUrl: "https://app.test/hook",
      expiresAt: "2026-11-08T12:30:00Z",
    }),
    "session",
  );
  assert.equal(JSON.parse(String(calls[0].init?.body)).order_amount, 106.2);
  assert.equal(
    JSON.parse(String(calls[0].init?.body)).customer_details.customer_phone,
    "9876543210",
  );
  assert.equal(await gateway.paid(id, 10620), null);
  response = { ...(response as object), order_status: "PAID" };
  assert.equal(await gateway.paid(id, 10620), "payment-1");
  response = { ...(response as object), order_status: "EXPIRED" };
  assert.equal(await gateway.closed(id), true);
  response = { ...(response as object), order_status: "ACTIVE" };
  assert.equal(await gateway.closed(id), false);
  const signature = createHmac("sha256", merchant.clientSecret)
    .update(timestamp)
    .update(raw)
    .digest("base64");
  assert.ok(gateway.verify(raw, timestamp, signature));
  assert.ok(!gateway.verify(Buffer.from("changed"), timestamp, signature));
  assert.ok(!gateway.verify(raw, "bad", signature));
  assert.ok(!gateway.verify(raw, timestamp, ""));
  response = { ...(response as object), order_amount: 1 };
  await assert.rejects(gateway.paid(id, 10620), /payment_amount_mismatch/);
  await assert.rejects(
    gateway.create({ id, total: 10620, phone: "9876543210" } as never),
    /invalid_payment_order/,
  );
  const failure = new CashfreeGateway(
    { ...merchant, mode: "production" },
    async () => new Response("private-secret", { status: 500 }),
  );
  await assert.rejects(failure.paid(id, 1), /payment_provider_unavailable/);
  const network = new CashfreeGateway(merchant, async () => {
    throw new Error("private-secret");
  });
  await assert.rejects(network.paid(id, 1), /payment_provider_unavailable/);
  assert.ok(calls[0].init?.signal);
});
